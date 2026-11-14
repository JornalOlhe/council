// Navegador do Copiloto: uma janela de navegador própria que o Copiloto controla por dentro
// (sem mexer no mouse/teclado do usuário), como o Claude in Chrome.
"use strict";
const { BrowserWindow, screen } = require("electron");

const KEYS = {
  enter: "Enter", tab: "Tab", escape: "Escape", esc: "Escape", backspace: "Backspace", delete: "Delete", space: "Space",
  arrowdown: "Down", down: "Down", arrowup: "Up", up: "Up", arrowleft: "Left", left: "Left", arrowright: "Right", right: "Right",
  pagedown: "PageDown", pageup: "PageUp", home: "Home", end: "End",
};
function keyCode(k) {
  const c = KEYS[String(k || "").toLowerCase().replace(/\s+/g, "")];
  if (!c) throw new Error("tecla não permitida no navegador: " + k);
  return c;
}

const GLOW_CSS = `html::after{content:"";position:fixed;inset:0;pointer-events:none;z-index:2147483647;
box-shadow:inset 0 0 0 3px #d97757,inset 0 0 28px 4px rgba(217,119,87,.55)}`;

// Lê a página: elementos clicáveis/preenchíveis visíveis (com número), texto e posição
const READ_PAGE = `(() => {
  const vw = innerWidth, vh = innerHeight, out = [];
  document.querySelectorAll("[data-iac]").forEach((e) => e.removeAttribute("data-iac"));
  const sel = 'a[href],button,input:not([type=hidden]),textarea,select,[role=button],[role=link],[role=tab],[role=menuitem],[role=checkbox],[role=radio],[role=option],[role=switch],[role=combobox],[role=searchbox],[role=textbox],[contenteditable=""],[contenteditable=true],summary,[onclick],label[for]';
  let n = 0;
  for (const el of document.querySelectorAll(sel)) {
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4 || r.bottom < 0 || r.top > vh || r.right < 0 || r.left > vw) continue;
    const st = getComputedStyle(el);
    if (st.visibility === "hidden" || st.display === "none" || (st.opacity !== "" && +st.opacity === 0)) continue;
    const cx = Math.min(vw - 1, Math.max(0, r.left + r.width / 2)), cy = Math.min(vh - 1, Math.max(0, r.top + r.height / 2));
    const top = document.elementFromPoint(cx, cy);
    if (top && top !== el && !el.contains(top) && !top.contains(el)) continue; // coberto por outra coisa
    const id = ++n;
    el.setAttribute("data-iac", id);
    const tag = el.tagName.toLowerCase(), type = (el.getAttribute("type") || "").toLowerCase();
    let label = (el.getAttribute("aria-label") || el.innerText || (type === "password" ? "" : el.value) || el.placeholder || el.title || el.alt || el.name || "").replace(/\\s+/g, " ").trim().slice(0, 80);
    if (type === "password") label = "[CAMPO DE SENHA] " + label;
    const kind = tag === "a" ? "link" : tag === "input" ? "campo:" + (type || "text") : tag === "textarea" ? "campo:texto" : tag === "select" ? "lista" : el.getAttribute("role") || tag;
    out.push({ id, kind, label, href: tag === "a" ? (el.getAttribute("href") || "").slice(0, 120) : undefined, point: [Math.round(cy / vh * 1000), Math.round(cx / vw * 1000)] });
    if (n >= 140) break;
  }
  const text = ((document.body && document.body.innerText) || "").replace(/\\n{3,}/g, "\\n\\n").slice(0, 7000);
  return { url: location.href, title: document.title, scrollY: Math.round(scrollY), scrollMax: Math.max(0, document.documentElement.scrollHeight - vh), elements: out, text };
})()`;

class CopilotBrowser {
  constructor() { this.win = null; this.glowKey = null; this.working = false; }

