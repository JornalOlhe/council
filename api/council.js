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
    list.push({ name: "Gemini", kind: "gemini", key: env.GEMINI_API_KEY, model: env.GEMINI_MODEL || "gemini-3.8-flash" });
  if (env.GROQ_API_KEY)
    list.push({ name: "Groq", kind: "openai", url: "https://api.groq.com/openai/v1/chat/completions", key: env.GROQ_API_KEY, model: env.GROQ_MODEL || "openai/gpt-oss-120b" });
  if (env.OPENROUTER_API_KEY)
    list.push({ name: "OpenRouter", kind: "openai", url: "https://openrouter.ai/api/v1/chat/completions", key: env.OPENROUTER_API_KEY, model: env.OPENROUTER_MODEL || "nvidia/nemotron-3-ultra-550b-a55b:free" });
  if (env.CEREBRAS_API_KEY)
    list.push({ name: "Cerebras", kind: "openai", url: "https://api.cerebras.ai/v1/chat/completions", key: env.CEREBRAS_API_KEY, model: env.CEREBRAS_MODEL || "llama3.1-8b" });
  if (env.GITHUB_MODELS_TOKEN)
    list.push({ name: "GitHub Models", kind: "openai", url: "https://models.github.ai/inference/chat/completions", key: env.GITHUB_MODELS_TOKEN, model: env.GITHUB_MODELS_MODEL || "openai/gpt-4o-mini" });
  return list;
}

// Nome amigável do modelo, para mostrar na tela
export function modelLabel(id) {
  const UP = { gpt: "GPT", oss: "OSS", it: "IT", vl: "VL", ai: "AI" };
  return String(id || "").split("/").pop().replace(/:free$/, "").split(/[-_]/).filter(Boolean)
    .map((w) => UP[w.toLowerCase()] || (/^[a-z]?\d+[a-z]?\d*b?$/i.test(w) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ").replace(/GPT OSS/, "GPT-OSS");
}

const CASUAL = /^\s*(oi+|ol[aá]+|opa+|e a[ií]|eai|hey|hi|hello|bom dia|boa tarde|boa noite|tudo (bem|bom|certo)\??|como vai\??|obrigad[oa]s?|valeu+|vlw|blz|beleza|ok+|okay|show|top|legal|massa|teste|testando|kk+|haha+|rs+|tchau|at[eé] mais|quem [eé] voc[eê]s?\??|o que voc[eê]s? (faz|fazem)\??)[\s!.?,\p{Extended_Pictographic}]*$/iu;

async function classify(fast, prompt, deadline) {
  // Pergunta curta e ambígua: um modelo rápido decide se é conversa ou caso para o conselho.
  try {
    const out = await ask(fast,
      "Classifique a mensagem do usuário. Responda APENAS uma palavra: CONVERSA (saudação, agradecimento, papo casual, pergunta sobre você, mensagem sem tarefa) ou CONSELHO (pergunta, pedido, decisão, análise, qualquer tarefa real).",
      prompt, Math.min(deadline, Date.now() + 6000), 300);
    return /CONVERSA/i.test(out) && !/CONSELHO/i.test(out) ? "chat" : "council";
  } catch { return "council"; }
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

async function httpError(r) {
  let body = "";
  try { body = await r.text(); } catch {}
  const err = new Error(`HTTP ${r.status}${body ? ": " + body.replace(/\s+/g, " ").slice(0, 200) : ""}`);
  err.status = r.status;
  err.body = body;
  return err;
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
  if (!r.ok) throw await httpError(r);
  const j = await r.json();
  const text = stripThink(j?.choices?.[0]?.message?.content);
  if (!text) throw new Error("resposta vazia");
  return text;
}

// Desliga/reduz o "raciocínio" do Gemini para caber no tempo. Se o modelo recusar o parâmetro, tenta sem ele.
const THINK_LEVELS = ["minimal", "low"];
function thinkingFor(p) {
  if (/2\.5/.test(p.model)) return p.noThinkCfg ? {} : { thinkingConfig: { thinkingBudget: 0 } };
  if (!/gemini-[3-9]/.test(p.model)) return {};
  const lvl = THINK_LEVELS[p.thinkIdx || 0];
  return lvl ? { thinkingConfig: { thinkingLevel: lvl } } : {};
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
        generationConfig: { temperature: 0.4, maxOutputTokens: maxTokens, ...thinkingFor(p) },
      }),
    }, ms);
  if (!r.ok) throw await httpError(r);
  const j = await r.json();
  const text = stripThink((j?.candidates?.[0]?.content?.parts || []).map((x) => x.text || "").join(""));
  if (!text) throw new Error("resposta vazia");
  return text;
}

// ---------- descoberta automática de modelo (quando o padrão some) ----------
const MODEL_GONE = /model.?not.?found|does not exist|no longer available|not available|unavailable|not supported|decommissioned|deprecated|is not found/i;
const discovered = new Map(); // nome do provedor -> Promise<string|null>
const SKIP = /guard|whisper|tts|orpheus|safeguard|embed|audio|image|vision-only|transcri|moderation|rerank|live|native-audio/i;

function rank(ids, prefs) {
  for (const re of prefs) {
    const hit = ids.filter((id) => re.test(id)).sort().reverse();
    if (hit.length) return hit[0];
  }
  return ids[0] || null;
}

