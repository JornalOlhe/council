// IA Council para Windows — abre o IA Council numa janela própria e deixa o Copiloto
// ver a tela, mover o mouse e digitar no PC (só para o site oficial, dentro deste app).
"use strict";
const { app, BrowserWindow, ipcMain, desktopCapturer, screen, clipboard, globalShortcut, shell, session, Menu, dialog, Notification, Tray, nativeImage } = require("electron");
const extsync = require("./extsync.js");
const { spawn } = require("child_process");
const path = require("path");
const control = require("./control.js");
const { CopilotBrowser } = require("./web.js");
const browser = new CopilotBrowser(() => win, (st) => { if (win && !win.isDestroyed()) win.webContents.send("web:panel", st); });
browser.onStop = () => { if (win && !win.isDestroyed()) win.webContents.send("web:stop"); }; // botão "Parar" da pílula na janela do Copiloto

const SITE = process.env.IA_COUNCIL_URL || "https://council-one-sigma.vercel.app";
const ORIGIN = new URL(SITE).origin;
const STOP_SHORTCUT = "CommandOrControl+Shift+Q";
let win = null;
let autoUpdater = null;
try { ({ autoUpdater } = require("electron-updater")); } catch { autoUpdater = null; }
let updateState = { state: "idle", version: app.getVersion() };
let normalBounds = null;
let stopFlag = false;

if (!app.requestSingleInstanceLock()) app.quit();
if (process.platform === "win32") app.setAppUserModelId("com.jornalolhe.iacouncil"); // notificações aparecem como "IA Council"
app.on("second-instance", () => { openWindow(); });
function openWindow() { if (!win || win.isDestroyed()) { createWindow(); return; } if (win.isMinimized()) win.restore(); win.show(); win.focus(); }

// ---------- extensão sempre atualizada (pasta fixa + o app baixa as versões novas) ----------
const EXT_DIR = path.join(app.getPath("home"), "IA-Council-Extensao");
let extState = { dir: EXT_DIR, version: extsync.localVersion(EXT_DIR), last: 0, error: "" };
async function syncExt(manual) {
  try {
    const r = await extsync.sync(EXT_DIR);
    extState = { dir: EXT_DIR, version: r.version, last: Date.now(), error: "", updated: r.updated };
    if (r.updated && r.from && Notification.isSupported()) new Notification({ title: "IA Council", body: `Extensão atualizada para ${r.version}. Ela se recarrega sozinha no navegador.`, icon: path.join(__dirname, "icon.png") }).show();
  } catch (e) { extState.error = e.message; if (manual) throw e; }
  return extState;
}
ipcMain.handle("ext:info", (e) => { guard(e); return extState; });
ipcMain.handle("ext:sync", async (e) => { guard(e); return syncExt(true); });
ipcMain.handle("ext:open", (e) => { guard(e); shell.openPath(EXT_DIR); return true; });

// fica na bandeja (perto do relógio) para manter a extensão atualizada mesmo com a janela fechada
let tray = null;
function makeTray() {
  if (tray || process.platform !== "win32") return;
  tray = new Tray(nativeImage.createFromPath(path.join(__dirname, "icon.png")).resize({ width: 16, height: 16 }));
  tray.setToolTip("IA Council");
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "Abrir IA Council", click: openWindow },
    { label: "Atualizar extensão agora", click: () => syncExt(true).then((s) => new Notification({ title: "IA Council", body: s.updated ? "Extensão atualizada para " + s.version : "A extensão já está na versão mais nova (" + s.version + ")." }).show(), (err) => dialog.showErrorBox("IA Council", "Não consegui atualizar a extensão: " + err.message)) },
    { label: "Abrir pasta da extensão", click: () => shell.openPath(EXT_DIR) },
    { type: "separator" },
    { label: "Sair", click: () => { app.isQuitting = true; app.quit(); } },
  ]));
  tray.on("click", openWindow);
}