  ensure() {
    if (this.win && !this.win.isDestroyed()) return this.win;
    const wa = screen.getPrimaryDisplay().workArea;
    const w = Math.round(wa.width * 0.55), h = Math.round(wa.height * 0.9);
    this.win = new BrowserWindow({
      x: wa.x + wa.width - w - 12, y: wa.y + Math.round((wa.height - h) / 2), width: w, height: h,
      title: "Navegador do Copiloto", show: false, autoHideMenuBar: true, backgroundColor: "#ffffff",
      webPreferences: { partition: "persist:iac-copilot", sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false },
    });
    const wc = this.win.webContents;
    // pop-ups e "abrir em nova aba" ficam na mesma janela, para o Copiloto continuar no controle
    wc.setWindowOpenHandler(({ url }) => { if (/^https?:/i.test(url)) wc.loadURL(url); return { action: "deny" }; });
    wc.on("did-finish-load", () => this.applyGlow());
    this.win.on("page-title-updated", (e) => { e.preventDefault(); this.updateTitle(); });
    this.win.on("closed", () => { this.win = null; this.glowKey = null; });
    return this.win;
  }

  updateTitle(status) {
    if (!this.win || this.win.isDestroyed()) return;
    if (status !== undefined) this.status = status;
    const t = this.win.webContents.getTitle() || "Navegador do Copiloto";
    this.win.setTitle((this.working ? "🤖 Copiloto " + (this.status ? "— " + this.status + " · " : "trabalhando · ") : "") + t);
  }

  async applyGlow() {
    if (!this.win || this.win.isDestroyed()) return;
    const wc = this.win.webContents;
    if (this.glowKey) { try { await wc.removeInsertedCSS(this.glowKey); } catch {} this.glowKey = null; }
    if (this.working) { try { this.glowKey = await wc.insertCSS(GLOW_CSS); } catch {} }
    this.updateTitle();
  }

  async setWorking(on, status) {
    this.working = !!on;
    this.status = status || "";
    if (on) { const w = this.ensure(); if (!w.isVisible()) w.showInactive(); }
    await this.applyGlow();
  }

  show(focus) {
    const w = this.ensure();
    if (focus) { if (w.isMinimized()) w.restore(); w.show(); w.focus(); } else if (!w.isVisible()) w.showInactive();
  }

  waitLoad(ms = 9000) {
    const wc = this.win.webContents;
    return new Promise((resolve) => {
      if (!wc.isLoading()) return setTimeout(resolve, 350);
      const t = setTimeout(done, ms);
      function done() { clearTimeout(t); wc.removeListener("did-stop-loading", done); setTimeout(resolve, 350); }
      wc.once("did-stop-loading", done);
    });
  }

  async open(url) {
    const u = new URL(url);
    if (!/^https?:$/.test(u.protocol)) throw new Error("só abro endereços http/https");
    const w = this.ensure();
    if (!w.isVisible()) w.showInactive();
    await w.webContents.loadURL(u.href).catch(() => {});
    await this.waitLoad();
    return { url: w.webContents.getURL() };
  }

  async snapshot() {
    const w = this.ensure();
    if (!w.isVisible()) w.showInactive();
    const wc = w.webContents;
    if (!wc.getURL() || wc.getURL() === "about:blank") return { url: "about:blank", title: "", elements: [], text: "", image: null, empty: true };
    const page = await wc.executeJavaScript(READ_PAGE, true).catch(() => ({ url: wc.getURL(), title: wc.getTitle(), elements: [], text: "" }));
    let img = await wc.capturePage();
    if (img.isEmpty()) { await new Promise((r) => setTimeout(r, 300)); img = await wc.capturePage(); }
    const sz = img.getSize();
    if (sz.width > 1280) img = img.resize({ width: 1280, quality: "good" });
    page.image = img.isEmpty() ? null : "data:image/jpeg;base64," + img.toJPEG(68).toString("base64");
    return page;
  }

  async elementCenter(id) {
    const wc = this.win.webContents;
    const r = await wc.executeJavaScript(`(() => {
      const el = document.querySelector('[data-iac="${Number(id)}"]');
      if (!el) return null;
      el.scrollIntoView({ block: "center", inline: "center" });
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), password: (el.getAttribute("type") || "").toLowerCase() === "password" };
    })()`, true);
    if (!r) throw new Error("elemento " + id + " não está mais na página (ela mudou); vou olhar de novo");
    return r;
  }

