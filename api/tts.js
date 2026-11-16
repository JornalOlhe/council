// Jarvis — voz natural (ElevenLabs). GET -> { eleven: true|false }   POST { text } -> audio/mpeg
// Configure na Vercel: ELEVENLABS_API_KEY (obrigatória) e ELEVENLABS_VOICE_ID (opcional).
const VOICES = ["6PhbMr9YjdeOaTNz9y24", "JBFqnCBsd6RMkjVDRZzb"]; // Davi Leão (PT-BR natural) e George (padrão multilíngue)

export default async function handler(req, res) {
  const key = process.env.ELEVENLABS_API_KEY;
  if (req.method === "GET") return res.status(200).json({ eleven: !!key });
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST." });
  if (!key) return res.status(503).json({ error: "Voz ElevenLabs não configurada." });
  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = null; } }
  const text = body && typeof body.text === "string" ? body.text.trim().slice(0, 700) : "";
  if (!text) return res.status(400).json({ error: "Texto vazio." });
  const voices = [process.env.ELEVENLABS_VOICE_ID, ...VOICES].filter(Boolean);
  let last = "";
  for (const v of voices) {
    try {
      const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(v)}?output_format=mp3_44100_64`, {
        method: "POST",
        headers: { "xi-api-key": key, "Content-Type": "application/json", Accept: "audio/mpeg" },
        body: JSON.stringify({ text, model_id: process.env.ELEVENLABS_MODEL || "eleven_flash_v2_5", language_code: "pt",
          voice_settings: { stability: 0.45, similarity_boost: 0.8, style: 0.1, use_speaker_boost: true, speed: 1.05 } }),
      });
      if (r.ok) {
        const buf = Buffer.from(await r.arrayBuffer());
        res.setHeader("Content-Type", "audio/mpeg"); res.setHeader("Cache-Control", "no-store");
        return res.status(200).send(buf);
      }
      last = `HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`;
      if (r.status === 401 || r.status === 429) break; // chave inválida ou sem créditos: não adianta trocar de voz
    } catch (e) { last = e.message; }
  }
  return res.status(502).json({ error: "ElevenLabs falhou: " + last });
}
