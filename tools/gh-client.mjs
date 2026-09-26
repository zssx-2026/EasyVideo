import http from 'node:http';
import tls from 'node:tls';
const CRLF = String.fromCharCode(13, 10);
const PROXY = { host: "127.0.0.1", port: 13799 };
export function viaProxy(target, method, path, headers, body) {
  return new Promise(function (resolve, reject) {
    const req = http.request({ host: PROXY.host, port: PROXY.port, method: "CONNECT", path: target + ":443", timeout: 180000 });
    req.on("connect", function (res, socket) {
      if (res.statusCode !== 200) { reject(new Error("CONNECT " + res.statusCode)); socket.destroy(); return; }
      const t = tls.connect({ socket: socket, servername: target }, function () {
        const head = [method + " " + path + " HTTP/1.1", "Host: " + target];
        const keys = Object.keys(headers || {});
        for (let i = 0; i < keys.length; i++) head.push(keys[i] + ": " + headers[keys[i]]);
        head.push("Connection: close", "", "");
        t.write(head.join(CRLF));
        if (body) t.write(body);
      });
      const chunks = [];
      t.on("data", function (d) { chunks.push(d); });
      t.on("end", function () {
        const raw = Buffer.concat(chunks);
        const sep = raw.indexOf(Buffer.from(CRLF + CRLF));
        const head = raw.slice(0, sep).toString("utf8");
        const payload = raw.slice(sep + 4);
        const status = Number((head.split(CRLF)[0] || "").split(" ")[1]) || 0;
        resolve({ status: status, raw: payload });
      });
      t.on("error", reject);
    });
    req.on("timeout", function () { req.destroy(); reject(new Error("timeout")); });
    req.on("error", reject);
    req.end();
  });
}
export async function ghApi(target, token, method, path, body) {
  const headers = { accept: "application/vnd.github+json", "user-agent": "EasyVideo", authorization: "Bearer " + token };
  let payload = null;
  if (body !== undefined && body !== null) { payload = Buffer.from(JSON.stringify(body), "utf8"); headers["content-type"] = "application/json"; headers["content-length"] = String(payload.length); }
  const res = await viaProxy(target, method, path, headers, payload);
  let data = null;
  try { data = JSON.parse(res.raw.toString("utf8")); } catch (err) { data = res.raw.toString("utf8"); }
  return { status: res.status, data: data };
}
