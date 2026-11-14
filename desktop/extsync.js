// Mantém a extensão IA Council sempre atualizada numa pasta fixa do PC.
// O app baixa a versão nova do site e grava os arquivos; a própria extensão percebe e se recarrega sozinha.
"use strict";
const fs = require("fs"), path = require("path"), zlib = require("zlib"), https = require("https");
const BASE = "https://council-one-sigma.vercel.app/extension/";

function get(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { "Cache-Control": "no-cache" } }, (r) => {
      if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location) { r.resume(); return get(new URL(r.headers.location, url).href).then(resolve, reject); }
      if (r.statusCode !== 200) { r.resume(); return reject(new Error("HTTP " + r.statusCode)); }
      const b = []; r.on("data", (d) => b.push(d)); r.on("end", () => resolve(Buffer.concat(b)));
    });
    req.on("error", reject);
    req.setTimeout(20000, () => req.destroy(new Error("tempo esgotado")));
  });
}
function unzip(buf) {
  let e = buf.length - 22;
  while (e >= 0 && buf.readUInt32LE(e) !== 0x06054b50) e--;
  if (e < 0) throw new Error("zip inválido");
  const n = buf.readUInt16LE(e + 10); let p = buf.readUInt32LE(e + 16); const out = [];
  for (let i = 0; i < n; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error("zip inválido");
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20), nlen = buf.readUInt16LE(p + 28), xlen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32), off = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nlen).toString("utf8"); p += 46 + nlen + xlen + clen;
    if (name.endsWith("/")) continue;
    const start = off + 30 + buf.readUInt16LE(off + 26) + buf.readUInt16LE(off + 28), raw = buf.slice(start, start + csize);
    const data = method === 0 ? raw : method === 8 ? zlib.inflateRawSync(raw) : null;
    if (!data) throw new Error("compressão não suportada");
    out.push({ name, data });
  }
  return out;
}
function safeJoin(dir, name) {
  const base = path.resolve(dir), t = path.resolve(base, name);
  if (!t.startsWith(base + path.sep)) throw new Error("caminho inválido no zip: " + name);
  return t;
}
function localVersion(dir) { try { return JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8")).version || ""; } catch { return ""; } }
function newer(a, b) {
  const x = String(a || "0").split(".").map(Number), y = String(b || "0").split(".").map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) { const d = (x[i] || 0) - (y[i] || 0); if (d) return d > 0; }
  return false;
}
async function sync(dir, fetcher = get) {
  const remote = JSON.parse((await fetcher(BASE + "version.json?t=" + Date.now())).toString("utf8")).version;
  const cur = localVersion(dir);
  if (cur && !newer(remote, cur)) return { updated: false, version: cur, dir };
  const files = unzip(await fetcher(BASE + "ia-council-extension.zip?t=" + Date.now()));
  if (!files.some((f) => f.name === "manifest.json")) throw new Error("zip sem manifest.json");
  files.sort((a, b) => (a.name === "manifest.json") - (b.name === "manifest.json")); // manifesto por último
  fs.mkdirSync(dir, { recursive: true });
  for (const f of files) {
    const t = safeJoin(dir, f.name);
    fs.mkdirSync(path.dirname(t), { recursive: true });
    fs.writeFileSync(t + ".tmp", f.data); fs.renameSync(t + ".tmp", t);
  }
  return { updated: true, version: localVersion(dir) || remote, from: cur, dir };
}
module.exports = { sync, unzip, newer, localVersion };
