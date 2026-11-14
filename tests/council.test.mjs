// Teste com fetch simulado: node tests/council.test.mjs
import assert from "node:assert/strict";
process.env.HEDGE_AFTER_MS = "50";
process.env.RETRY_WAIT_MS = "5";
const { default: handler } = await import("../api/council.js");

const calls = [];
let failProvider = null, goneModel = null, slowModel = null, rejectReasoning = false, busyOnce = 0;
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  if (u.includes("generativelanguage") && u.includes("/models?"))
    return new Response(JSON.stringify({ models: [{ name: "models/gemini-3.8-flash", supportedGenerationMethods: ["generateContent"] }, { name: "models/gemini-9-flash-tts", supportedGenerationMethods: ["generateContent"] }] }), { status: 200 });
  if (u.includes("geocoding-api.open-meteo")) return new Response(JSON.stringify({ results: [{ name: "Curitiba", admin1: "Paraná", country: "Brasil", latitude: -25.4, longitude: -49.3 }] }), { status: 200 });
  if (u.includes("api.open-meteo.com")) return new Response(JSON.stringify({ current: { temperature_2m: 17.2, apparent_temperature: 16, relative_humidity_2m: 80, precipitation: 0, weather_code: 3, wind_speed_10m: 9 }, daily: { temperature_2m_min: [12, 11], temperature_2m_max: [21, 23], precipitation_probability_max: [40, 10], weather_code: [3, 1] } }), { status: 200 });
  if (u.endsWith("/models"))
    return new Response(JSON.stringify({ data: [{ id: "whisper-large-v3" }, { id: "llama-guard-4" }, { id: "qwen/qwen3.8-27b" }, { id: "openai/gpt-oss-120b-new" }, { id: "x/y:free" }] }), { status: 200 });
  const body = JSON.parse(init.body);
  const name = u.includes("googleapis") ? "Gemini" : u.includes("groq") ? "Groq" : u.includes("openrouter") ? "OpenRouter" : "Other";
  calls.push({ name, url: u, headers: init.headers, body });
  if (name === failProvider) return new Response("rate limit", { status: 429 });
  if (busyOnce && name === "Groq") { busyOnce--; return new Response("high demand", { status: 503 }); }
  if (slowModel && u.includes(slowModel)) await new Promise((r) => setTimeout(r, 400));
  if (goneModel && body.model === goneModel)
    return new Response(JSON.stringify({ error: { message: `The model \`${goneModel}\` does not exist`, code: "model_not_found" } }), { status: 404 });
  if (rejectReasoning && (body.reasoning_effort || body.reasoning))
    return new Response(JSON.stringify({ error: { message: "unsupported parameter: reasoning_effort" } }), { status: 400 });
  const sys = name === "Gemini" ? body.systemInstruction.parts[0].text : body.messages[0].content;
  const prompt = name === "Gemini" ? body.contents[0].parts[0].text : body.messages[1].content;
  let text = `<think>oculto</think>Resposta de ${name}`;
  if (sys.startsWith("Classifique")) text = /oi|valeu|tudo|beleza/i.test(prompt) ? "CONVERSA" : "CONSELHO";
  if (prompt.includes("PRESIDENTE")) text = "## Decisão\nOk\n## Confiança\n80%";
  if (prompt.includes("Descreva de forma exaustiva")) text = "Foto 1: gato";
  return new Response(JSON.stringify(name === "Gemini"
    ? { candidates: [{ content: { parts: [{ text }] } }] }
    : { choices: [{ message: { content: text } }] }), { status: 200 });
};

const run = async (body, headers = {}, method = "POST", url = "/api/council") => {
  const r = { code: 0, json: null };
  await handler({ method, headers, body, url }, { status(c) { r.code = c; return this; }, json(o) { r.json = o; return this; } });
  return r;
};
const reset = () => { calls.length = 0; failProvider = null; goneModel = null; slowModel = null; rejectReasoning = false; busyOnce = 0; };
Object.assign(process.env, { GEMINI_API_KEY: "g", GROQ_API_KEY: "q", OPENROUTER_API_KEY: "o" });
delete process.env.ACCESS_CODE;
const img = "data:image/jpeg;base64,AAAA";
const pos = [{ name: "Gemini", text: "A" }, { name: "Groq", text: "B" }, { name: "OpenRouter", text: "C" }];
let ok = 0; const t = async (n, f) => { reset(); await f(); ok++; console.log("✓", n); };

// fluxo completo como o site faz
async function fullCouncil(prompt, rounds, extra = {}) {
  const s = await run({ stage: "start", prompt, mode: "council", ...extra });
  const o = await run({ stage: "open", prompt, description: s.json.description, ...extra });
  let positions = o.json.answers;
  const all = [o];
  for (let d = 1; d <= rounds; d++) {
    const r = await run({ stage: "debate", round: d, prompt, positions, ...extra });
    const map = new Map(positions.map((p) => [p.name, p]));
    r.json.answers.forEach((a) => map.set(a.name, a));
    positions = [...map.values()];
    all.push(r);
  }
  const f = await run({ stage: "final", prompt, positions, ...extra });
  return { s, o, all, f };
}

