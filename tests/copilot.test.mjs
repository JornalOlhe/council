// node tests/copilot.test.mjs
import assert from "node:assert/strict";
const { default: copilot, sanitizePlan } = await import("../api/copilot.js");
const { default: transcribe, cleanTranscript } = await import("../api/transcribe.js");

let reply = "", calls = [], groqAudio = { status: 200, text: "olá mundo" };
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  calls.push(u);
  if (u.includes("audio/transcriptions")) {
    assert.ok(init.body instanceof FormData);
    if (groqAudio.status !== 200) return new Response("not found", { status: groqAudio.status });
    return new Response(JSON.stringify({ text: groqAudio.text }), { status: 200 });
  }
  if (u.includes("googleapis")) return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "Na tela há um erro 404." }] } }] }), { status: 200 });
  return new Response(JSON.stringify({ choices: [{ message: { content: reply } }] }), { status: 200 });
};
const run = async (h, body) => { const r = { code: 0, json: null }; await h({ method: "POST", body, headers: {} }, { status(c) { r.code = c; return this; }, json(o) { r.json = o; return this; } }); return r; };
Object.assign(process.env, { GROQ_API_KEY: "q", GEMINI_API_KEY: "g" });
let ok = 0; const t = async (n, f) => { calls = []; await f(); ok++; console.log("✓", n); };

await t("plano com pesquisa no YouTube", async () => {
  reply = 'Claro! {"say":"Abrindo o YouTube.","actions":[{"type":"search","engine":"youtube","query":"lofi para estudar"}]}';
  const r = await run(copilot, { stage: "plan", text: "abre o youtube com lofi" });
  assert.equal(r.code, 200);
  assert.deepEqual(r.json.actions, [{ type: "search", engine: "youtube", query: "lofi para estudar" }]);
  assert.equal(r.json.by, "Groq");
});
await t("sanitiza ações perigosas ou inválidas", async () => {
  const p = sanitizePlan({ say: "x", actions: [
    { type: "open", url: "javascript:alert(1)" }, { type: "open", url: "g1.globo.com" },
    { type: "search", engine: "hack", query: "a" }, { type: "whatsapp", text: "oi", phone: "+55 (11) 9999-0000" },
  ] });
  assert.deepEqual(p.actions.map((a) => a.type), ["open", "search", "whatsapp"]);
  assert.deepEqual(sanitizePlan({ actions: [{ type: "rm", path: "/" }, { type: "timer", seconds: 999999 }] }).actions, []);
  assert.equal(p.actions[0].url, "https://g1.globo.com/");
  assert.equal(p.actions[1].engine, "google");
  assert.equal(p.actions[2].phone, "551199990000");
});
await t("resposta fora do formato: tenta o próximo provedor", async () => {
  reply = "sem json";
  const r = await run(copilot, { stage: "plan", text: "x" });
  assert.equal(r.code, 502);
});
await t("ver a tela usa o Gemini", async () => {
  const r = await run(copilot, { stage: "see", question: "qual o erro?", image: "data:image/jpeg;base64,AAAA" });
  assert.equal(r.code, 200);
  assert.match(r.json.answer, /404/);
});
await t("transcrição pelo Whisper do Groq", async () => {
  const audio = "data:audio/webm;codecs=opus;base64," + Buffer.alloc(2000, 1).toString("base64");
  const r = await run(transcribe, { audio });
  assert.equal(r.code, 200);
  assert.equal(r.json.text, "olá mundo");
});
await t("Whisper indisponível: cai para o Gemini", async () => {
  groqAudio = { status: 404 };
  const audio = "data:audio/webm;base64," + Buffer.alloc(2000, 1).toString("base64");
  const r = await run(transcribe, { audio });
  assert.equal(r.json.by, "Gemini");
  groqAudio = { status: 200, text: "ok" };
});
await t("descarta silêncio e frases fantasma do Whisper", async () => {
  assert.equal(cleanTranscript("."), "");
  assert.equal(cleanTranscript("Obrigado por assistir!"), "");
  assert.equal(cleanTranscript("  abra o youtube  "), "abra o youtube");
});
await t("áudio inválido = 400", async () => {
  assert.equal((await run(transcribe, { audio: "data:text/plain;base64,AAAA" })).code, 400);
});
console.log(`\n${ok} testes do copiloto passaram`);
