// IA Council — função serverless (Node 20+, sem dependências)
// O conselho roda em ETAPAS (cada uma é uma chamada própria, com até ~55 s):
//   start  -> decide se é conversa ou conselho; se houver fotos, o "olho" (Gemini) descreve
//   open   -> rodada 1: cada membro dá sua análise independente
//   debate -> cada membro lê os outros, critica e revisa (1 a 3 vezes, chamada pelo site)
//   final  -> o presidente escolhido sintetiza a decisão
const STAGE_BUDGET = 55000;
const MAX_TEXT = 6000;
const MAX_IMAGES = 4;
const MODEL_ID = /^[\w.\-/:@]{1,120}$/;

export const EFFORTS = {
  low: { label: "Baixo", timeout: 22000, hedge: 12000, words: [150, 120, 350], tokens: 1600, think: "minimal", budget25: 0, reason: "low" },
  medium: { label: "Médio", timeout: 34000, hedge: 17000, words: [300, 250, 600], tokens: 3200, think: "low", budget25: 1024, reason: "medium" },
  high: { label: "Alto", timeout: 50000, hedge: 30000, words: [500, 400, 900], tokens: 7000, think: "high", budget25: 8192, reason: "high" },
};

const SYSTEM = `Você é um membro de um conselho de IAs que analisa questões com rigor. Responda SEMPRE em português do Brasil.
Regras: seja direto; fundamente cada ponto; seja honesto e não bajule; não invente dados, fontes, números ou citações; separe claramente FATOS de SUPOSIÇÕES; diga "não sei" ou "incerto" quando for o caso.`;

const DESCRIPTIONS = {
  Gemini: "Google · enxerga fotos (é o olho do conselho)",
  Groq: "Groq · raciocínio forte e respostas muito rápidas",
  OpenRouter: "OpenRouter · maior modelo grátis disponível",
  Cerebras: "Cerebras · inferência ultrarrápida",
  "GitHub Models": "GitHub · modelos da OpenAI e outros",
};

const stripThink = (t) =>
  String(t || "").replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/<think>[\s\S]*$/i, "").trim();