  async clickAt(x, y) {
    const wc = this.win.webContents;
    wc.sendInputEvent({ type: "mouseMove", x, y });
    wc.sendInputEvent({ type: "mouseDown", x, y, button: "left", clickCount: 1 });
    wc.sendInputEvent({ type: "mouseUp", x, y, button: "left", clickCount: 1 });
  }

  pressKey(code) {
    const wc = this.win.webContents;
    wc.sendInputEvent({ type: "keyDown", keyCode: code });
    if (code === "Enter") wc.sendInputEvent({ type: "char", keyCode: "\r" });
    wc.sendInputEvent({ type: "keyUp", keyCode: code });
  }

  async act(a) {
    const w = this.ensure();
    const wc = w.webContents;
    const t = a && a.type;
    const before = wc.getURL();
    let done = t;
    if (t === "navigate") { await this.open(a.url); return { done: "abriu " + a.url }; }
    if (t === "back") { if (wc.navigationHistory ? wc.navigationHistory.canGoBack() : wc.canGoBack()) (wc.navigationHistory || wc).goBack(); await this.waitLoad(); return { done: "voltou" }; }
    if (t === "forward") { (wc.navigationHistory || wc).goForward(); await this.waitLoad(); return { done: "avançou" }; }
    if (t === "wait") { await new Promise((r) => setTimeout(r, Math.max(200, Math.min(5000, (Number(a.seconds) || 1) * 1000)))); return { done: "esperou" }; }
    if (t === "scroll") {
      const amt = Math.max(-25, Math.min(25, Math.round(Number(a.amount) || -5)));
      await wc.executeJavaScript(`window.scrollBy({ top: ${-amt * 120}, behavior: "instant" })`, true);
      await new Promise((r) => setTimeout(r, 350));
      return { done: "rolou" };
    }
    if (t === "key") { this.pressKey(keyCode(a.key)); done = "tecla " + a.key; }
    else if (t === "click") {
      let x, y;
      if (a.id != null) ({ x, y } = await this.elementCenter(a.id));
      else if (Array.isArray(a.point)) { const [vw, vh] = await wc.executeJavaScript("[innerWidth, innerHeight]", true); y = Math.round(a.point[0] / 1000 * vh); x = Math.round(a.point[1] / 1000 * vw); }
      else throw new Error("clique sem alvo");
      await new Promise((r) => setTimeout(r, 120));
      await this.clickAt(x, y);
      done = "clicou";
    } else if (t === "type" || t === "select") {
      if (a.id == null) throw new Error("diga em qual campo");
      const c = await this.elementCenter(a.id);
      if (c.password) throw new Error("é um campo de senha: por segurança eu não digito senhas — peça para o usuário");
      if (t === "select") {
        const ok = await wc.executeJavaScript(`(() => { const el = document.querySelector('[data-iac="${Number(a.id)}"]'); if (!el || el.tagName !== "SELECT") return false;
          const v = ${JSON.stringify(String(a.value || ""))}.toLowerCase(); const o = [...el.options].find((o) => o.text.toLowerCase().includes(v) || o.value.toLowerCase() === v);
          if (!o) return false; el.value = o.value; el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); return true; })()`, true);
        if (!ok) throw new Error("não achei essa opção na lista");
        done = "escolheu " + a.value;
      } else {
        await this.clickAt(c.x, c.y);
        await new Promise((r) => setTimeout(r, 120));
        if (a.clear !== false) {
          await wc.executeJavaScript(`(() => { const el = document.querySelector('[data-iac="${Number(a.id)}"]'); if (!el) return; el.focus();
            if ("value" in el && el.select) el.select(); else { const s = getSelection(); const r = document.createRange(); r.selectNodeContents(el); s.removeAllRanges(); s.addRange(r); } })()`, true);
        }
        await wc.insertText(String(a.text || "").slice(0, 3000));
        if (a.enter) { await new Promise((r) => setTimeout(r, 150)); this.pressKey("Enter"); }
        done = "digitou";
      }
    } else throw new Error("ação desconhecida no navegador: " + t);
    // espera a página reagir (e carregar, se navegou)
    await new Promise((r) => setTimeout(r, 450));
    if (wc.isLoading() || wc.getURL() !== before) await this.waitLoad();
    return { done };
  }
}

module.exports = { CopilotBrowser, keyCode };
