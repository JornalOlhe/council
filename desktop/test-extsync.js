// node desktop/test-extsync.js — atualização automática da extensão
const assert = require("assert"), fs = require("fs"), os = require("os"), path = require("path");
const { sync, newer } = require("./extsync.js");
const zipBuf = fs.readFileSync(path.join(__dirname, "..", "extension", "jarvis-extension.zip"));
const ver = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "extension", "version.json"))).version;
(async () => {
  assert.ok(newer("1.0.10", "1.0.9") && !newer("1.0.4", "1.0.4") && newer("1.1.0", "1.0.99"));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "iacext-"));
  const fetcher = async (u) => (u.includes("version.json") ? Buffer.from(JSON.stringify({ version: ver })) : zipBuf);
  const r1 = await sync(dir, fetcher);
  assert.equal(r1.updated, true); assert.equal(r1.version, ver);
  assert.ok(fs.existsSync(path.join(dir, "background.js")) && fs.existsSync(path.join(dir, "icons", "icon128.png")));
  const r2 = await sync(dir, fetcher);
  assert.equal(r2.updated, false, "não baixa de novo a mesma versão");
  const evil = async (u) => (u.includes("version.json") ? Buffer.from('{"version":"9.9.9"}') : require("zlib") && makeEvil());
  function makeEvil() { // zip com "../fora.txt"
    const { execSync } = require("child_process"); const t = fs.mkdtempSync(path.join(os.tmpdir(), "ev-"));
    execSync(`python3 -c "import zipfile;z=zipfile.ZipFile('${t}/e.zip','w');z.writestr('manifest.json','{}');z.writestr('../fora.txt','x');z.close()"`);
    return fs.readFileSync(t + "/e.zip");
  }
  await assert.rejects(() => sync(dir, evil), /caminho inválido/);
  console.log("✓ app atualiza a pasta da extensão sozinho (e bloqueia zip malicioso)");
})().catch((e) => { console.error(e); process.exit(1); });
