// IA Council - função serverless (Node 20+, sem dependências)
const CALL_TIMEOUT = 25000; // por chamada
const TOTAL_BUDGET = 56000; // orçamento total (Vercel: 60 s)
const FINAL_RESERVE = 14000; // tempo reservado para a decisão final
const MAX_TEXT = 6000;
const MAX_IMAGES = 4;

const SYSTEM = `Você é um membro de um conselho de IAs que analisa questões com rigor. Responda SEMPRE em português do Brasil.
Regras: seja direto; fundamente cada ponto; seja honesto e não bajule; não invente dados, fontes, números ou citações; separe claramente FATOS de SUPOSIÇÕES; diga "não sei" ou "incerto" quando for o caso.`;

const stripThink = (t) =>
  String(t || "").replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/<think>[\s\S]*$/i, "").trim();

export function buildProviders(env) {
  const list = [];
  if (env.GEMINI_API_KEY)
    list.push({ name: "Gemini", kind: "gemini", key: env.GEMINI_API_KEY, model: env.GEMINI_MODEL || "gemini-2.5-flash" });
  if (env.GROQ_API_KEY)
    list.push({ name: "Groq", kind: "openai", url: "https://api.groq.com/openai/v1/chat/completions", key: env.GROQ_API_KEY, model: env.GROQ_MODEL || "llama-3.3-70b-versatile" });
  if (env.OPENROUTER_API_KEY)
    list.push({ name: "OpenRouter", kind: "openai", url: "https://openrouter.ai/api/v1/chat/completions", key: env.OPENROUTER_API_KEY, model: env.OPENROUTER_MODEL || "meta-llama/llama-3.3-70b-instruct:free" });
  if (env.CEREBRAS_API_KEY)
    list.push({ name: "Cerebras", kind: "openai", url: "https://api.cerebras.ai/v1/chat/completions", key: env.CEREBRAS_API_KEY, model: env.CEREBRAS_MODEL || "llama3.1-8b" });
  if (env.GITHUB_MODELS_TOKEN)
    list.push({ name: "GitHub Models", kind: "openai", url: "https://models.github.ai/inference/chat/completions", key: env.GITHUB_MODELS_TOKEN, model: env.GITHUB_MODELS_MODEL || "openai/gpt-4o-mini" });
  return list;
}

async function timedFetch(url, init, ms) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } catch (e) {
    if (e?.name === "AbortError") throw new Error("tempo esgotado");
    throw new Error(e?.message || "falha de rede");
  } finally {
    clearTimeout(timer);
  }
}

async function errorDetail(r) {
  let body = "";
  try { body = (await r.text()).slice(0, 200); } catch {}
  return `HTTP ${r.status}${body ? ": " + body.replace(/\s+/g, " ") : ""}`;
}

async function callOpenAI(p, system, user, ms, maxTokens) {
  const r = await timedFetch(p.url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${p.key}` },
    body: JSON.stringify({
      model: p.model,
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
      temperature: 0.4,
      max_tokens: maxTokens,
    }),
  }, ms);
  if (!r.ok) throw new Error(await errorDetail(r));
  const j = await r.json();
  const text = stripThink(j?.choices?.[0]?.message?.content);
  if (!text) throw new Error("resposta vazia");
  return text;
}

async function callGemini(p, system, user, ms, maxTokens, images = []) {
  const parts = [{ text: user }];
  for (const im of images) parts.push({ inlineData: { mimeType: im.mime, data: im.data } });
  const r = await timedFetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(p.model)}:generateContent`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": p.key },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: "user", parts }],
        generationConfig: { temperature: 0.4, maxOutputTokens: maxTokens, thinkingConfig: { thinkingBudget: 0 } },
      }),
    }, ms);
  if (!r.ok) throw new Error(await errorDetail(r));
  const j = await r.json();
  const text = stripThink((j?.candidates?.[0]?.content?.parts || []).map((x) => x.text || "").join(""));
  if (!text) throw new Error("resposta vazia");
  return text;
}

function ask(p, system, user, deadline, maxTokens = 1200, images = []) {
  const ms = Math.min(CALL_TIMEOUT, deadline - Date.now());
  if (ms < 2000) return Promise.reject(new Error("sem tempo restante"));
  return p.kind === "gemini"
    ? callGemini(p, system, user, ms, maxTokens, images)
    : callOpenAI(p, system, user, ms, maxTokens);
}

function parseImages(images) {
  const out = [];
  for (const im of images) {
    const m = /^data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$/.exec(String(im || ""));
    if (!m) return null;
    out.push({ mime: m[1], data: m[2].replace(/\s/g, "") });
  }
  return out;
}

