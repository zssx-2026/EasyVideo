/* EasyVideo - WebSocket hub: signalling, chat, presence, swarm control. */
import crypto from 'node:crypto';
import { log, now } from './util.js';
import * as transport from './transport.js';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

export class Hub {
  constructor() {
    this.clients = new Map();   // peerId -> { socket, name, roomId, alive, accountId }
    this.rooms = new Map();     // roomId -> Set(peerId)
  }

  attach(server) {
    this.server = server;
    server.on('upgrade', (req, socket) => {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname !== '/ws') { socket.destroy(); return; }
      this.handshake(req, socket, url);
    });
  }

  handshake(req, socket, url) {
    const key = req.headers['sec-websocket-key'];
    if (!key) { socket.destroy(); return; }
    const accept = crypto.createHash('sha1').update(key + GUID).digest('base64');
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      'Sec-WebSocket-Accept: ' + accept + '\r\n\r\n'
    );
    socket.setNoDelay(true);

    const peerId = url.searchParams.get('peer') || crypto.randomBytes(6).toString('hex');
    const name = url.searchParams.get('name') || ('guest-' + peerId.slice(0, 4));
    const accountId = url.searchParams.get('account') || null;
    const client = { id: peerId, socket, name, accountId, alive: true, buffer: Buffer.alloc(0), rooms: new Set() };
    this.clients.set(peerId, client);
    transport.registerPeer(peerId, this.wrap(client), { name, accountId });

    this.send(client, { t: 'hello', peerId, name, serverTime: now(), modes: transport.MODES, segmentBytes: transport.SEGMENT_BYTES });

    socket.on('data', (chunk) => this.onData(client, chunk));
    socket.on('close', () => this.drop(client));
    socket.on('error', () => this.drop(client));
  }

  /** transport.sendTo() only needs .send(string). */
  wrap(client) {
    const self = this;
    return {
      send(payload) {
        self.send(client, typeof payload === 'string' ? JSON.parse(payload) : payload);
      }
    };
  }

  onData(client, chunk) {
    client.buffer = Buffer.concat([client.buffer, chunk]);
    for (;;) {
      const frame = this.decode(client.buffer);
      if (!frame) break;
      client.buffer = client.buffer.subarray(frame.consumed);
      if (frame.opcode === 0x8) { this.drop(client); return; }
      if (frame.opcode === 0x9) { this.writeFrame(client.socket, 0xA, frame.payload); continue; }
      if (frame.opcode !== 0x1 && frame.opcode !== 0x2) continue;
      let msg;
      try { msg = JSON.parse(frame.payload.toString('utf8')); } catch { continue; }
      try { this.dispatch(client, msg); }
      catch (err) { log('hub dispatch error', err.message); this.send(client, { t: 'error', error: err.message }); }
    }
  }

  decode(buf) {
    if (buf.length < 2) return null;
    const b0 = buf[0];
    const b1 = buf[1];
    const opcode = b0 & 0x0f;
    const masked = (b1 & 0x80) !== 0;
    let len = b1 & 0x7f;
    let offset = 2;
    if (len === 126) { if (buf.length < 4) return null; len = buf.readUInt16BE(2); offset = 4; }
    else if (len === 127) { if (buf.length < 10) return null; len = Number(buf.readBigUInt64BE(2)); offset = 10; }
    let mask = null;
    if (masked) { if (buf.length < offset + 4) return null; mask = buf.subarray(offset, offset + 4); offset += 4; }
    if (buf.length < offset + len) return null;
    const payload = Buffer.from(buf.subarray(offset, offset + len));
    if (mask) for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4];
    return { opcode, payload, consumed: offset + len };
  }

  writeFrame(socket, opcode, payload) {
    const data = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload), 'utf8');
    const len = data.length;
    let header;
    if (len < 126) { header = Buffer.alloc(2); header[1] = len; }
    else if (len < 65536) { header = Buffer.alloc(4); header[1] = 126; header.writeUInt16BE(len, 2); }
    else { header = Buffer.alloc(10); header[1] = 127; header.writeBigUInt64BE(BigInt(len), 2); }
    header[0] = 0x80 | opcode;
    try { socket.write(Buffer.concat([header, data])); return true; }
    catch { return false; }
  }

  send(client, payload) { return this.writeFrame(client.socket, 0x1, JSON.stringify(payload)); }

  joinRoom(client, roomId) {
    if (!this.rooms.has(roomId)) this.rooms.set(roomId, new Set());
    this.rooms.get(roomId).add(client.id);
    client.rooms.add(roomId);
    const stream = transport.getStream(roomId) || null;
    if (stream) stream.viewers.add(client.id);
  }

  leaveRoom(client, roomId) {
    const set = this.rooms.get(roomId);
    if (set) set.delete(client.id);
    client.rooms.delete(roomId);
    const stream = transport.getStream(roomId);
    if (stream) stream.viewers.delete(client.id);
  }

  roomMembers(roomId) {
    const set = this.rooms.get(roomId);
    if (!set) return [];
    return [...set].map((id) => {
      const c = this.clients.get(id);
      return { id, name: c ? c.name : id.slice(0, 6) };
    });
  }

  broadcastRoom(roomId, payload, exceptId) {
    const set = this.rooms.get(roomId);
    if (!set) return 0;
    let n = 0;
    for (const id of set) {
      if (id === exceptId) continue;
      const c = this.clients.get(id);
      if (c && this.send(c, payload)) n++;
    }
    return n;
  }

  dispatch(client, msg) {
    switch (msg.t) {
      case 'ping': this.send(client, { t: 'pong', at: now() }); break;

      case 'join': {
        this.joinRoom(client, msg.streamId || msg.roomId);
        this.broadcastRoom(msg.streamId || msg.roomId, { t: 'peer-join', peerId: client.id, name: client.name }, client.id);
        this.send(client, { t: 'room', members: this.roomMembers(msg.streamId || msg.roomId) });
        break;
      }

      case 'leave': {
        const id = msg.streamId || msg.roomId;
        this.leaveRoom(client, id);
        this.broadcastRoom(id, { t: 'peer-leave', peerId: client.id }, client.id);
        break;
      }

      case 'publish': {
        const stream = transport.getStream(msg.streamId);
        if (stream) stream.publishers.add(client.id);
        transport.broadcast({ t: 'stream-live', streamId: msg.streamId, mode: msg.mode || null });
        break;
      }

      case 'have': {
        // BT: a viewer announces it now holds a segment and can serve it.
        transport.markHolder(msg.streamId, client.id, msg.index);
        this.broadcastRoom(msg.streamId, { t: 'have', peerId: client.id, index: msg.index }, client.id);
        break;
      }

      case 'want': {
        const stream = transport.getStream(msg.streamId);
        if (!stream) { this.send(client, { t: 'deny', index: msg.index, reason: 'no-stream' }); break; }
        const pick = transport.selectProvider(stream, msg.index, client.id);
        if (pick.kind === 'peer') {
          const holder = this.clients.get(pick.peerId);
          if (holder) this.send(holder, { t: 'serve', to: client.id, streamId: msg.streamId, index: msg.index });
          this.send(client, { t: 'provider', index: msg.index, peerId: pick.peerId });
        } else {
          this.send(client, { t: 'provider', index: msg.index, url: pick.url });
        }
        break;
      }

      case 'chat': {
        this.broadcastRoom(msg.streamId, {
          t: 'chat', peerId: client.id, name: client.name, text: String(msg.text || '').slice(0, 500), at: now()
        });
        break;
      }

      case 'signal': {
        // WebRTC-style direct signalling: route opaque SDP/ICE to a named peer.
        const target = this.clients.get(msg.to);
        if (target) this.send(target, { t: 'signal', from: client.id, data: msg.data });
        break;
      }

      case 'stat': {
        const peer = transport.peerList().find((p) => p.id === client.id);
        if (peer) Object.assign(peer.stats, msg.stats || {});
        break;
      }

      default:
        this.send(client, { t: 'error', error: 'unknown message type: ' + String(msg.t) });
    }
  }

  drop(client) {
    if (!this.clients.has(client.id)) return;
    for (const roomId of [...client.rooms]) {
      this.leaveRoom(client, roomId);
      this.broadcastRoom(roomId, { t: 'peer-leave', peerId: client.id });
    }
    this.clients.delete(client.id);
    transport.dropPeer(client.id);
    try { client.socket.destroy(); } catch { /* already gone */ }
  }

  stats() {
    return { peers: this.clients.size, rooms: this.rooms.size, members: [...this.rooms].map(([id, s]) => ({ id, n: s.size })) };
  }
}

export const hub = new Hub();
export default hub;
