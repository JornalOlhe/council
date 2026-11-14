// IA Council — transcrição de voz
// POST { audio: "data:audio/webm;base64,..." } -> { text }
// Usa o Whisper do Groq (grátis). Sem Groq, usa o Gemini, que também entende áudio.
import { ask, buildProviders, EFFORTS } from "./council.js";

const EXT = { webm: "webm", ogg: "ogg", mp4: "mp4", mpeg: "mp3", mp3: "mp3", wav: "wav", "x-wav": "wav", aac: "m4a", "x-m4a": "m4a", m4a: "m4a" };

async function groqWhisper(key, mime, buf, model) {
  const sub = (mime.split("/")[1] || "webm").split(";")[0];
  const form = new FormData();
  form.append("file", new Blob([buf], { type: mime.split(";")[0] }), "audio." + (EXT[sub] || "webm"));
  form.append("model", model);
  form.append("language", "pt");
  form.append("response_format", "json");
  form.append("temperature", "0");
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 40000);
  try {
    const r = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
      method: "POST", headers: { Authorization: `Bearer ${key}` }, body: form, signal: ctrl.signal,
    });
    const t = await r.text();
    if (!r.ok) { const e = new Error(`HTTP ${r.status}: ${t.slice(0, 160)}`); e.status = r.status; throw e; }
    return String(JSON.parse(t).text || "").trim();
  } finally {
    clearTimeout(timer);
  }
}

// O Whisper às vezes "inventa" frases no silêncio; descarta pontuação solta e essas frases conhecidas.
const GHOST = /^(obrigad[oa] por assistir[!.]*|legendas? (pela|por) .*|inscreva-se.*|tchau[!.]*|\.+|amara\.org.*|thanks? for watching[!.]*|you)$/i;
export function cleanTranscript(t) {
  const s = String(t || "").replace(/\s+/g, " ").trim();
  if (!s || /^[\s.,!?…\-–—"'“”]*$/.test(s) || GHOST.test(s)) return "";
  return s;
}

export default async function handler(req, res) {
  const send = (code, obj) => res.status(code).json(obj);
  try {
    if (req.method !== "POST") return send(405, { error: "Use POST." });
    let body = req.body;
    if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = null; } }
    const m = /^data:(audio\/[a-zA-Z0-9.+-]+(?:;[^,]*)?);base64,([A-Za-z0-9+/=]+)$/.exec(String(body && body.audio || ""));
    if (!m) return send(400, { error: "Áudio inválido." });
    const mime = m[1].replace(/;base64$/, "");
    const buf = Buffer.from(m[2], "base64");
    if (buf.length < 800) return send(200, { text: "" });
    if (buf.length > 4 * 1024 * 1024) return send(400, { error: "Áudio longo demais (máx. ~4 MB)." });

    const errors = [];
    if (process.env.GROQ_API_KEY) {
      for (const model of [process.env.GROQ_WHISPER_MODEL || "whisper-large-v3-turbo", "whisper-large-v3"]) {
        try { return send(200, { text: cleanTranscript(await groqWhisper(process.env.GROQ_API_KEY, mime, buf, model)), by: "Groq " + model }); }
        catch (e) { errors.push(e.message); if (e.status && e.status !== 404 && e.status !== 400) break; }
      }
    }
    const gemini = buildProviders(process.env).find((p) => p.kind === "gemini");
    if (gemini) {
      try {
        const text = await ask(gemini,
          "Você é um transcritor. Transcreva LITERALMENTE o áudio em português do Brasil, com pontuação. Responda só com a transcrição, sem comentários. Se não houver fala, responda vazio.",
          "Transcreva este áudio.", Date.now() + 45000, EFFORTS.low, 2000, [{ mime: mime.split(";")[0], data: m[2] }]);
        return send(200, { text: cleanTranscript(text.replace(/^["“]|["”]$/g, "")), by: "Gemini" });
      } catch (e) { errors.push(e.message); }
    }
    return send(502, { error: "Não consegui transcrever o áudio.", details: errors });
  } catch (e) {
    return send(500, { error: "Erro interno na transcrição." });
  }
}