export default async function handler(req, res) {
  const send = (code, obj) => res.status(code).json(obj);
  try {
    if (req.method !== "POST") return send(405, { error: "Use o método POST." });

    const access = process.env.ACCESS_CODE;
    if (access && req.headers["x-access-code"] !== access)
      return send(401, { error: "Código de acesso inválido." });

    let body = req.body;
    if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = null; } }
    if (!body || typeof body !== "object") return send(400, { error: "Corpo da requisição inválido." });

    const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
    if (!prompt) return send(400, { error: "Escreva um prompt." });
    if (prompt.length > MAX_TEXT) return send(400, { error: `Texto longo demais (máximo ${MAX_TEXT} caracteres).` });

    const rawImages = Array.isArray(body.images) ? body.images : [];
    if (rawImages.length > MAX_IMAGES) return send(400, { error: `Máximo de ${MAX_IMAGES} imagens.` });
    const images = parseImages(rawImages);
    if (!images) return send(400, { error: "Imagem inválida (use data URL image/*;base64)." });

    const debateRounds = Math.max(0, Math.min(2, parseInt(body.debateRounds, 10) || 0));

    const providers = buildProviders(process.env);
    if (!providers.length) return send(500, { error: "Nenhuma chave de API configurada no servidor." });
    const gemini = providers.find((p) => p.kind === "gemini");
    if (images.length && !gemini)
      return send(400, { error: "Fotos exigem GEMINI_API_KEY configurada (só o Gemini enxerga imagens)." });

    const start = Date.now();
    const deadline = start + TOTAL_BUDGET;
    const errors = [];
    const rounds = [];
    let description = "";

    // 0. O OLHO
    if (images.length) {
      try {
        description = await ask(gemini,
          `${SYSTEM}\nVocê é o OLHO do conselho: as outras IAs só leem texto e dependem da sua descrição.`,
          `Descreva de forma exaustiva cada foto (Foto 1, Foto 2...). Para cada uma: cena e contexto; objetos, pessoas (sem identificar por rosto), textos/números/placas transcritos LITERALMENTE entre aspas; estado e condição (danos, desgaste, anomalias); medidas aproximadas; detalhes pequenos; o que está fora do enquadramento. Separe FATOS de INFERÊNCIAS, marque "NÃO VISÍVEL" ou "INCERTO" quando necessário.\n\nPergunta do usuário (para focar o que importa): ${prompt}`,
          deadline - FINAL_RESERVE - 15000, 2000, images);
      } catch (e) {
        return send(502, { error: `O olho (Gemini) falhou ao ler as fotos: ${e.message}` });
      }
    }

    const context = `PERGUNTA DO USUÁRIO:\n${prompt}` +
      (description ? `\n\nDESCRIÇÃO DAS FOTOS (feita pelo "olho" do conselho):\n${description}` : "");

    // 1. RODADA 1
    const r1Deadline = Math.min(deadline - FINAL_RESERVE, Date.now() + CALL_TIMEOUT);
    const r1 = await Promise.allSettled(providers.map((p) =>
      ask(p, SYSTEM, `${context}\n\nDê sua análise independente em até 300 palavras.`, r1Deadline, 700)));
    let positions = [];
    r1.forEach((r, i) => {
      if (r.status === "fulfilled") positions.push({ p: providers[i], name: providers[i].name, text: r.value });
      else errors.push({ name: providers[i].name, stage: "Rodada 1", error: r.reason.message });
    });
    if (!positions.length)
      return send(502, { error: "Todas as IAs falharam.", errors });
    rounds.push({ title: "Rodada 1 — análises independentes", answers: positions.map(({ name, text }) => ({ name, text })) });

    // 2. DEBATE
    for (let d = 1; d <= debateRounds; d++) {
      if (positions.length < 2) break;
      if (deadline - Date.now() < FINAL_RESERVE + 10000) {
        errors.push({ name: "Conselho", stage: `Debate ${d}`, error: "pulado por falta de tempo" });
        break;
      }
      const dDeadline = Math.min(deadline - FINAL_RESERVE, Date.now() + CALL_TIMEOUT);
      const prev = positions;
      const res2 = await Promise.allSettled(prev.map((me) => {
        const others = prev.filter((o) => o.name !== me.name)
          .map((o) => `### ${o.name}\n${o.text}`).join("\n\n");
        return ask(me.p, SYSTEM,
          `${context}\n\nSUA POSIÇÃO ANTERIOR:\n${me.text}\n\nPOSIÇÕES DOS OUTROS MEMBROS:\n${others}\n\nCritique as posições (erros e acertos), diga com o que concorda e discorda e entregue sua posição REVISADA em até 250 palavras. Só mude de ideia se o argumento do outro for realmente melhor.`,
          dDeadline, 600);
      }));
      const next = [];
      res2.forEach((r, i) => {
        if (r.status === "fulfilled") next.push({ p: prev[i].p, name: prev[i].name, text: r.value });
        else {
          errors.push({ name: prev[i].name, stage: `Debate ${d}`, error: r.reason.message });
          next.push(prev[i]); // mantém a posição anterior
        }
      });
      const revised = res2.filter((r) => r.status === "fulfilled").length;
      positions = next;
      if (revised)
        rounds.push({ title: `Debate ${d} — posições revisadas`, answers: res2
          .map((r, i) => r.status === "fulfilled" ? { name: prev[i].name, text: r.value } : null).filter(Boolean) });
    }

    // 3. DECISÃO FINAL
    const finalPrompt = `${context}\n\nPOSIÇÕES FINAIS DOS MEMBROS:\n${positions.map((o) => `### ${o.name}\n${o.text}`).join("\n\n")}\n\nVocê é o PRESIDENTE do conselho. Pese a qualidade dos argumentos (não o número de votos), corrija erros, não esconda divergências reais e responda em markdown, neste formato exato:\n\n## Decisão\n## Confiança\n(0–100% e por quê)\n## Onde o conselho concorda\n## Onde divergiu e como resolvi\n## Próximos passos\n## Limitações e alertas`;
    let final = "", judge = "";
    const order = [...positions.map((x) => x.p), ...providers.filter((p) => !positions.some((x) => x.p === p))];
    for (const p of order) {
      try {
        const fd = Math.max(deadline, Date.now() + 8000);
        final = await ask(p, SYSTEM, finalPrompt, Math.min(fd, start + 59000), 1500);
        judge = p.name;
        break;
      } catch (e) {
        errors.push({ name: p.name, stage: "Decisão final", error: e.message });
      }
    }
    if (!final) return send(502, { error: "Ninguém conseguiu emitir a decisão final.", errors, rounds, description });

    return send(200, { members: providers.map((p) => p.name), description, rounds, final, judge, errors });
  } catch (e) {
    return send(500, { error: "Erro interno no conselho." });
  }
}