// ---------- nomes amigáveis ----------
export function modelLabel(id) {
  const UP = { gpt: "GPT", oss: "OSS", it: "IT", vl: "VL", ai: "AI" };
  return String(id || "").split("/").pop().replace(/:free$/, "").split(/[-_]/).filter(Boolean)
    .map((w) => UP[w.toLowerCase()] || (/^[a-z]?\d+[a-z]?\d*b?$/i.test(w) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ").replace(/GPT OSS/, "GPT-OSS");
}

// ---------- provedores ----------
export function buildProviders(env, overrides = {}) {
  const ov = (name, def) => {
    const v = overrides && overrides[name];
    return typeof v === "string" && MODEL_ID.test(v) ? v : def;
  };
  const list = [];
  if (env.GEMINI_API_KEY)
    list.push({ name: "Gemini", kind: "gemini", key: env.GEMINI_API_KEY,
      model: ov("Gemini", env.GEMINI_MODEL || "gemini-3.8-flash"),
      fallback: env.GEMINI_FALLBACK_MODEL ?? "gemini-3.5-flash-lite" });
  if (env.GROQ_API_KEY)
    list.push({ name: "Groq", kind: "openai", url: "https://api.groq.com/openai/v1/chat/completions", key: env.GROQ_API_KEY,
      model: ov("Groq", env.GROQ_MODEL || "openai/gpt-oss-120b") });
  if (env.OPENROUTER_API_KEY)
    list.push({ name: "OpenRouter", kind: "openai", url: "https://openrouter.ai/api/v1/chat/completions", key: env.OPENROUTER_API_KEY,
      model: ov("OpenRouter", env.OPENROUTER_MODEL || "nvidia/nemotron-3-ultra-550b-a55b:free") });
  if (env.CEREBRAS_API_KEY)
    list.push({ name: "Cerebras", kind: "openai", url: "https://api.cerebras.ai/v1/chat/completions", key: env.CEREBRAS_API_KEY,
      model: ov("Cerebras", env.CEREBRAS_MODEL || "gpt-oss-120b") });
  if (env.GITHUB_MODELS_TOKEN)
    list.push({ name: "GitHub Models", kind: "openai", url: "https://models.github.ai/inference/chat/completions", key: env.GITHUB_MODELS_TOKEN,
      model: ov("GitHub Models", env.GITHUB_MODELS_MODEL || "openai/gpt-4.1") });
  for (const p of list) if (p.fallback === p.model) p.fallback = null;
  return list;
}

// ---------- HTTP ----------
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

async function httpError(r) {
  let body = "";
  try { body = await r.text(); } catch {}
  const err = new Error(`HTTP ${r.status}${body ? ": " + body.replace(/\s+/g, " ").slice(0, 200) : ""}`);
  err.status = r.status;
  err.body = body;
  return err;
}

function reasoningParams(p, eff) {
  if (p.noEffort) return {};
  if (p.name === "OpenRouter") return { reasoning: { effort: eff.reason } };
  if (/gpt-oss/i.test(p.model)) return { reasoning_effort: eff.reason };
  return {};
}

async function callOpenAI(p, system, user, ms, maxTokens, eff) {
  const r = await timedFetch(p.url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${p.key}` },
    body: JSON.stringify({
      model: p.model,
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
      temperature: 0.4,
      max_tokens: maxTokens,
      ...reasoningParams(p, eff),
    }),
  }, ms);
  if (!r.ok) throw await httpError(r);
  const j = await r.json();
  const text = stripThink(j?.choices?.[0]?.message?.content);
  if (!text) throw new Error("resposta vazia");
  return text;
}

// Nível de raciocínio do Gemini; se o modelo recusar um nível, tenta o próximo e por fim nenhum.
function geminiThinking(p, eff) {
  if (/2\.5/.test(p.model)) return p.noEffort ? {} : { thinkingConfig: { thinkingBudget: eff.budget25 } };
  if (!/gemini-[3-9]/.test(p.model)) return {};
  const chain = [...new Set([eff.think, "low"])];
  const lvl = chain[p.thinkIdx || 0];
  return lvl ? { thinkingConfig: { thinkingLevel: lvl } } : {};
}

async function callGemini(p, system, user, ms, maxTokens, eff, images = []) {
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
        generationConfig: { temperature: 0.4, maxOutputTokens: maxTokens * 2, ...geminiThinking(p, eff) },
      }),
    }, ms);
  if (!r.ok) throw await httpError(r);
  const j = await r.json();
  const text = stripThink((j?.candidates?.[0]?.content?.parts || []).filter((x) => !x.thought).map((x) => x.text || "").join(""));
  if (!text) throw new Error("resposta vazia");
  return text;
}

// ---------- descoberta de modelos ----------
const MODEL_GONE = /model.?not.?found|does not exist|no longer available|not available|unavailable|not supported|decommissioned|deprecated|is not found/i;
const SKIP = /guard|whisper|tts|orpheus|safeguard|embed|audio|image|transcri|moderation|rerank|live|native-audio|veo|imagen|lyria|aqa|robotics/i;
const discovered = new Map();
const geminiThinkIdx = new Map();

function rank(ids, prefs) {
  for (const re of prefs) {
    const hit = ids.filter((id) => re.test(id)).sort().reverse();
    if (hit.length) return hit[0];
  }
  return ids[0] || null;
}

async function listModels(p, ms) {
  if (p.kind === "gemini") {
    const r = await timedFetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000",
      { headers: { "x-goog-api-key": p.key } }, ms);
    if (!r.ok) throw await httpError(r);
    const j = await r.json();
    return (j.models || [])
      .filter((m) => (m.supportedGenerationMethods || []).includes("generateContent"))
      .map((m) => String(m.name).replace(/^models\//, ""))
      .filter((id) => /gemini|gemma/.test(id) && !SKIP.test(id));
  }
  const base = p.url.replace(/\/chat\/completions$/, "");
  const url = p.name === "GitHub Models" ? "https://models.github.ai/catalog/models" : `${base}/models`;
  const r = await timedFetch(url, { headers: { Authorization: `Bearer ${p.key}` } }, ms);
  if (!r.ok) throw await httpError(r);
  const j = await r.json();
  const arr = Array.isArray(j) ? j : (j.data || j.models || []);
  let ids = arr.map((m) => m.id || m.name).filter(Boolean).filter((id) => !SKIP.test(id));
  if (p.name === "OpenRouter") ids = ids.filter((id) => id.endsWith(":free"));
  return [...new Set(ids)];
}

async function discoverModel(p, err, deadline, exclude = null) {
  const ms = Math.min(8000, deadline - Date.now());
  if (ms < 1500) return null;
  if (p.kind === "gemini") {
    const sug = /use (?:models\/)?([a-z0-9.\-]+)/i.exec(err?.body || "");
    if (sug && sug[1] !== p.model) return sug[1];
    const ids = (await listModels(p, ms)).filter((id) => /gemini/.test(id) && !/preview|exp/.test(id) && id !== exclude);
    return rank(ids, [/flash$/, /flash(?!-lite)/, /flash/, /pro/]);
  }
  let ids = await listModels(p, ms);
  if (exclude) ids = ids.filter((id) => id !== exclude);
  return rank(ids, [/gpt-oss-120b/, /ultra|120b|70b|large/i, /llama|qwen|gpt-oss|gemma|deepseek|kimi|mistral|nemotron/i]);
}

// ---------- chamada com reserva em paralelo ----------
function callRaw(p, system, user, deadline, maxTokens, eff, images) {
  const ms = Math.min(eff.timeout, deadline - Date.now());
  if (ms < 2000) return Promise.reject(new Error("sem tempo restante"));
  return p.kind === "gemini"
    ? callGemini(p, system, user, ms, maxTokens, eff, images)
    : callOpenAI(p, system, user, ms, maxTokens, eff);
}

// O modelo principal sempre tenta; se demorar mais que eff.hedge, a reserva rápida começa em paralelo.
function callOnce(p, system, user, deadline, maxTokens, eff, images) {
  p.lastUsed = p.model;
  if (!p.fallback) return callRaw(p, system, user, deadline, maxTokens, eff, images);
  const hedgeAfter = Number(process.env.HEDGE_AFTER_MS) || eff.hedge;
  return new Promise((resolve, reject) => {
    let settled = false, backupStarted = false, primaryErr = null, backupErr = null, timer;
    const win = (text, model) => { if (settled) return; settled = true; clearTimeout(timer); p.lastUsed = model; resolve(text); };
    const lose = () => {
      if (settled) return;
      if (primaryErr && (backupErr || !backupStarted)) { settled = true; clearTimeout(timer); reject(primaryErr); }
    };
    const startBackup = () => {
      if (backupStarted || settled || deadline - Date.now() < 4000) return;
      backupStarted = true;
      const b = { ...p, model: p.fallback, fallback: null, thinkIdx: 0 };
      callRaw(b, system, user, deadline, maxTokens, eff, images)
        .then((t) => win(t, b.model), (e) => { backupErr = e; if (primaryErr) lose(); });
    };
    callRaw(p, system, user, deadline, maxTokens, eff, images).then((t) => win(t, p.model), (e) => {
      primaryErr = e;
      if ((e.status === 400 || e.status === 404) && !backupStarted) return lose();
      if (!backupStarted) startBackup();
      if (!backupStarted || backupErr) lose();
    });
    timer = setTimeout(startBackup, hedgeAfter);
  });
}

async function ask(p, system, user, deadline, eff, maxTokens, images = [], depth = 0) {
  const cached = discovered.get(p.name + "|" + p.model);
  if (cached) { const m = await cached; if (m) p.model = m; }
  if (p.kind === "gemini" && geminiThinkIdx.has(p.model)) p.thinkIdx = geminiThinkIdx.get(p.model);
  try {
    return await callOnce(p, system, user, deadline, maxTokens || eff.tokens, eff, images);
  } catch (e) {
    if (depth > 3) throw e;
    const body = e.body || "";
    // parâmetro de raciocínio recusado: tenta mais simples
    if (e.status === 400 && p.kind === "gemini" && /thinking/i.test(body)) {
      p.thinkIdx = (p.thinkIdx || 0) + 1;
      geminiThinkIdx.set(p.model, p.thinkIdx);
      return ask(p, system, user, deadline, eff, maxTokens, images, depth + 1);
    }
    if (e.status === 400 && !p.noEffort && /reason|effort|unsupported|unrecognized|not support|unknown|invalid/i.test(body)) {
      p.noEffort = true;
      return ask(p, system, user, deadline, eff, maxTokens, images, depth + 1);
    }
    // modelo grátis congestionado: troca por outro grátis
    if (p.name === "OpenRouter" && e.status === 429) {
      const alt = await discoverModel(p, e, deadline, p.model).catch(() => null);
      if (!alt) throw e;
      p.model = alt;
      return callOnce(p, system, user, deadline, maxTokens || eff.tokens, eff, images);
    }
    // modelo saiu do ar: descobre outro disponível
    const gone = (e.status === 404 || e.status === 400) && MODEL_GONE.test(body || e.message);
    if (!gone) throw e;
    const k = p.name + "|" + p.model;
    if (!discovered.has(k)) discovered.set(k, discoverModel(p, e, deadline).catch(() => null));
    const m = await discovered.get(k);
    if (!m || m === p.model) throw e;
    p.model = m;
    return callOnce(p, system, user, deadline, maxTokens || eff.tokens, eff, images);
  }
}

// ---------- roteamento: conversa x conselho ----------
const CASUAL = /^\s*(oi+|ol[aá]+|opa+|e a[ií]|eai|hey|hi|hello|bom dia|boa tarde|boa noite|tudo (bem|bom|certo)\??|como vai\??|obrigad[oa]s?|valeu+|vlw|blz|beleza|ok+|okay|show|top|legal|massa|teste|testando|kk+|haha+|rs+|tchau|at[eé] mais|quem [eé] voc[eê]s?\??|o que voc[eê]s? (faz|fazem)\??)[\s!.?,\p{Extended_Pictographic}]*$/iu;

async function classify(fast, prompt, deadline) {
  try {
    const out = await ask(fast,
      "Classifique a mensagem do usuário. Responda APENAS uma palavra: CONVERSA (saudação, agradecimento, papo casual, pergunta sobre você, mensagem sem tarefa) ou CONSELHO (pergunta, pedido, decisão, análise, qualquer tarefa real).",
      prompt, Math.min(deadline, Date.now() + 8000), EFFORTS.low, 400);
    return /CONVERSA/i.test(out) && !/CONSELHO/i.test(out) ? "chat" : "council";
  } catch { return "council"; }
}

// ---------- validação ----------
function parseImages(images) {
  const out = [];
  for (const im of images) {
    const m = /^data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$/.exec(String(im || ""));
    if (!m) return null;
    out.push({ mime: m[1], data: m[2].replace(/\s/g, "") });
  }
  return out;
}

function parsePositions(raw, byName) {
  if (!Array.isArray(raw) || raw.length > 8) return null;
  const out = [];
  for (const x of raw) {
    if (!x || typeof x !== "object" || !byName.has(x.name) || typeof x.text !== "string") return null;
    out.push({ name: x.name, text: x.text.slice(0, 8000), model: typeof x.model === "string" ? x.model.slice(0, 120) : undefined });
  }
  return out;
}

const fmt = (positions) => positions.map((o) => `### ${o.name}\n${o.text}`).join("\n\n");

// ---------- catálogo (cache curto) ----------
let catalogCache = null;
async function catalog(providers) {
  if (catalogCache && Date.now() - catalogCache.at < 10 * 60 * 1000) return catalogCache.data;
  const res = await Promise.allSettled(providers.map((p) => listModels(p, 9000)));
  const data = {};
  res.forEach((r, i) => {
    data[providers[i].name] = r.status === "fulfilled"
      ? { models: r.value.sort().map((id) => ({ id, label: modelLabel(id) })) }
      : { models: [], error: r.reason?.message || "falha" };
  });
  if (res.some((r) => r.status === "fulfilled")) catalogCache = { at: Date.now(), data };
  return data;
}

// ---------- handler ----------
export default async function handler(req, res) {
  const send = (code, obj) => res.status(code).json(obj);
  try {
    const access = process.env.ACCESS_CODE;
    const authed = !access || req.headers["x-access-code"] === access;

    if (req.method === "GET") {
      const ps = buildProviders(process.env);
      const wantList = /[?&]list=1/.test(req.url || "") || req.query?.list === "1";
      if (wantList) {
        if (!authed) return send(401, { error: "Código de acesso inválido." });
        return send(200, { catalog: await catalog(ps) });
      }
      return send(200, {
        locked: !!access,
        efforts: Object.fromEntries(Object.entries(EFFORTS).map(([k, v]) => [k, v.label])),
        members: ps.map((p) => ({
          name: p.name, model: p.model, label: modelLabel(p.model), desc: DESCRIPTIONS[p.name] || p.name,
          ...(p.fallback ? { fallback: p.fallback, fallbackLabel: modelLabel(p.fallback) } : {}),
        })),
      });
    }
    if (req.method !== "POST") return send(405, { error: "Use POST ou GET." });
    if (!authed) return send(401, { error: "Código de acesso inválido." });

    let body = req.body;
    if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = null; } }
    if (!body || typeof body !== "object") return send(400, { error: "Corpo da requisição inválido." });

    const stage = ["start", "open", "debate", "final"].includes(body.stage) ? body.stage : "start";
    const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
    if (!prompt) return send(400, { error: "Escreva uma mensagem." });
    if (prompt.length > MAX_TEXT) return send(400, { error: `Texto longo demais (máximo ${MAX_TEXT} caracteres).` });

    const rawImages = Array.isArray(body.images) ? body.images : [];
    if (rawImages.length > MAX_IMAGES) return send(400, { error: `Máximo de ${MAX_IMAGES} imagens.` });
    const images = parseImages(rawImages);
    if (!images) return send(400, { error: "Imagem inválida (use data URL image/*;base64)." });

    const eff = EFFORTS[body.effort] || EFFORTS.medium;
    const overrides = body.models && typeof body.models === "object" ? body.models : {};
    const providers = buildProviders(process.env, overrides);
    if (!providers.length) return send(500, { error: "Nenhuma chave de API configurada no servidor." });
    const byName = new Map(providers.map((p) => [p.name, p]));
    const leader = byName.get(body.leader) || providers[0];
    const gemini = providers.find((p) => p.kind === "gemini");
    if (images.length && !gemini)
      return send(400, { error: "Fotos exigem GEMINI_API_KEY configurada (só o Gemini enxerga imagens)." });

    const description = typeof body.description === "string" ? body.description.slice(0, 12000) : "";
    const context = `PERGUNTA DO USUÁRIO:\n${prompt}` +
      (description ? `\n\nDESCRIÇÃO DAS FOTOS (feita pelo "olho" do conselho):\n${description}` : "");
    const deadline = Date.now() + STAGE_BUDGET;
    const errors = [];
    const info = { members: providers.map((p) => p.name), models: Object.fromEntries(providers.map((p) => [p.name, p.model])) };

    // ===== START =====
    if (stage === "start") {
      const mode = ["auto", "council", "quick"].includes(body.mode) ? body.mode : "auto";
      const fastest = providers.find((p) => p.name === "Groq") || providers.find((p) => p.kind !== "gemini") || providers[0];
      let route = mode === "quick" ? "chat" : mode === "council" ? "council" : null;
      if (!route) {
        if (images.length) route = "council";
        else if (CASUAL.test(prompt)) route = "chat";
        else if (prompt.length <= 60) route = await classify(fastest, prompt, deadline);
        else route = "council";
      }
      if (route === "chat") {
        const first = mode === "quick" ? leader : fastest;
        const order = [first, ...providers.filter((p) => p !== first)];
        const team = providers.map((p) => `${p.name} (${modelLabel(p.model)})`).join(", ");
        for (const p of order) {
          if (images.length && p.kind !== "gemini") continue;
          try {
            const text = await ask(p,
              `Você é o IA Council, um assistente formado por um conselho de IAs (${team}). Responda SEMPRE em português do Brasil, de forma natural, cordial e direta, como um assistente de conversa. Para saudações e papo casual, responda em 1 ou 2 frases e ofereça ajuda. Não use títulos nem listas a menos que ajudem. Não invente fatos. Se a pessoa pedir algo que mereça análise profunda, responda o essencial e sugira mandar a pergunta completa para o conselho debater.`,
              prompt, deadline, mode === "quick" ? eff : EFFORTS.low, mode === "quick" ? eff.tokens : 1200, images);
            return send(200, { ...info, mode: "chat", final: text, judge: p.name, judgeModel: p.lastUsed || p.model, errors });
          } catch (e) {
            errors.push({ name: p.name, stage: "Resposta", error: e.message });
          }
        }
        return send(502, { error: "Nenhuma IA conseguiu responder.", errors });
      }
      let desc = "";
      if (images.length) {
        try {
          desc = await ask(gemini,
            `${SYSTEM}\nVocê é o OLHO do conselho: as outras IAs só leem texto e dependem da sua descrição.`,
            `Descreva de forma exaustiva cada foto (Foto 1, Foto 2...). Para cada uma: cena e contexto; objetos, pessoas (sem identificar por rosto), textos/números/placas transcritos LITERALMENTE entre aspas; estado e condição (danos, desgaste, anomalias); medidas aproximadas; detalhes pequenos; o que está fora do enquadramento. Separe FATOS de INFERÊNCIAS, marque "NÃO VISÍVEL" ou "INCERTO" quando necessário.\n\nPergunta do usuário (para focar o que importa): ${prompt}`,
            deadline, eff, Math.max(eff.tokens, 3000), images);
        } catch (e) {
          return send(502, { error: `O olho (Gemini) falhou ao ler as fotos: ${e.message}` });
        }
      }
      return send(200, { ...info, mode: "council", description: desc, eyeModel: images.length ? gemini.lastUsed : undefined, errors });
    }

    // ===== OPEN (rodada 1) =====
    if (stage === "open") {
      const r = await Promise.allSettled(providers.map((p) =>
        ask(p, SYSTEM, `${context}\n\nDê sua análise independente em até ${eff.words[0]} palavras.`, deadline, eff)));
      const answers = [];
      r.forEach((x, i) => {
        if (x.status === "fulfilled") answers.push({ name: providers[i].name, model: providers[i].lastUsed, text: x.value });
        else errors.push({ name: providers[i].name, stage: "Rodada 1", error: x.reason.message });
      });
      if (!answers.length) return send(502, { error: "Todas as IAs falharam.", errors });
      return send(200, { ...info, answers, errors });
    }

    const positions = parsePositions(body.positions, byName);
    if (!positions || !positions.length) return send(400, { error: "Posições inválidas." });

    // ===== DEBATE =====
    if (stage === "debate") {
      const round = Math.max(1, Math.min(3, parseInt(body.round, 10) || 1));
      if (positions.length < 2) return send(200, { ...info, answers: [], errors: [{ name: "Conselho", stage: `Debate ${round}`, error: "só 1 membro respondeu; não há com quem debater" }] });
      const r = await Promise.allSettled(positions.map((me) => {
        const others = fmt(positions.filter((o) => o.name !== me.name));
        return ask(byName.get(me.name), SYSTEM,
          `${context}\n\nSUA POSIÇÃO ANTERIOR:\n${me.text}\n\nPOSIÇÕES DOS OUTROS MEMBROS:\n${others}\n\nEsta é a rodada de debate ${round}. Critique as posições (erros e acertos), diga com o que concorda e discorda e entregue sua posição REVISADA em até ${eff.words[1]} palavras. Só mude de ideia se o argumento do outro for realmente melhor.`,
          deadline, eff);
      }));
      const answers = [];
      r.forEach((x, i) => {
        const p = byName.get(positions[i].name);
        if (x.status === "fulfilled") answers.push({ name: p.name, model: p.lastUsed, text: x.value });
        else errors.push({ name: p.name, stage: `Debate ${round}`, error: x.reason.message });
      });
      return send(200, { ...info, answers, errors });
    }

    // ===== FINAL =====
    const finalPrompt = `${context}\n\nPOSIÇÕES FINAIS DOS MEMBROS:\n${fmt(positions)}\n\nVocê é o PRESIDENTE do conselho. Pese a qualidade dos argumentos (não o número de votos), corrija erros, não esconda divergências reais e responda em markdown (até ${eff.words[2]} palavras), neste formato exato:\n\n## Decisão\n## Confiança\n(0–100% e por quê)\n## Onde o conselho concorda\n## Onde divergiu e como resolvi\n## Próximos passos\n## Limitações e alertas`;
    const order = [leader, ...providers.filter((p) => p !== leader)];
    for (const p of order) {
      try {
        const final = await ask(p, SYSTEM, finalPrompt, deadline, eff, Math.round(eff.tokens * 1.5));
        return send(200, { ...info, final, judge: p.name, judgeModel: p.lastUsed || p.model, errors });
      } catch (e) {
        errors.push({ name: p.name, stage: "Decisão final", error: e.message });
      }
    }
    return send(502, { error: "Ninguém conseguiu emitir a decisão final.", errors });
  } catch (e) {
    return send(500, { error: "Erro interno no conselho." });
  }
}