// ---------- PowerShell persistente que move o mouse e aperta teclas (Windows) ----------
let ps = null, psBuf = "", psQueue = [], psSize = null;
function psPath() { return path.join(__dirname, "input.ps1").replace("app.asar", "app.asar.unpacked"); }
function startPS() {
  if (process.platform !== "win32") return;
  ps = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", psPath()], { windowsHide: true });
  ps.stdout.setEncoding("utf8");
  ps.stdout.on("data", (d) => {
    psBuf += d;
    let i;
    while ((i = psBuf.indexOf("\n")) >= 0) {
      const line = psBuf.slice(0, i).trim(); psBuf = psBuf.slice(i + 1);
      if (!line) continue;
      if (line.startsWith("READY")) { const p = line.split(" "); psSize = [+p[1], +p[2]]; continue; }
      const job = psQueue.shift();
      if (job) line.startsWith("OK") ? job.ok(line) : job.fail(new Error(line.replace(/^ERR\s*/, "")));
    }
  });
  ps.stderr.on("data", () => {});
  ps.on("exit", () => { ps = null; psBuf = ""; psQueue.splice(0).forEach((j) => j.fail(new Error("o controle do PC reiniciou; tente de novo"))); });
}
function psCmd(cmd) {
  if (process.platform !== "win32") return Promise.reject(new Error("Controlar o PC funciona no Windows por enquanto."));
  if (!ps) startPS();
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => { reject(new Error("o controle do PC não respondeu")); if (ps) ps.kill(); }, 15000);
    psQueue.push({ ok: (v) => { clearTimeout(t); resolve(v); }, fail: (e) => { clearTimeout(t); reject(e); } });
    ps.stdin.write(cmd + "\n");
  });
}
async function physSize() {
  if (process.platform === "win32") {
    const r = await psCmd("size"); const p = r.split(" ");
    if (+p[1] > 0) return [+p[1], +p[2]];
  }
  const d = screen.getPrimaryDisplay();
  return [Math.round(d.size.width * d.scaleFactor), Math.round(d.size.height * d.scaleFactor)];
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- só o site oficial, carregado neste app, pode usar o controle ----------
function trusted(e) {
  try { return new URL(e.senderFrame.url).origin === ORIGIN; } catch { return false; }
}
function guard(e) { if (!trusted(e)) throw new Error("origem não autorizada"); }

ipcMain.handle("pc:info", async (e) => {
  guard(e);
  const [w, h] = await physSize().catch(() => [0, 0]);
  return { ok: process.platform === "win32", os: process.platform === "win32" ? "Windows" : process.platform, width: w, height: h, version: app.getVersion(), stopShortcut: "Ctrl+Shift+Q" };
});

ipcMain.handle("pc:shot", async (e) => {
  guard(e);
  const d = screen.getPrimaryDisplay();
  const pw = Math.round(d.size.width * d.scaleFactor), ph = Math.round(d.size.height * d.scaleFactor);
  const sources = await desktopCapturer.getSources({ types: ["screen"], thumbnailSize: { width: pw, height: ph } });
  const src = sources.find((s) => s.display_id === String(d.id)) || sources[0];
  if (!src) throw new Error("não consegui capturar a tela");
  let img = src.thumbnail;
  const sz = img.getSize();
  if (sz.width > 1280) img = img.resize({ width: 1280, quality: "good" });
  const cur = screen.getCursorScreenPoint();
  return {
    image: "data:image/jpeg;base64," + img.toJPEG(64).toString("base64"),
    width: pw, height: ph,
    cursor: [Math.round(((cur.y - d.bounds.y) / d.size.height) * 1000), Math.round(((cur.x - d.bounds.x) / d.size.width) * 1000)],
  };
});

ipcMain.handle("pc:act", async (e, a) => {
  guard(e);
  if (stopFlag) { stopFlag = false; throw new Error("EMERGENCIA: parada pedida pelo atalho " + "Ctrl+Shift+Q"); }
  // parada de emergência: mouse no canto superior esquerdo
  const cur = screen.getCursorScreenPoint(), d = screen.getPrimaryDisplay();
  if (cur.x - d.bounds.x <= 2 && cur.y - d.bounds.y <= 2) throw new Error("EMERGENCIA: o mouse está no canto superior esquerdo");
  const [w, h] = await physSize();
  const steps = control.plan(a, w, h);
  if (a && a.point) await aiCursor(a.point, /click/.test(a.type) ? "click" : a.type === "type" ? "type" : "");
  for (const s of steps) {
    if (stopFlag) { stopFlag = false; throw new Error("EMERGENCIA: parada pedida pelo atalho Ctrl+Shift+Q"); }
    if (s.sleep) await sleep(s.sleep);
    else if (s.cmd) await psCmd(s.cmd);
    else if (s.paste !== undefined) {
      const prev = clipboard.readText();
      clipboard.writeText(s.paste);
      await sleep(80);
      await psCmd("key " + control.vk("ctrl") + "+" + control.vk("v"));
      await sleep(250);
      clipboard.writeText(prev);
    }
  }
  return { ok: true, done: control.describe(a) };
});

// ---------- Navegador do Copiloto (janela própria, sem mexer no mouse do usuário) ----------
ipcMain.handle("web:open", async (e, url) => { guard(e); return browser.open(String(url || "")); });
ipcMain.handle("web:snapshot", async (e) => { guard(e); return browser.snapshot(); });
ipcMain.handle("web:act", async (e, a) => { guard(e); return browser.act(a || {}); });
ipcMain.handle("web:working", async (e, on, status) => { guard(e); await browser.setWorking(!!on, String(status || "").slice(0, 80)); return true; });
ipcMain.handle("web:show", (e, focus) => { guard(e); browser.show(!!focus); return true; });
ipcMain.handle("web:close", (e) => { guard(e); browser.close(); return true; });
ipcMain.handle("web:nav", (e, d) => { guard(e); browser.nav(String(d || "")); return true; });
ipcMain.handle("web:openExternal", (e) => { guard(e); const u = browser.wc && browser.wc.getURL(); if (u && /^https?:/i.test(u)) shell.openExternal(u); return true; });

// ---------- atualização automática do app (GitHub Releases) ----------
function sendUpdate(st) {
  updateState = { ...updateState, ...st };
  if (win && !win.isDestroyed()) win.webContents.send("app:update", updateState);
}
function setupUpdates() {
  if (!autoUpdater || !app.isPackaged) return;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on("checking-for-update", () => sendUpdate({ state: "checking" }));
  autoUpdater.on("update-not-available", () => sendUpdate({ state: "idle" }));
  autoUpdater.on("update-available", (i) => sendUpdate({ state: "downloading", next: i.version, percent: 0 }));
  autoUpdater.on("download-progress", (p) => sendUpdate({ state: "downloading", percent: Math.round(p.percent || 0) }));
  autoUpdater.on("update-downloaded", (i) => {
    sendUpdate({ state: "ready", next: i.version });
    askToRestart(i.version);
  });
  autoUpdater.on("error", (e) => sendUpdate({ state: "error", message: String((e && e.message) || e).slice(0, 200) }));
  let last = 0;
  const check = () => { last = Date.now(); autoUpdater.checkForUpdates().catch(() => {}); };
  setTimeout(check, 4000);
  setInterval(check, 15 * 60 * 1000);
  // também confere quando você volta para a janela (no máx. a cada 3 min)
  app.on("browser-window-focus", () => { if (Date.now() - last > 3 * 60 * 1000) check(); });
}
// Aviso nativo do Windows quando a atualização está pronta (além da faixa no app)
let askedFor = null;
function askToRestart(version) {
  if (askedFor === version) return;
  askedFor = version;
  try {
    if (Notification.isSupported()) {
      const n = new Notification({ title: "IA Council", body: `Nova versão ${version} pronta. Clique para reiniciar e atualizar.`, icon: path.join(__dirname, "icon.png") });
      n.on("click", () => autoUpdater.quitAndInstall(true, true));
      n.show();
    }
  } catch {}
  const show = () => {
    if (normalBounds) return setTimeout(show, 30000); // não interrompe uma tarefa no PC
    if (!win || win.isDestroyed()) return;
    dialog.showMessageBox(win, {
      type: "info", title: "Atualização do IA Council",
      message: `A versão ${version} do IA Council está pronta.`,
      detail: `Você está na ${app.getVersion()}. Reiniciar agora para atualizar? Leva poucos segundos.`,
      buttons: ["Reiniciar e atualizar", "Depois"], defaultId: 0, cancelId: 1, noLink: true,
    }).then((r) => { if (r.response === 0) autoUpdater.quitAndInstall(true, true); });
  };
  setTimeout(show, 1500);
}
ipcMain.handle("app:update-state", (e) => { guard(e); return updateState; });
// "Procurar atualizações": espera a resposta de verdade e mostra o resultado numa janela do Windows (não some calado)
ipcMain.handle("app:check-update", async (e) => {
  guard(e);
  const cur = app.getVersion();
  if (!autoUpdater || !app.isPackaged) return { state: "idle", version: cur, dev: true };
  const result = await new Promise((resolve) => {
    const done = (r) => { clearTimeout(t); ["update-not-available", "update-available", "update-downloaded", "error"].forEach((ev) => autoUpdater.removeListener(ev, h[ev])); resolve(r); };
    const h = {
      "update-not-available": () => done({ state: "idle" }),
      "update-available": (i) => done({ state: "downloading", next: i.version }),
      "update-downloaded": (i) => done({ state: "ready", next: i.version }),
      error: (er) => done({ state: "error", message: String((er && er.message) || er).slice(0, 200) }),
    };
    Object.keys(h).forEach((ev) => autoUpdater.once(ev, h[ev]));
    const t = setTimeout(() => done({ state: updateState.state === "ready" ? "ready" : "timeout", next: updateState.next }), 25000);
    if (updateState.state === "ready") return done({ state: "ready", next: updateState.next });
    autoUpdater.checkForUpdates().catch((er) => done({ state: "error", message: String((er && er.message) || er).slice(0, 200) }));
  });
  const opts = { type: "info", title: "Atualização do IA Council", noLink: true };
  if (result.state === "ready") {
    const r = await dialog.showMessageBox(win, { ...opts, message: `A versão ${result.next} está pronta.`, detail: `Você está na ${cur}. Reiniciar agora para atualizar?`, buttons: ["Reiniciar e atualizar", "Depois"], defaultId: 0, cancelId: 1 });
    if (r.response === 0) setImmediate(() => autoUpdater.quitAndInstall(true, true));
  } else if (result.state === "downloading") {
    dialog.showMessageBox(win, { ...opts, message: `Baixando a versão ${result.next}…`, detail: `Você está na ${cur}. Quando terminar de baixar (menos de 1 minuto), aparece o botão "Reiniciar e atualizar".`, buttons: ["Ok"] });
  } else if (result.state === "idle") {
    dialog.showMessageBox(win, { ...opts, message: `Você já está na versão mais nova (${cur}).`, buttons: ["Ok"] });
  } else {
    dialog.showMessageBox(win, { ...opts, type: "warning", message: "Não consegui verificar agora.", detail: (result.message || "Sem resposta do servidor.") + `\n\nVocê está na ${cur}. Se continuar, baixe o instalador novo em github.com/JornalOlhe/council/releases e instale por cima.`, buttons: ["Ok"] });
  }
  return { ...updateState, ...result, version: cur, shown: true };
});
ipcMain.handle("app:install-update", (e) => {
  guard(e);
  if (updateState.state !== "ready" || !autoUpdater) return false;
  setImmediate(() => autoUpdater.quitAndInstall(true, true));
  return true;
});

// ---------- borda laranja na tela inteira enquanto o Copiloto controla o PC ----------
const GLOW_HTML = `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;height:100%;background:transparent;overflow:hidden;font-family:"Segoe UI",system-ui,sans-serif}
.g{position:fixed;inset:0;box-shadow:inset 0 0 0 3px #d97757,inset 0 0 38px 8px rgba(217,119,87,.55);animation:p 2.2s ease-in-out infinite}
@keyframes p{50%{box-shadow:inset 0 0 0 3px #e08a6b,inset 0 0 60px 14px rgba(217,119,87,.75)}}
.t{position:fixed;top:10px;left:50%;transform:translateX(-50%);background:#1f1e1dee;color:#f5f4ef;border:1px solid #d97757;border-radius:999px;padding:6px 14px;font-size:13px;display:flex;gap:8px;align-items:center;box-shadow:0 6px 24px #0007}
.d{width:8px;height:8px;border-radius:50%;background:#d97757;animation:b 1s infinite}@keyframes b{50%{opacity:.3}}
#c{position:fixed;left:0;top:0;transition:transform .45s cubic-bezier(.3,.8,.3,1);opacity:0}
#c.on{opacity:1}#c svg{display:block;filter:drop-shadow(0 2px 6px rgba(0,0,0,.5)) drop-shadow(0 0 9px rgba(217,119,87,.85))}
#c .r{position:absolute;left:-18px;top:-18px;width:38px;height:38px;border-radius:50%;border:3px solid #d97757;opacity:0}
#c.k .r{animation:rp .6s ease-out}@keyframes rp{0%{opacity:1;transform:scale(.3)}100%{opacity:0;transform:scale(1.7)}}
#c .tg{position:absolute;left:26px;top:24px;background:#d97757;color:#fff;font:600 12px/1 "Segoe UI",sans-serif;padding:5px 8px;border-radius:7px;white-space:nowrap;opacity:0}#c.ty .tg{opacity:1}
</style></head><body><div class="g"></div><div class="t"><span class="d"></span>IA Council está controlando seu PC · <b>Ctrl+Shift+Q</b> para parar</div>
<div id="c"><div class="r"></div><svg width="28" height="33" viewBox="0 0 22 26"><path d="M2 1.5v20.2l5.6-5.2 3.6 8.3 3.7-1.6-3.6-8.1 7.7-.3z" fill="#d97757" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg><div class="tg">digitando…</div></div>
<script>window.mv=function(x,y,m){var c=document.getElementById("c");c.classList.add("on");if(x!=null)c.style.transform="translate("+x+"px,"+y+"px)";c.classList.toggle("ty",m==="type");if(m==="click"){c.classList.remove("k");void c.offsetWidth;c.classList.add("k");}}</script></body></html>`;
// cursor laranja da IA na tela (por cima de tudo, fora dos prints)
async function aiCursor(point, mode) {
  if (!glow || glow.isDestroyed() || !Array.isArray(point)) return;
  const d = screen.getPrimaryDisplay(), x = Math.round(point[1] / 1000 * d.bounds.width), y = Math.round(point[0] / 1000 * d.bounds.height);
  await glow.webContents.executeJavaScript(`mv(${x},${y},"")`).catch(() => {});
  await sleep(460); // dá para ver o cursor indo até o alvo antes do clique
  if (mode) glow.webContents.executeJavaScript(`mv(null,null,${JSON.stringify(mode)})`).catch(() => {});
}
let glow = null;
function showGlow() {
  if (glow && !glow.isDestroyed()) return;
  const d = screen.getPrimaryDisplay();
  glow = new BrowserWindow({
    x: d.bounds.x, y: d.bounds.y, width: d.bounds.width, height: d.bounds.height,
    transparent: true, frame: false, focusable: false, skipTaskbar: true, resizable: false, movable: false,
    hasShadow: false, show: false, alwaysOnTop: true, backgroundColor: "#00000000",
    webPreferences: { sandbox: true, contextIsolation: true },
  });
  glow.setIgnoreMouseEvents(true);
  glow.setAlwaysOnTop(true, "screen-saver");
  glow.setContentProtection(true); // fica fora dos prints que o Copiloto analisa
  glow.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(GLOW_HTML));
  glow.once("ready-to-show", () => { if (glow && !glow.isDestroyed()) glow.showInactive(); if (win) win.moveTop(); });
}
function hideGlow() { if (glow && !glow.isDestroyed()) glow.destroy(); glow = null; }

