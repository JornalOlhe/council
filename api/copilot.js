// IA Council — Copiloto
// POST { stage: "plan", text, now, tz, history }  -> { say, actions[] }   (o site executa as ações)
// POST { stage: "see", question, image }          -> { answer }           (Gemini olha a captura da tela)
import { ask, buildProviders, EFFORTS } from "./council.js";

const ENGINES = ["google", "youtube", "maps", "imagens", "noticias", "shopping", "wikipedia", "mercadolivre", "amazon", "github", "spotify", "tradutor"];
const TYPES = ["search", "open", "copy", "timer", "screen", "email", "whatsapp", "route"];

const PLAN_SYSTEM = (now, tz) => `Você é o COPILOTO do IA Council, um assistente que FAZ coisas no navegador do usuário. Responda SEMPRE em português do Brasil.
Data e hora atuais do usuário: ${now} (fuso ${tz}).

Você pode executar estas ações (o site do usuário executa por você):
- {"type":"search","engine":"google|youtube|maps|imagens|noticias|shopping|wikipedia|mercadolivre|amazon|github|spotify|tradutor","query":"..."}  abre uma aba com a pesquisa
- {"type":"open","url":"https://..."}  abre um site (use só URLs reais e conhecidas, com https)
- {"type":"copy","text":"..."}  copia um texto para a área de transferência
- {"type":"timer","seconds":600,"label":"..."}  lembrete/alarme (funciona enquanto o site estiver aberto)
- {"type":"screen","question":"..."}  pede para ver a tela do usuário (ele escolhe o que compartilhar) e responde a pergunta sobre ela
- {"type":"email","to":"","subject":"...","body":"..."}  abre um e-mail pronto no app de e-mail
- {"type":"whatsapp","text":"...","phone":""}  abre o WhatsApp com a mensagem pronta (phone só com dígitos e DDI, ou vazio)
- {"type":"route","from":"","to":"..."}  abre rota no Google Maps (from vazio = localização atual)

Você NÃO controla mouse, teclado, arquivos nem programas do computador; não finja que fez algo que não está nas ações. Se pedirem algo impossível, explique em uma frase e ofereça a ação mais próxima.
Para perguntas sobre fatos atuais (preços, notícias, clima, resultados), responda o que souber com cautela e inclua uma ação de pesquisa.
Para pedidos de texto (escrever, resumir, traduzir, calcular), responda no campo "say" e, se útil, adicione "copy".

Responda APENAS com um JSON válido, sem texto fora dele:
{"say":"resposta curta e natural para o usuário (markdown simples permitido)","actions":[ ...no máximo 4 ações... ]}`;

function extractJSON(text) {
  const s = String(text || "");
  const a = s.indexOf("{"), b = s.lastIndexOf("}");
  if (a < 0 || b <= a) return null;
  try { return JSON.parse(s.slice(a, b + 1)); } catch { return null; }
}

const str = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");