async function discoverModel(p, err, deadline, exclude = null) {
  const ms = Math.min(8000, deadline - Date.now());
  if (ms < 1500) return null;
  if (p.kind === "gemini") {
    const sug = /use (?:models\/)?([a-z0-9.\-]+)/i.exec(err?.body || "");
    if (sug && sug[1] !== p.model) return sug[1];
    const r = await timedFetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=200",
      { headers: { "x-goog-api-key": p.key } }, ms);
    if (!r.ok) return null;
    const j = await r.json();
    const ids = (j.models || [])
      .filter((m) => (m.supportedGenerationMethods || []).includes("generateContent"))
      .map((m) => String(m.name).replace(/^models\//, ""))
      .filter((id) => /gemini/.test(id) && !SKIP.test(id) && !/preview|exp/.test(id));
    return rank(ids, [/flash$/, /flash(?!-lite)/, /flash/, /pro/]);
  }
  const base = p.url.replace(/\/chat\/completions$/, "");
  const r = await timedFetch(`${base}/models`, { headers: { Authorization: `Bearer ${p.key}` } }, ms);
  if (!r.ok) return null;
  const j = await r.json();
  let ids = (j.data || j.models || []).map((m) => m.id || m.name).filter(Boolean).filter((id) => !SKIP.test(id));
  if (p.name === "OpenRouter") ids = ids.filter((id) => id.endsWith(":free"));
  if (exclude) ids = ids.filter((id) => id !== exclude);
  return rank(ids, [/gpt-oss-120b/, /gemma-4-31b|llama-3\.3-70b|70b|120b|large|ultra/i, /llama|qwen|gpt-oss|gemma|deepseek|kimi|mistral|nemotron/i]);
}

function callOnce(p, system, user, deadline, maxTokens, images) {
  const ms = Math.min(CALL_TIMEOUT, deadline - Date.now());
  if (ms < 2000) return Promise.reject(new Error("sem tempo restante"));
  return p.kind === "gemini"
    ? callGemini(p, system, user, ms, maxTokens, images)
    : callOpenAI(p, system, user, ms, maxTokens);
}

const geminiThink = new Map(); // modelo -> índice do nível aceito

async function ask(p, system, user, deadline, maxTokens = 1200, images = []) {
  const cached = discovered.get(p.name);
  if (cached) { const m = await cached; if (m) p.model = m; }
  if (p.kind === "gemini" && geminiThink.has(p.model)) p.thinkIdx = geminiThink.get(p.model);
  try {
    return await callOnce(p, system, user, deadline, maxTokens, images);
  } catch (e) {
    if (p.kind === "gemini" && e.status === 400 && /thinking/i.test(e.body || "")) {
      // nível de raciocínio recusado: tenta o próximo, depois sem o parâmetro
      p.noThinkCfg = true;
      p.thinkIdx = (p.thinkIdx || 0) + 1;
      geminiThink.set(p.model, p.thinkIdx);
      return ask(p, system, user, deadline, maxTokens, images);
    }
    if (p.name === "OpenRouter" && e.status === 429) {
      // modelo grátis congestionado: tenta outro grátis uma vez
      const alt = await discoverModel(p, e, deadline, p.model).catch(() => null);
      if (!alt) throw e;
      p.model = alt;
      return callOnce(p, system, user, deadline, maxTokens, images);
    }
    const gone = (e.status === 404 || e.status === 400) && MODEL_GONE.test(e.body || e.message);
    if (!gone) throw e;
    if (!discovered.has(p.name)) discovered.set(p.name, discoverModel(p, e, deadline).catch(() => null));
    const m = await discovered.get(p.name);
    if (!m || m === p.model) throw e;
    p.model = m;
    return callOnce(p, system, user, deadline, maxTokens, images);
  }
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
    if (req.method === "GET") {
      const ps = buildProviders(process.env);
      return send(200, { members: ps.map((p) => ({ name: p.name, model: p.model, label: modelLabel(p.model) })), locked: !!process.env.ACCESS_CODE });
    }
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

    // MODO: auto (decide sozinho), council (sempre o conselho) ou quick (uma IA só)
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
      const errs = [];
      const order = [fastest, ...providers.filter((p) => p !== fastest)];
      const team = providers.map((p) => `${p.name} (${modelLabel(p.model)})`).join(", ");
      for (const p of order) {
        if (images.length && p.kind !== "gemini") continue;
        try {
          const text = await ask(p,
            `Você é o IA Council, um assistente formado por um conselho de IAs (${team}). Responda SEMPRE em português do Brasil, de forma natural, cordial e direta, como um assistente de conversa. Para saudações e papo casual, responda em 1 ou 2 frases e ofereça ajuda. Não use títulos nem listas a menos que ajudem. Não invente fatos. Se a pessoa pedir algo que mereça análise profunda, responda o essencial e sugira mandar a pergunta completa para o conselho debater.`,
            prompt, Math.min(deadline, Date.now() + CALL_TIMEOUT), 900, images);
          return send(200, { mode: "chat", members: providers.map((x) => x.name), models: Object.fromEntries(providers.map((x) => [x.name, x.model])), description: "", rounds: [], final: text, judge: p.name, errors: errs });
        } catch (e) {
          errs.push({ name: p.name, stage: "Resposta", error: e.message });
        }
      }
      return send(502, { error: "Nenhuma IA conseguiu responder.", errors: errs });
    }
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

    return send(200, { mode: "council", members: providers.map((p) => p.name), models: Object.fromEntries(providers.map((p) => [p.name, p.model])), description, rounds, final, judge, errors });
  } catch (e) {
    return send(500, { error: "Erro interno no conselho." });
  }
}