// Durante uma tarefa, a janela vira um painel pequeno no canto, sempre por cima
ipcMain.handle("pc:mini", (e, on) => {
  guard(e);
  if (!win) return false;
  if (on) {
    if (!normalBounds) normalBounds = { bounds: win.getBounds(), max: win.isMaximized() };
    if (win.isMaximized()) win.unmaximize();
    const wa = screen.getPrimaryDisplay().workArea;
    win.setAlwaysOnTop(true, "screen-saver");
    win.setBounds({ width: 440, height: 600, x: wa.x + wa.width - 456, y: wa.y + wa.height - 616 });
    showGlow();
  } else if (normalBounds) {
    hideGlow();
    win.setAlwaysOnTop(false);
    win.setBounds(normalBounds.bounds);
    if (normalBounds.max) win.maximize();
    normalBounds = null;
    win.focus();
  }
  return true;
});

function createWindow() {
  win = new BrowserWindow({
    width: 1280, height: 820, minWidth: 380, minHeight: 480,
    title: "IA Council", backgroundColor: "#1f1e1d", autoHideMenuBar: true,
    icon: path.join(__dirname, "icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true, nodeIntegration: false, sandbox: true,
      backgroundThrottling: false, // continua trabalhando quando outro app está na frente
    },
  });
  Menu.setApplicationMenu(null);
  // abas e links abrem no navegador padrão do usuário
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^(https?:|mailto:)/i.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (ev, url) => {
    if (new URL(url).origin !== ORIGIN) { ev.preventDefault(); if (/^https?:/i.test(url)) shell.openExternal(url); }
  });
  win.webContents.on("before-input-event", (ev, input) => {
    if (input.type === "keyDown" && input.key === "F5") win.webContents.reload();
    if (input.type === "keyDown" && input.control && input.shift && input.key.toLowerCase() === "i") win.webContents.toggleDevTools();
  });
  win.on("closed", () => { browser.attached = false; browser.onResize = null; browser.working = false; });
  win.loadURL(SITE);
}