await t("método inválido", async () => assert.equal((await run({}, {}, "PUT")).code, 405));
await t("GET mostra membros, descrições e esforços (sem chaves)", async () => {
  const r = await run(null, {}, "GET");
  assert.equal(r.code, 200);
  assert.equal(r.json.members[0].label, "Gemini 3.8 Flash");
  assert.ok(r.json.members[0].desc.includes("Google"));
  assert.deepEqual(Object.keys(r.json.efforts), ["low", "medium", "high"]);
  assert.ok(!JSON.stringify(r.json).match(/"(g|q|o)"/));
});
await t("GET ?list=1 lista os modelos de cada chave", async () => {
  const r = await run(null, {}, "GET", "/api/council?list=1");
  assert.equal(r.code, 200);
  assert.deepEqual(r.json.catalog.Gemini.models.map((m) => m.id), ["gemini-3.8-flash"]);
  assert.ok(r.json.catalog.Groq.models.some((m) => m.id === "qwen/qwen3.8-27b"));
  assert.ok(!r.json.catalog.Groq.models.some((m) => /whisper|guard/.test(m.id)));
  assert.deepEqual(r.json.catalog.OpenRouter.models.map((m) => m.id), ["x/y:free"]);
});
await t("validações", async () => {
  assert.equal((await run({ prompt: " " })).code, 400);
  assert.equal((await run({ prompt: "a".repeat(40001) })).code, 400);
  assert.equal((await run({ prompt: "x", images: Array(5).fill(img) })).code, 400);
  assert.equal((await run({ prompt: "x", images: ["data:text/html;base64,AAAA"] })).code, 400);
  assert.equal((await run({ stage: "debate", prompt: "x", positions: [{ name: "Hacker", text: "x" }] })).code, 400);
});
await t("conselho completo com 3 debates", async () => {
  const { o, all, f } = await fullCouncil("Pergunta", 3);
  assert.equal(o.json.answers.length, 3);
  assert.equal(all.length, 4);
  all.slice(1).forEach((r) => assert.equal(r.json.answers.length, 3));
  assert.ok(f.json.final.includes("## Decisão"));
  assert.ok(!JSON.stringify(all.map((x) => x.json)).includes("<think>"));
  assert.ok(calls.filter((c) => c.name === "Groq").length === 4);
});
await t("presidente escolhido decide; se falhar, o próximo assume", async () => {
  let r = await run({ stage: "final", prompt: "x", positions: pos, leader: "OpenRouter" });
  assert.equal(r.json.judge, "OpenRouter");
  reset(); failProvider = "OpenRouter";
  r = await run({ stage: "final", prompt: "x", positions: pos, leader: "OpenRouter" });
  assert.equal(r.json.judge, "Gemini");
  assert.ok(r.json.errors.some((e) => e.name === "OpenRouter"));
});
await t("esforço muda raciocínio e tamanho", async () => {
  await run({ stage: "open", prompt: "x", effort: "high" });
  const g = calls.find((c) => c.name === "Groq").body;
  assert.equal(g.reasoning_effort, "high");
  assert.equal(calls.find((c) => c.name === "OpenRouter").body.reasoning.effort, "high");
  assert.equal(calls.find((c) => c.name === "Gemini").body.generationConfig.thinkingConfig.thinkingLevel, "high");
  assert.ok(g.messages[1].content.includes("500 palavras"));
  reset();
  await run({ stage: "open", prompt: "x", effort: "low" });
  assert.equal(calls.find((c) => c.name === "Groq").body.reasoning_effort, "low");
  assert.ok(calls.find((c) => c.name === "Groq").body.messages[1].content.includes("150 palavras"));
});
await t("parâmetro de raciocínio recusado: tenta sem ele", async () => {
  rejectReasoning = true;
  const r = await run({ stage: "open", prompt: "x" });
  assert.equal(r.json.answers.length, 3);
  assert.equal(r.json.errors.length, 0);
});
await t("trocar modelo de um membro (Mais modelos)", async () => {
  const r = await run({ stage: "open", prompt: "x", models: { Groq: "qwen/qwen3.8-27b", OpenRouter: "bad model!!" } });
  assert.equal(r.json.models.Groq, "qwen/qwen3.8-27b");
  assert.equal(calls.find((c) => c.name === "Groq").body.model, "qwen/qwen3.8-27b");
  assert.equal(r.json.models.OpenRouter, "nvidia/nemotron-3-ultra-550b-a55b:free");
});
await t("membro falha, conselho segue", async () => {
  failProvider = "Groq";
  const r = await run({ stage: "open", prompt: "x" });
  assert.equal(r.json.answers.length, 2);
  assert.ok(r.json.errors.some((e) => e.name === "Groq"));
});
await t("debate com 1 membro só não quebra", async () => {
  const r = await run({ stage: "debate", prompt: "x", positions: [pos[0]] });
  assert.equal(r.code, 200);
  assert.equal(r.json.answers.length, 0);
});
await t("auto: 'oi' vira conversa normal (1 chamada)", async () => {
  const r = await run({ stage: "start", prompt: "oi", mode: "auto" });
  assert.equal(r.json.mode, "chat");
  assert.equal(calls.length, 1);
  assert.equal(r.json.judge, "Groq");
});
await t("auto: curta ambígua passa pelo classificador", async () => {
  assert.equal((await run({ stage: "start", prompt: "e aí, beleza mano?", mode: "auto" })).json.mode, "chat");
  reset();
  assert.equal((await run({ stage: "start", prompt: "Python ou JavaScript?", mode: "auto" })).json.mode, "council");
});
await t("auto: pergunta longa vai direto ao conselho sem chamar IA", async () => {
  const r = await run({ stage: "start", prompt: "Quero abrir uma loja online de roupas, qual plataforma usar e por quê, considerando custo?", mode: "auto" });
  assert.equal(r.json.mode, "council");
  assert.equal(calls.length, 0);
});
await t("pergunta simples (hora/data): só o presidente, com a hora do usuário, sem classificador", async () => {
  const r = await run({ stage: "start", prompt: "que horas são?", mode: "auto", leader: "OpenRouter", now: "14/11/2026, 14:30:00", tz: "America/Sao_Paulo" });
  assert.equal(r.json.mode, "chat");
  assert.equal(r.json.judge, "OpenRouter");
  assert.equal(calls.length, 1);
  assert.ok(calls[0].body.messages[0].content.includes("14/11/2026, 14:30:00"));
});
await t("temperatura: busca o clima real da cidade citada", async () => {
  const r = await run({ stage: "start", prompt: "qual a temperatura em Curitiba agora?", mode: "auto", leader: "Groq", now: "x", tz: "America/Sao_Paulo" });
  assert.equal(r.json.mode, "chat");
  const sys = calls.find((c) => c.name === "Groq").body.messages[0].content;
  assert.ok(sys.includes("Curitiba, Paraná, Brasil: 17.2°C") && sys.includes("Open-Meteo"));
});
await t("rápido: o presidente escolhido responde sozinho", async () => {
  const r = await run({ stage: "start", prompt: "Explique DNS", mode: "quick", leader: "OpenRouter" });
  assert.equal(r.json.mode, "chat");
  assert.equal(r.json.judge, "OpenRouter");
  assert.equal(calls.length, 1);
});
await t("fotos: o olho descreve no start; Groq não recebe imagem", async () => {
  const r = await run({ stage: "start", prompt: "x", images: [img], mode: "auto" });
  assert.equal(r.json.mode, "council");
  assert.equal(r.json.description, "Foto 1: gato");
  assert.ok(calls.every((c) => c.name === "Gemini"));
});
await t("foto sem Gemini = 400", async () => {
  const k = process.env.GEMINI_API_KEY; delete process.env.GEMINI_API_KEY;
  assert.equal((await run({ prompt: "x", images: [img] })).code, 400);
  process.env.GEMINI_API_KEY = k;
});
await t("modelo sumiu: descobre outro e segue", async () => {
  goneModel = "openai/gpt-oss-120b";
  const r = await run({ stage: "open", prompt: "x" });
  assert.equal(r.json.answers.find((a) => a.name === "Groq").model, "openai/gpt-oss-120b-new");
});
await t("principal lento: reserva entra e responde", async () => {
  slowModel = "gemini-3.8-flash";
  const r = await run({ stage: "open", prompt: "x" });
  assert.equal(r.json.answers.find((x) => x.name === "Gemini").model, "gemini-3.5-flash-lite");
});
await t("principal rápido: reserva nem é chamada", async () => {
  const r = await run({ stage: "open", prompt: "x" });
  assert.equal(r.json.answers.find((x) => x.name === "Gemini").model, "gemini-3.8-flash");
  assert.ok(!calls.some((c) => c.url.includes("flash-lite")));
});
await t("503 passageiro: tenta de novo e responde", async () => {
  busyOnce = 1;
  const r = await run({ stage: "open", prompt: "x" });
  assert.equal(r.json.answers.length, 3);
  assert.equal(r.json.errors.length, 0);
});
await t("todos falham = 502", async () => {
  const f = globalThis.fetch;
  globalThis.fetch = async () => new Response("err", { status: 500 });
  const r = await run({ stage: "open", prompt: "x" });
  globalThis.fetch = f;
  assert.equal(r.code, 502);
});
await t("sem chaves = 500", async () => {
  const saved = { ...process.env };
  delete process.env.GEMINI_API_KEY; delete process.env.GROQ_API_KEY; delete process.env.OPENROUTER_API_KEY;
  assert.equal((await run({ prompt: "x" })).code, 500);
  Object.assign(process.env, saved);
});
console.log(`\n${ok} testes passaram`);