export function sanitizePlan(raw) {
  const out = { say: str(raw && raw.say, 4000), actions: [] };
  const list = Array.isArray(raw && raw.actions) ? raw.actions.slice(0, 4) : [];
  for (const a of list) {
    if (!a || !TYPES.includes(a.type)) continue;
    if (a.type === "search") {
      const q = str(a.query, 300); if (!q) continue;
      out.actions.push({ type: "search", engine: ENGINES.includes(a.engine) ? a.engine : "google", query: q });
    } else if (a.type === "open") {
      let u = str(a.url, 500);
      if (u && !/^https?:\/\//i.test(u) && /^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(u)) u = "https://" + u;
      try { const x = new URL(u); if (!/^https?:$/.test(x.protocol)) continue; out.actions.push({ type: "open", url: x.href }); } catch { continue; }
    } else if (a.type === "copy") {
      const t = str(a.text, 8000); if (t) out.actions.push({ type: "copy", text: t });
    } else if (a.type === "timer") {
      const sec = Math.round(Number(a.seconds));
      if (sec >= 1 && sec <= 86400) out.actions.push({ type: "timer", seconds: sec, label: str(a.label, 200) || "Lembrete" });
    } else if (a.type === "screen") {
      out.actions.push({ type: "screen", question: str(a.question, 1000) || "Descreva o que aparece na tela." });
    } else if (a.type === "email") {
      out.actions.push({ type: "email", to: str(a.to, 200), subject: str(a.subject, 300), body: str(a.body, 6000) });
    } else if (a.type === "whatsapp") {
      out.actions.push({ type: "whatsapp", text: str(a.text, 4000), phone: str(a.phone, 20).replace(/\D/g, "") });
    } else if (a.type === "route") {
      const to = str(a.to, 300); if (to) out.actions.push({ type: "route", from: str(a.from, 300), to });
    }
  }
  if (!out.say && !out.actions.length) out.say = "Não entendi o que fazer. Pode explicar de outro jeito?";
  return out;
}

export default async function handler(req, res) {
  const send = (code, obj) => res.status(code).json(obj);
  try {
    if (req.method !== "POST") return send(405, { error: "Use POST." });
    let body = req.body;
    if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = null; } }
    if (!body || typeof body !== "object") return send(400, { error: "Corpo inválido." });

    const providers = buildProviders(process.env);
    if (!providers.length) return send(500, { error: "Nenhuma chave de API configurada no servidor." });
    const deadline = Date.now() + 50000;

    if (body.stage === "see") {
      const m = /^data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=]+)$/.exec(String(body.image || ""));
      if (!m) return send(400, { error: "Captura de tela inválida." });
      const gemini = providers.find((p) => p.kind === "gemini");
      if (!gemini) return send(400, { error: "Ver a tela exige GEMINI_API_KEY." });
      const q = str(body.question, 1000) || "Descreva o que aparece na tela.";
      try {
        const answer = await ask(gemini,
          "Você é o copiloto do usuário e está vendo uma captura da tela dele. Responda em português do Brasil, direto e prático. Transcreva textos importantes literalmente. Se for um erro, explique a causa provável e como resolver passo a passo. Não invente o que não estiver visível.",
          q, deadline, EFFORTS.medium, 2500, [{ mime: m[1], data: m[2] }]);
        return send(200, { answer, model: gemini.lastUsed });
      } catch (e) {
        return send(502, { error: "Não consegui analisar a tela: " + e.message });
      }
    }

    // ===== plan =====
    const text = str(body.text, 6000);
    if (!text) return send(400, { error: "Diga o que o copiloto deve fazer." });
    const now = str(body.now, 80) || new Date().toISOString();
    const tz = str(body.tz, 60) || "America/Sao_Paulo";
    const hist = (Array.isArray(body.history) ? body.history : []).slice(-6)
      .map((h) => `${h && h.role === "assistant" ? "Copiloto" : "Usuário"}: ${str(h && h.text, 1200)}`).join("\n");
    const user = (hist ? `CONVERSA ANTERIOR:\n${hist}\n\n` : "") + `PEDIDO DO USUÁRIO:\n${text}`;
    const order = [
      ...providers.filter((p) => p.name === "Groq"),
      ...providers.filter((p) => p.name !== "Groq" && p.kind !== "gemini"),
      ...providers.filter((p) => p.kind === "gemini"),
    ];
    const errors = [];
    for (const p of order) {
      try {
        const out = await ask(p, PLAN_SYSTEM(now, tz), user, deadline, EFFORTS.low, 2000);
        const json = extractJSON(out);
        if (!json) { errors.push(`${p.name}: resposta fora do formato`); continue; }
        return send(200, { ...sanitizePlan(json), by: p.name, model: p.lastUsed || p.model });
      } catch (e) {
        errors.push(`${p.name}: ${e.message}`);
      }
    }
    return send(502, { error: "O copiloto não conseguiu planejar agora.", details: errors });
  } catch (e) {
    return send(500, { error: "Erro interno no copiloto." });
  }
}
