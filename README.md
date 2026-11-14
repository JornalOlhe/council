# IA Council

Várias IAs (cada uma com sua chave) respondem ao seu prompt, **debatem entre si** e um **presidente** sintetiza a decisão final. Aceita até 4 fotos (o Gemini atua como "olho" e descreve as imagens para as demais).

Stack: `index.html` (JS puro) + `api/council.js` (Node 20, sem dependências). Sem build.

## Como funciona
O site chama `/api/council` em etapas (cada uma com até ~55 s, por causa do limite de 60 s da Vercel):
`start` (conversa ou conselho; o Gemini descreve as fotos) → `open` (rodada 1) → `debate` (1 a 3 vezes) → `final` (o presidente escolhido decide).
No seletor de modelos dá para trocar o presidente, o **esforço** (Baixo/Médio/Alto: raciocínio e tamanho das respostas), o número de **debates** e, em **Mais modelos**, escolher qualquer modelo que cada chave libera (`GET /api/council?list=1`).

## Copiloto (botão do capacete)
Você pede em português e ele **faz no seu navegador**: abre abas e pesquisa (Google, YouTube, Maps, Mercado Livre, Spotify…), abre sites, **vê sua tela** quando você compartilha (o Gemini analisa a captura), cria lembretes com alarme, copia textos e prepara e-mails e mensagens de WhatsApp. Pedidos claros ("pesquise…", "abra o YouTube", "me lembre em 10 min") são entendidos na hora; os outros passam pela IA (`/api/copilot`). Por segurança, nenhum site consegue controlar mouse, teclado ou arquivos do computador.

## Voz e anexos
O microfone grava e transcreve com o Whisper do Groq (`/api/transcribe`), com o Gemini como reserva. O "+" aceita fotos e arquivos de texto, CSV e código.

## Deploy
1. Suba este repositório no GitHub.
2. Em [vercel.com](https://vercel.com) → **Add New → Project** → importe o repositório (sem framework, sem build).
4. **Deploy**. Abra a URL, escreva um prompt e clique em *Convocar o conselho*.

## Onde conseguir chaves grátis
| Variável | Onde |
|---|---|
| `GEMINI_API_KEY` | https://aistudio.google.com/apikey |
| `GROQ_API_KEY` | https://console.groq.com/keys |
| `OPENROUTER_API_KEY` | https://openrouter.ai/keys (use modelos `:free`) |
| `CEREBRAS_API_KEY` | https://cloud.cerebras.ai |
| `GITHUB_MODELS_TOKEN` | https://github.com/settings/tokens (token com permissão `models:read`) |

Os modelos podem ser trocados por `GEMINI_MODEL`, `GROQ_MODEL`, `OPENROUTER_MODEL`, `CEREBRAS_MODEL`, `GITHUB_MODELS_MODEL`.

## Desenvolvimento
```
npm run check   # node --check
npm test        # lógica com fetch simulado
```
