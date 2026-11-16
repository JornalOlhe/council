# Jarvis

Várias IAs (cada uma com sua chave) respondem ao seu prompt, **debatem entre si** e um **presidente** sintetiza a decisão final. Aceita até 4 fotos (o Gemini atua como "olho" e descreve as imagens para as demais).

Stack: `index.html` (JS puro) + `api/council.js` (Node 20, sem dependências). Sem build.

## Voz natural (ElevenLabs)
A conversa por voz usa a ElevenLabs quando a Vercel tem `ELEVENLABS_API_KEY` (opcional: `ELEVENLABS_VOICE_ID`, `ELEVENLABS_MODEL`; padrão `eleven_flash_v2_5`, a mais rápida). Sem a chave, usa a voz do sistema. Endpoint: `api/tts.js`.

## Rota automática
Uma IA responde na hora (oi, perguntas comuns, até ~220 caracteres); o conselho entra em decisões/comparações/análises ou quando o usuário pede ("use o conselho"). "Sem conselho" / "só uma IA" sempre responde com uma IA. O contexto da conversa só é enviado quando a pergunta depende dele.

## Copiloto dentro da conversa
Não existe mais aba separada: na conversa normal, pedidos de AÇÃO ("pesquise X e me diga", "abra…", "gere uma imagem", "crie um pdf", "me lembre…") vão para o Copiloto; perguntas vão para o Conselho. Para decidir rápido, o agente de navegador usa o Groq com a lista de elementos da página e chama a visão do Gemini só quando a página é visual ou um passo falhou; outro modelo verifica o resultado.

## Copiloto: imagens e arquivos
- `{"type":"image"}` gera imagens grátis (Pollinations, sem chave), com "Outra versão" e "Baixar".
- `{"type":"file"}` cria **PDF, DOCX, TXT, MD, CSV, HTML, JSON e ZIP** no próprio navegador (sem servidor): o PDF usa fontes padrão com acentos, o DOCX tem estilos de título/lista/tabela, o ZIP guarda vários arquivos (ex.: um site).

## Como funciona
O site chama `/api/council` em etapas (cada uma com até ~55 s, por causa do limite de 60 s da Vercel):
`start` (conversa ou conselho; o Gemini descreve as fotos) → `open` (rodada 1) → `debate` (1 a 3 vezes) → `final` (o presidente escolhido decide).
No seletor de modelos dá para trocar o presidente, o **esforço** (Baixo/Médio/Alto: raciocínio e tamanho das respostas), o número de **debates** e, em **Mais modelos**, escolher qualquer modelo que cada chave libera (`GET /api/council?list=1`).

## Copiloto (botão do capacete)
Você pede em português e ele faz:
- **No site (qualquer navegador):** abre abas e pesquisa (Google, YouTube, Maps, Mercado Livre, Spotify…), abre sites, cria lembretes com alarme, copia textos e prepara e-mails e WhatsApp.
- **No app Jarvis para Windows:** além disso, vê a tela, **identifica cada elemento** (botões, campos, ícones), **troca de apps e abas, move o mouse e digita** até cumprir o pedido — como os apps de desktop do Claude e do ChatGPT. Sem código de pareamento.

### Extensão Jarvis (Brave/Chrome/Edge) — `extension/`
Igual ao Claude in Chrome: o Copiloto abre um **grupo de abas laranja "Jarvis"** no navegador do usuário e controla as abas por depuração (`chrome.debugger`), sem mexer no mouse. A tarefa roda no service worker da extensão, então **continua mesmo se você sair da aba do site**; ao voltar, o site mostra o andamento/resultado.
- Instalação: baixar `/extension/jarvis-extension.zip` → extrair → `brave://extensions` (ou `chrome://extensions`) → Modo do desenvolvedor → Carregar sem compactação.
- **Permissão por site** (como o Claude in Chrome): antes de agir num site novo, pergunta "Permitir sempre / Só desta vez / Não permitir". As escolhas ficam em `chrome.storage.local`.
- **Atualização automática**: o app para Windows guarda a extensão em `%USERPROFILE%\Jarvis-Extensao (ou a pasta antiga IA-Council-Extensao, se já existir)`, fica na bandeja (inicia com o Windows) e baixa cada versão nova do site (`/extension/version.json`). A extensão confere o `manifest.json` do disco a cada minuto e se recarrega sozinha (`chrome.runtime.reload`), reconectando as abas do site.
- **Cursor laranja da IA**: um cursor animado mostra onde ela vai clicar (com onda no clique) e onde está digitando.
- **A aba só abre depois da permissão** e abre em segundo plano (você não é levado para ela; use "Ver aba").
- **Visual de depuração**: borda laranja pulsando + pílula "Council · passo atual · Parar" na própria aba (o Parar usa `Runtime.addBinding`).
- **Divisão de trabalho entre modelos**: o planejador (Groq) escolhe as ações, o modelo de visão (Gemini) vê a página e decide cada passo, e um VERIFICADOR (outro modelo) confere o resultado antes de terminar; se não aprovar, a tarefa continua.
- O site fala com a extensão por `content.js` (só no domínio oficial); a extensão só aceita mensagens desse domínio.
- Gerar o zip depois de mudar a extensão: `npm run build:ext`.

### Navegador do Copiloto (no app)
Como o Claude in Chrome: o Copiloto ganha uma **janela de navegador só dele** e faz tarefas em sites (pesquisar e trazer a resposta, comparar preços, preencher formulários) **sem mexer no seu mouse/teclado** — você assiste ou continua usando o PC.
- O app controla a janela por dentro (`desktop/web.js`): lê a página (lista numerada de botões/links/campos + texto) e tira print; `/api/copilot` (estágio `web`) escolhe a ação; o app clica/digita com eventos internos do navegador.
- Logins feitos nessa janela ficam salvos (sessão própria). Quando precisa de você (login, captcha, senha), ele para, traz a janela para frente e espera "Já fiz, continuar".
- Borda laranja na página enquanto trabalha; não digita em campos de senha; pede confirmação antes de comprar/enviar.

### App para Windows (`desktop/`)
- Electron que abre o site oficial numa janela própria e expõe `window.iaDesktop` (print da tela, ações de mouse/teclado, modo painel) **só para o site oficial**.
- Mouse e teclado via `input.ps1` (PowerShell + `user32.dll`, sem dependências nativas); acentos são digitados colando pela área de transferência.
- A cada passo: print → `/api/copilot` (estágio `act`, Gemini) identifica os elementos e escolhe UMA ação → o app executa → repete (máx. 25).
- Segurança: não digita senhas (para e pede), pede confirmação antes de enviar/comprar/apagar, ignora instruções que aparecem na tela. **Parar:** botão Parar, **Ctrl+Shift+Q** ou mouse no canto superior esquerdo.
- O instalador `Jarvis-Setup.exe` (com uma cópia `IA-Council-Setup.exe` para links antigos) é gerado pelo GitHub Actions (`.github/workflows/desktop.yml`) a cada mudança em `desktop/` e publicado em *Releases → desktop-latest*.

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

## Atualizações
- **Site:** cada push na `main` publica na Vercel; quem estiver com o site ou o app aberto vê a faixa **“Nova versão disponível · Atualizar”** (o site confere a cada 3 min e ao voltar para a aba).
- **App do Windows:** cada mudança em `desktop/` gera a versão `1.0.<número do build>`; o app confere a cada 15 min, baixa em segundo plano e mostra **“Reiniciar e atualizar”**.

## Desenvolvimento
```
npm run check   # node --check
npm test        # lógica com fetch simulado
```
