// Teste com fetch simulado: node tests/council.test.mjs
import assert from "node:assert/strict";
import handler from "../api/council.js";

const calls = [];
let failProvider = null;
let goneModel = null;
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  if (u.endsWith("/models")) return new Response(JSON.stringify({ data: [{ id: "whisper-large-v3" }, { id: "llama-guard-4" }, { id: "qwen/qwen3.8-27b" }, { id: "openai/gpt-oss-120b-new" }] }), { status: 200 });
  const body = JSON.parse(init.body);
  const name = u.includes("googleapis") ? "Gemini" : u.includes("groq") ? "Groq" : "Other";
  calls.push({ name, url: u, headers: init.headers, body });
  if (name === failProvider) return new Response("rate limit", { status: 429 });
  if (goneModel && body.model === goneModel) return new Response(JSON.stringify({ error: { message: `The model \`${goneModel}\` does not exist`, code: "model_not_found" } }), { status: 404 });
  const prompt = name === "Gemini" ? body.contents[0].parts[0].text : body.messages[1].content;
  let text = `<think>oculto</think>Resposta de ${name}`;
  if (prompt.includes("PRESIDENTE")) text = "## Decisão\nOk\n## Confiança\n80%";
  if (prompt.includes("Descreva de forma exaustiva")) text = "Foto 1: gato";
  return new Response(JSON.stringify(name === "Gemini"
    ? { candidates: [{ content: { parts: [{ text }] } }] }
    : { choices: [{ message: { content: text } }] }), { status: 200 });
};

const run = async (body, headers = {}, method = "POST") => {
  const r = { code: 0, json: null };
  await handler({ method, headers, body }, { status(c) { r.code = c; return this; }, json(o) { r.json = o; return this; } });
  return r;
};
const reset = () => { calls.length = 0; failProvider = null; goneModel = null; };
Object.assign(process.env, { GEMINI_API_KEY: "g", GROQ_API_KEY: "q" });
delete process.env.ACCESS_CODE;
const img = "data:image/jpeg;base64,AAAA";
let ok = 0; const t = async (n, f) => { reset(); await f(); ok++; console.log("✓", n); };

await t("só POST", async () => assert.equal((await run({}, {}, "GET")).code, 405));
await t("prompt vazio", async () => assert.equal((await run({ prompt: " " })).code, 400));
await t("texto > 6000", async () => assert.equal((await run({ prompt: "a".repeat(6001) })).code, 400));
await t("> 4 imagens", async () => assert.equal((await run({ prompt: "x", images: Array(5).fill(img) })).code, 400));
await t("mime não-imagem", async () => assert.equal((await run({ prompt: "x", images: ["data:text/html;base64,AAAA"] })).code, 400));
await t("access code", async () => {
  process.env.ACCESS_CODE = "s";
  assert.equal((await run({ prompt: "x" })).code, 401);
  assert.equal((await run({ prompt: "x" }, { "x-access-code": "s" })).code, 200);
  delete process.env.ACCESS_CODE;
});
await t("fluxo completo com debate 1", async () => {
  const r = await run({ prompt: "Pergunta", debateRounds: 1 });
  assert.equal(r.code, 200);
  assert.deepEqual(r.json.members, ["Gemini", "Groq"]);
  assert.equal(r.json.rounds.length, 2);
  assert.ok(!JSON.stringify(r.json).includes("<think>"));
  assert.ok(r.json.final.includes("## Decisão"));
  assert.equal(r.json.judge, "Gemini");
  assert.equal(calls.find((c) => c.name === "Gemini").headers["x-goog-api-key"], "g");
  assert.equal(calls.length, 2 + 2 + 1);
});
await t("debate 0 e 2", async () => {
  assert.equal((await run({ prompt: "x", debateRounds: 0 })).json.rounds.length, 1);
  reset();
  assert.equal((await run({ prompt: "x", debateRounds: 2 })).json.rounds.length, 3);
});
await t("membro falha, conselho segue", async () => {
  failProvider = "Groq";
  const r = await run({ prompt: "x", debateRounds: 1 });
  assert.equal(r.code, 200);
  assert.ok(r.json.errors.some((e) => e.name === "Groq"));
  assert.ok(r.json.final);
});
await t("presidente falha, próximo assume", async () => {
  failProvider = "Gemini";
  const r = await run({ prompt: "x", debateRounds: 0 });
  assert.equal(r.json.judge, "Groq");
});
await t("imagens usam o olho (Gemini)", async () => {
  const r = await run({ prompt: "x", images: [img], debateRounds: 0 });
  assert.equal(r.json.description, "Foto 1: gato");
  const g = calls.find((c) => c.body.contents?.[0].parts.some((p) => p.inlineData));
  assert.ok(g);
  assert.ok(calls.filter((c) => c.name === "Groq").every((c) => !JSON.stringify(c.body).includes("inlineData")));
});
await t("foto sem Gemini = 400", async () => {
  const k = process.env.GEMINI_API_KEY; delete process.env.GEMINI_API_KEY;
  assert.equal((await run({ prompt: "x", images: [img] })).code, 400);
  process.env.GEMINI_API_KEY = k;
});
await t("modelo sumiu: descobre outro e segue", async () => {
  goneModel = "openai/gpt-oss-120b";
  const r = await run({ prompt: "x", debateRounds: 0 });
  assert.equal(r.code, 200);
  assert.equal(r.json.models.Groq, "openai/gpt-oss-120b-new");
  assert.ok(!r.json.errors.some((e) => e.name === "Groq"));
});
await t("todos falham = 502", async () => {
  const f = globalThis.fetch;
  globalThis.fetch = async () => new Response("err", { status: 500 });
  const r = await run({ prompt: "x" });
  globalThis.fetch = f;
  assert.equal(r.code, 502);
});
await t("sem chaves = 500", async () => {
  const a = process.env.GEMINI_API_KEY, b = process.env.GROQ_API_KEY;
  delete process.env.GEMINI_API_KEY; delete process.env.GROQ_API_KEY;
  assert.equal((await run({ prompt: "x" })).code, 500);
  process.env.GEMINI_API_KEY = a; process.env.GROQ_API_KEY = b;
});
console.log(`\n${ok} testes passaram`);
