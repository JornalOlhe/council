// Teste com fetch simulado: node tests/council.test.mjs
import assert from "node:assert/strict";
process.env.HEDGE_AFTER_MS = "50";
const { default: handler } = await import("../api/council.js");
let slowModel = null;

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
  if (slowModel && u.includes(slowModel)) await new Promise((r) => setTimeout(r, 400));
  if (goneModel && body.model === goneModel) return new Response(JSON.stringify({ error: { message: `The model \`${goneModel}\` does not exist`, code: "model_not_found" } }), { status: 404 });
  const prompt = name === "Gemini" ? body.contents[0].parts[0].text : body.messages[1].content;
  let text = `<think>oculto</think>Resposta de ${name}`;
  if (prompt.includes("Classifique")) {}
  if (body.messages && body.messages[0].content.startsWith("Classifique")) text = /oi|valeu|tudo|beleza/i.test(prompt) ? "CONVERSA" : "CONSELHO";
  if (prompt.includes("PRESIDENTE")) text = "## Decisão\nOk\n## Confiança\n80%";
  if (prompt.includes("Descreva de forma exaustiva")) text = "Foto 1: gato";
  return new Response(JSON.stringify(name === "Gemini"
    ? { candidates: [{ content: { parts: [{ text }] } }] }
    : { choices: [{ message: { content: text } }] }), { status: 200 });
};

const run = async (body, headers = {}, method = "POST") => {
  const r = { code: 0, json: null };
  if (body && typeof body === "object" && !("mode" in body)) body = { mode: "council", ...body };
  await handler({ method, headers, body }, { status(c) { r.code = c; return this; }, json(o) { r.json = o; return this; } });
  return r;
};
const reset = () => { calls.length = 0; failProvider = null; goneModel = null; slowModel = null; };
Object.assign(process.env, { GEMINI_API_KEY: "g", GROQ_API_KEY: "q" });
delete process.env.ACCESS_CODE;
const img = "data:image/jpeg;base64,AAAA";
let ok = 0; const t = async (n, f) => { reset(); await f(); ok++; console.log("✓", n); };

await t("só POST/GET", async () => assert.equal((await run({}, {}, "PUT")).code, 405));
await t("GET mostra membros e modelos sem chaves", async () => {
  const r = await run(null, {}, "GET");
  assert.equal(r.code, 200);
  assert.equal(r.json.members[0].label, "Gemini 3.8 Flash");
  assert.ok(!JSON.stringify(r.json).includes('"g"'));
});
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
await t("auto: 'oi' vira conversa normal (1 chamada)", async () => {
  const r = await run({ prompt: "oi", mode: "auto" });
  assert.equal(r.json.mode, "chat");
  assert.equal(calls.length, 1);
  assert.equal(r.json.judge, "Groq");
  assert.equal(r.json.rounds.length, 0);
});
await t("auto: pergunta curta ambígua passa pelo classificador", async () => {
  const r = await run({ prompt: "e aí, beleza mano?", mode: "auto" });
  assert.equal(r.json.mode, "chat");
  reset();
  const r2 = await run({ prompt: "Python ou JavaScript?", mode: "auto" });
  assert.equal(r2.json.mode, "council");
});
await t("auto: pergunta longa vai direto ao conselho", async () => {
  const r = await run({ prompt: "Quero abrir uma loja online de roupas, qual plataforma usar e por quê, considerando custo?", mode: "auto", debateRounds: 0 });
  assert.equal(r.json.mode, "council");
  assert.ok(!calls.some((c) => c.body.messages && c.body.messages[0].content.startsWith("Classifique")));
});
await t("quick: uma IA só", async () => {
  const r = await run({ prompt: "Explique DNS", mode: "quick" });
  assert.equal(r.json.mode, "chat");
  assert.equal(calls.length, 1);
});
await t("principal lento: reserva entra e responde", async () => {
  slowModel = "gemini-3.8-flash";
  const r = await run({ prompt: "x", debateRounds: 0 });
  assert.equal(r.code, 200);
  const a = r.json.rounds[0].answers.find((x) => x.name === "Gemini");
  assert.equal(a.model, "gemini-3.5-flash-lite");
  assert.ok(!r.json.errors.some((e) => e.name === "Gemini"));
});
await t("principal rápido: reserva nem é chamada", async () => {
  const r = await run({ prompt: "x", debateRounds: 0 });
  assert.equal(r.json.rounds[0].answers.find((x) => x.name === "Gemini").model, "gemini-3.8-flash");
  assert.ok(!calls.some((c) => c.url.includes("flash-lite")));
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
