// IA Council para Windows — abre o IA Council numa janela própria e deixa o Copiloto
// ver a tela, mover o mouse e digitar no PC (só para o site oficial, dentro deste app).
"use strict";
const { app, BrowserWindow, ipcMain, desktopCapturer, screen, clipboard, globalShortcut, shell, session, Menu, dialog, Notification } = require("electron");
const { spawn } = require("child_process");
const path = require("path");
const control = require("./control.js");

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
app.on("second-instance", () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });

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
ipcMain.handle("app:check-update", async (e) => {
  guard(e);
  if (!autoUpdater || !app.isPackaged) return { state: "idle", version: app.getVersion(), dev: true };
  await autoUpdater.checkForUpdates().catch(() => {});
  return updateState;
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
</style></head><body><div class="g"></div><div class="t"><span class="d"></span>IA Council está controlando seu PC · <b>Ctrl+Shift+Q</b> para parar</div></body></html>`;
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
  createWindow();
  if (process.platform === "win32") startPS();
  setupUpdates();
});
app.on("will-quit", () => { globalShortcut.unregisterAll(); hideGlow(); if (ps) ps.kill(); });
app.on("window-all-closed", () => app.quit());
