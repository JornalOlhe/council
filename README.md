# IA Council

Várias IAs (cada uma com sua chave) respondem ao seu prompt, **debatem entre si** e um **presidente** sintetiza a decisão final. Aceita até 4 fotos (o Gemini atua como "olho" e descreve as imagens para as demais).

Stack: `index.html` (JS puro) + `api/council.js` (Node 20, sem dependências). Sem build.

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
- **No app IA Council para Windows:** além disso, vê a tela, **identifica cada elemento** (botões, campos, ícones), **troca de apps e abas, move o mouse e digita** até cumprir o pedido — como os apps de desktop do Claude e do ChatGPT. Sem código de pareamento.

### Extensão IA Council (Brave/Chrome/Edge) — `extension/`
Igual ao Claude in Chrome: o Copiloto abre um **grupo de abas laranja "Council"** no navegador do usuário e controla as abas por depuração (`chrome.debugger`), sem mexer no mouse. A tarefa roda no service worker da extensão, então **continua mesmo se você sair da aba do site**; ao voltar, o site mostra o andamento/resultado.
- Instalação: baixar `/extension/ia-council-extension.zip` → extrair → `brave://extensions` (ou `chrome://extensions`) → Modo do desenvolvedor → Carregar sem compactação.
- **Permissão por site** (como o Claude in Chrome): antes de agir num site novo, pergunta "Permitir sempre / Só desta vez / Não permitir". As escolhas ficam em `chrome.storage.local`.
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
- O instalador `IA-Council-Setup.exe` é gerado pelo GitHub Actions (`.github/workflows/desktop.yml`) a cada mudança em `desktop/` e publicado em *Releases → desktop-latest*.

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