app.whenReady().then(() => {
  // microfone, notificações e área de transferência só para o site oficial
  session.defaultSession.setPermissionRequestHandler((wc, perm, cb, details) => {
    let ok = false;
    try { ok = new URL(details.requestingUrl || wc.getURL()).origin === ORIGIN; } catch {}
    cb(ok && ["media", "notifications", "clipboard-read", "clipboard-sanitized-write", "fullscreen"].includes(perm));
  });
  globalShortcut.register(STOP_SHORTCUT, () => {
    stopFlag = true;
    if (win) win.webContents.send("pc:stop");
  });
  const background = process.argv.includes("--background");
  if (!background) createWindow();
  if (process.platform === "win32") startPS();
  setupUpdates();
  makeTray();
  // inicia junto com o Windows (escondido na bandeja) só para manter a extensão e o app atualizados
  if (app.isPackaged && process.platform === "win32") app.setLoginItemSettings({ openAtLogin: true, args: ["--background"] });
  syncExt(); setInterval(syncExt, 10 * 60 * 1000);
});
app.on("will-quit", () => { globalShortcut.unregisterAll(); hideGlow(); if (ps) ps.kill(); });
app.on("window-all-closed", () => { if (process.platform !== "win32" || !tray) app.quit(); }); // no Windows continua na bandeja
