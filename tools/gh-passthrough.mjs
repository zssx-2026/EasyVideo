#!/usr/bin/env node
/* EasyVideo - GitHub direct-connect passthrough proxy.
 * The local DNS hijacks github.com to 127.0.0.1, so the web UI will not load.
 * Real IPs answer fine, but a browser cannot choose its SNI from a URL, so this
 * runs a plain CONNECT tunnel: the browser asks for github.com:443 as usual and
 * we forward raw bytes to a reachable real IP. No man-in-the-middle.
 *
 *   node tools/gh-passthrough.mjs            listen on 127.0.0.1:13799
 * PAC: http://127.0.0.1:13799/proxy.pac
 */
import http from 'node:http';
import net from 'node:net';
import dns from 'node:dns';

const CRLF = String.fromCharCode(13, 10);
const Q = String.fromCharCode(34);
const arg = (name, fallback) => {
  for (const a of process.argv) if (a.indexOf(name + '=') === 0) return a.slice(name.length + 1);
  return fallback;
};
const PORT = Number(arg('--port', 13799));
const HOST = arg('--host', '127.0.0.1');

const CANDIDATES = {
  'github.com': ['140.82.112.3', '140.82.113.3', '140.82.114.3', '140.82.116.3', '140.82.121.3', '20.27.177.113', '20.200.245.247', '20.201.28.151', '20.205.243.165', '20.205.243.168'],
  'api.github.com': ['20.205.243.168', '20.205.243.161', '140.82.112.6', '140.82.113.6'],
  'uploads.github.com': ['20.205.243.161', '20.205.243.168'],
  'codeload.github.com': ['20.205.243.165', '20.205.243.168'],
  'objects.githubusercontent.com': ['185.199.108.133', '185.199.109.133', '185.199.110.133', '185.199.111.133'],
  'raw.githubusercontent.com': ['185.199.108.133', '185.199.109.133', '185.199.110.133', '185.199.111.133'],
  'avatars.githubusercontent.com': ['185.199.108.133', '185.199.109.133'],
  'github.githubassets.com': ['185.199.110.215', '185.199.111.215']
};

const alive = new Map();

function probe(ip, port) {
  return new Promise(function (resolve) {
    const s = net.connect(port, ip);
    const done = function (ok) { try { s.destroy(); } catch (err) { } resolve(ok); };
    s.setTimeout(2500);
    s.on('connect', function () { done(true); });
    s.on('timeout', function () { done(false); });
    s.on('error', function () { done(false); });
  });
}

async function pick(host, port) {
  const key = host + ':' + port;
  if (alive.has(key)) return alive.get(key);
  for (const ip of CANDIDATES[host] || []) {
    if (await probe(ip, port)) { alive.set(key, ip); return ip; }
  }
  try {
    const r = await dns.promises.lookup(host, { family: 4 });
    if (r && r.address) { alive.set(key, r.address); return r.address; }
  } catch (err) { }
  return null;
}

function pac() {
  const where = 'PROXY ' + HOST + ':' + PORT;
  return [
    'function FindProxyForURL(url, host) {',
    '  if (host === ' + Q + 'github.com' + Q + ' || dnsDomainIs(host, ' + Q + '.github.com' + Q + ')) return ' + Q + where + Q + ';',
    '  if (dnsDomainIs(host, ' + Q + '.githubusercontent.com' + Q + ')) return ' + Q + where + Q + ';',
    '  if (dnsDomainIs(host, ' + Q + '.githubassets.com' + Q + ')) return ' + Q + where + Q + ';',
    '  return ' + Q + 'DIRECT' + Q + ';',
    '}'
  ].join(String.fromCharCode(10));
}

let tunnels = 0;
let failed = 0;

const server = http.createServer(function (req, res) {
  const url = req.url || '/';
  if (url.indexOf('/proxy.pac') === 0) {
    res.writeHead(200, { 'content-type': 'application/x-ns-proxy-autoconfig', 'cache-control': 'no-store' });
    res.end(pac());
    return;
  }
  res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
  res.end(['EasyVideo GitHub passthrough', 'PAC http://' + HOST + ':' + PORT + '/proxy.pac', 'tunnels ' + tunnels, 'failed ' + failed].join(String.fromCharCode(10)) + String.fromCharCode(10));
});

server.on('connect', async function (req, clientSocket, head) {
  const parts = String(req.url || '').split(':');
  const host = parts[0];
  const port = Number(parts[1]) || 443;
  let ip = null;
  try { ip = await pick(host, port); } catch (err) { ip = null; }
  if (!ip) {
    failed += 1;
    try { clientSocket.write('HTTP/1.1 502 Bad Gateway' + CRLF + CRLF); } catch (err) { }
    clientSocket.destroy();
    return;
  }
  const upstream = net.connect(port, ip, function () {
    tunnels += 1;
    clientSocket.write('HTTP/1.1 200 Connection Established' + CRLF + CRLF);
    if (head && head.length) upstream.write(head);
    upstream.pipe(clientSocket);
    clientSocket.pipe(upstream);
  });
  upstream.setTimeout(20000, function () { upstream.destroy(); });
  upstream.on('error', function () {
    failed += 1;
    alive.delete(host + ':' + port);
    try { clientSocket.write('HTTP/1.1 502 Bad Gateway' + CRLF + CRLF); } catch (err) { }
    clientSocket.destroy();
  });
  clientSocket.on('error', function () { upstream.destroy(); });
});

server.listen(PORT, HOST, function () {
  console.log('[gh-passthrough] http://' + HOST + ':' + PORT);
  console.log('[gh-passthrough] PAC http://' + HOST + ':' + PORT + '/proxy.pac');
});
