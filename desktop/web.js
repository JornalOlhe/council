// Navegador do Copiloto: uma janela de navegador própria que o Copiloto controla por dentro
// (sem mexer no mouse/teclado do usuário), como o Claude in Chrome.
"use strict";
const { WebContentsView } = require("electron");

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

// Visual igual ao Claude in Chrome / extensão: borda laranja, pílula "Jarvis · passo · Parar" e cursor laranja
const GLOW = `(() => { if (document.getElementById("iac-pill")) return; { const old = document.getElementById("iac-glow"); if (old) old.remove(); } const s = document.createElement("style"); s.id = "iac-glow";
  s.textContent = 'html::after{content:"";position:fixed;inset:0;pointer-events:none;z-index:2147483646;box-shadow:inset 0 0 0 3px #d97757,inset 0 0 34px 6px rgba(217,119,87,.5);animation:iacg 2.4s ease-in-out infinite}' +
    '@keyframes iacg{50%{box-shadow:inset 0 0 0 2px #d97757,inset 0 0 18px 2px rgba(217,119,87,.35)}}' +
    '#iac-pill{position:fixed;left:50%;bottom:18px;transform:translateX(-50%);z-index:2147483647;display:flex;align-items:center;gap:10px;padding:7px 7px 7px 14px;border-radius:999px;background:#262624;color:#f3f1ea;font:500 13px/1.2 system-ui,Segoe UI,sans-serif;box-shadow:0 8px 28px rgba(0,0,0,.35),0 0 0 1px rgba(217,119,87,.7)}' +
    '#iac-pill i{flex:none;width:8px;height:8px;border-radius:50%;background:#d97757;animation:iacp 1.1s ease-in-out infinite}@keyframes iacp{50%{opacity:.25}}' +
    '#iac-pill b{font-weight:650;color:#d97757}#iac-pill span{max-width:44vw;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:#d6d3cb}' +
    '#iac-pill button{all:unset;cursor:pointer;background:#d97757;color:#fff;border-radius:999px;padding:5px 13px;font-weight:600}' +
    '#iac-cursor{position:fixed;left:0;top:0;z-index:2147483647;pointer-events:none;transition:transform .5s cubic-bezier(.22,.9,.3,1)}' +
    '#iac-cursor svg{display:block;filter:drop-shadow(0 1px 2px rgba(0,0,0,.35))}' +
    '#iac-cursor .rp{position:absolute;left:-9px;top:-9px;width:20px;height:20px;border-radius:50%;background:rgba(217,119,87,.4);opacity:0}' +
    '#iac-cursor.clk .rp{animation:iacr .5s ease-out}@keyframes iacr{0%{opacity:1;transform:scale(.4)}100%{opacity:0;transform:scale(1.9)}}' +
    '#iac-cursor .tg{position:absolute;left:14px;top:19px;background:#d97757;color:#fff;font:600 11px/1 system-ui,Segoe UI,sans-serif;padding:4px 7px;border-radius:3px 9px 9px 9px;white-space:nowrap;box-shadow:0 1px 3px rgba(0,0,0,.3);transition:opacity .3s}' +
    '#iac-cursor.typ .tg:after{content:" · digitando"}#iac-cursor.think .tg:after{content:" · lendo…"}' +
    '#iac-cursor .w{transition:opacity .3s}#iac-cursor.idle .w,#iac-cursor.idle .tg{opacity:.45}';
  (document.head || document.documentElement).appendChild(s);
  const p = document.createElement("div"); p.id = "iac-pill";
  const dot = document.createElement("i"), b = document.createElement("b"), sp = document.createElement("span"), bt = document.createElement("button");
  b.textContent = "Jarvis"; sp.textContent = window.__iacNow || "trabalhando nesta janela…"; bt.textContent = "Parar";
  bt.onclick = () => { console.log("__iacStop__"); sp.textContent = "parando…"; };
  p.append(dot, b, sp, bt); (document.body || document.documentElement).appendChild(p);
  if (document.getElementById("iac-cursor")) { document.getElementById("iac-cursor").classList.remove("idle"); return; }
  const c = document.createElement("div"); c.id = "iac-cursor";
  const ns = "http://www.w3.org/2000/svg", svg = document.createElementNS(ns, "svg"), pa = document.createElementNS(ns, "path");
  svg.setAttribute("width", "18"); svg.setAttribute("height", "22"); svg.setAttribute("viewBox", "0 0 18 22");
  pa.setAttribute("d", "M2 2v16.5l4.3-4.1 2.9 6.6 2.6-1.1-2.9-6.5h6.1z"); pa.setAttribute("fill", "#d97757"); pa.setAttribute("stroke", "#fff"); pa.setAttribute("stroke-width", "1.5"); pa.setAttribute("stroke-linejoin", "round");
  svg.appendChild(pa); const rp = document.createElement("div"); rp.className = "rp"; const tg = document.createElement("div"); tg.className = "tg"; tg.textContent = "Jarvis";
  const wr = document.createElement("div"); wr.className = "w"; wr.append(svg);
  c.append(rp, wr, tg); (document.body || document.documentElement).appendChild(c);
  const o = window.__iacXY || [innerWidth * 0.55, innerHeight * 0.35]; c.style.transform = "translate(" + o[0] + "px," + o[1] + "px)";
})()`;
// ao terminar: some a borda e a pílula, o cursor laranja FICA (mais claro) onde parou
const UNGLOW = `(() => { const pl = document.getElementById("iac-pill"); if (pl) pl.remove();
  const g = document.getElementById("iac-glow"); if (g) g.textContent = g.textContent.replace(/html::after\\{[^}]*\\}/, "");
  const c = document.getElementById("iac-cursor"); if (c) { c.classList.remove("think", "typ"); c.classList.add("idle"); } })()`;
const pillText = (t) => `(() => { window.__iacNow = ${JSON.stringify(String(t || "").slice(0, 140))}; const s = document.querySelector("#iac-pill span"); if (s) s.textContent = window.__iacNow; })()`;
const moveCursor = (x, y, mode) => `(() => { const c = document.getElementById("iac-cursor"); if (!c) return;
  ${x == null ? "" : `window.__iacXY = [${x}, ${y}]; c.style.transform = "translate(${x}px,${y}px)";`}
  c.classList.remove("idle"); c.classList.toggle("typ", ${JSON.stringify(mode || "")} === "type"); c.classList.toggle("think", ${JSON.stringify(mode || "")} === "think");
  if (${JSON.stringify(mode || "")} === "click") { c.classList.remove("clk"); void c.offsetWidth; c.classList.add("clk"); } })()`;

// Lê a página: elementos clicáveis/preenchíveis visíveis (com número), texto e posição
const READ_PAGE = `(() => {
  const vw = innerWidth, vh = innerHeight, out = [];
  document.querySelectorAll("[data-iac]").forEach((e) => e.removeAttribute("data-iac"));
  const sel = 'a[href],button,input:not([type=hidden]),textarea,select,[role=button],[role=link],[role=tab],[role=menuitem],[role=checkbox],[role=radio],[role=option],[role=switch],[role=combobox],[role=searchbox],[role=textbox],[contenteditable=""],[contenteditable=true],summary,[onclick],label[for]';
  let n = 0;
  for (const el of document.querySelectorAll(sel)) {
    if (el.closest("#iac-pill")) continue;
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
  // Navegador EMBUTIDO no app: um painel à direita da janela principal (você vê tudo o que ele faz, ao vivo)
  constructor(getParent, onPanel) {
    this.getParent = getParent; this.onPanel = onPanel || (() => {});
    this.view = null; this.attached = false; this.working = false; this.onStop = null; this.status = "";
  }
  get wc() { return this.view && this.view.webContents; }
  get win() { return this.view ? { webContents: this.view.webContents, isDestroyed: () => this.view.webContents.isDestroyed() } : null; }

  ensure() {
    if (this.view && !this.view.webContents.isDestroyed()) { if (!this.attached) this.attach(); return this.win; }
    this.view = new WebContentsView({ webPreferences: { partition: "persist:iac-copilot", sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
    this.view.setBackgroundColor("#ffffff");
    const wc = this.view.webContents;
    // pop-ups e "abrir em nova aba" ficam no mesmo painel, para o Copiloto continuar no controle
    wc.setWindowOpenHandler(({ url }) => { if (/^https?:/i.test(url)) wc.loadURL(url); return { action: "deny" }; });
    wc.on("did-finish-load", () => this.applyGlow());
    const st = () => this.emit();
    wc.on("page-title-updated", st); wc.on("did-navigate", st); wc.on("did-navigate-in-page", st); wc.on("did-start-loading", st); wc.on("did-stop-loading", st);
    wc.on("console-message", (e, level, message) => { const m = typeof message === "string" ? message : e && e.message; if (m === "__iacStop__" && this.onStop) this.onStop(); });
    wc.loadURL("about:blank").catch(() => {}); // sem isso, scripts numa aba nunca carregada ficam esperando para sempre
    this.attach();
    return this.win;
  }
  // executa JS na página com tempo limite (nunca trava a tarefa)
  js(code, ms = 6000) {
    const wc = this.wc; if (!wc || wc.isDestroyed()) return Promise.reject(new Error("painel fechado"));
    return Promise.race([wc.executeJavaScript(code, true), new Promise((_, rej) => setTimeout(() => rej(new Error("a página não respondeu")), ms))]);
  }
  attach() {
    const p = this.getParent(); if (!p || p.isDestroyed()) throw new Error("janela do app fechada");
    if (!this.attached) { p.contentView.addChildView(this.view); this.attached = true; if (!this.onResize) { this.onResize = () => this.layout(); p.on("resize", this.onResize); } }
    this.layout(); this.emit();
  }
  layout() {
    const p = this.getParent(); if (!p || p.isDestroyed() || !this.view || !this.attached) return;
    const [w, h] = p.getContentSize(), pw = Math.max(380, Math.min(Math.round(w * 0.48), w - 360)), HEAD = 112; // abas (36) + barra (44) + aviso de depuração (32)
    this.panelW = pw; this.view.setBounds({ x: w - pw, y: HEAD, width: pw, height: Math.max(100, h - HEAD) });
    this.emit();
  }
  emit() {
    const wc = this.wc;
    this.onPanel({ open: this.attached, width: this.attached ? this.panelW || 0 : 0, url: wc && !wc.isDestroyed() ? wc.getURL() : "", title: wc && !wc.isDestroyed() ? wc.getTitle() : "",
      loading: wc && !wc.isDestroyed() ? wc.isLoading() : false, working: this.working, status: this.status });
  }
  close() {
    const p = this.getParent();
    if (this.view && this.attached && p && !p.isDestroyed()) { p.contentView.removeChildView(this.view); }
    this.attached = false; this.emit();
  }
  nav(dir) { const wc = this.wc; if (!wc) return; const h = wc.navigationHistory || wc; if (dir === "back" && (h.canGoBack ? h.canGoBack() : true)) h.goBack(); else if (dir === "forward") h.goForward(); else if (dir === "reload") wc.reload(); }

  async applyGlow() {
    const wc = this.wc; if (!wc || wc.isDestroyed()) return;
    const u = wc.getURL();
    if (u && /^https?:/.test(u)) { try { await this.js(this.working ? GLOW + ";" + pillText(this.status) : UNGLOW, 3000); } catch {} }
    this.emit();
  }

  async setWorking(on, status) {
    this.working = !!on; this.status = status || "";
    if (!this.view) { this.emit(); return; } // não cria o painel antes da permissão
    await this.applyGlow();
  }

  show() { this.ensure(); }
  hide() { this.close(); }

  async pointTo(x, y, mode) {
    const wc = this.wc;
    await this.js(moveCursor(x, y, ""), 2000).catch(() => {});
    await new Promise((r) => setTimeout(r, 430)); // dá para ver o cursor indo até o alvo
    if (mode) await this.js(moveCursor(null, null, mode), 2000).catch(() => {});
    const [vw, vh] = await this.js("[innerWidth, innerHeight]", 2000).catch(() => [1280, 800]);
    this.cur = { x: x / vw, y: y / vh, mode: mode || "" };
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
    w.webContents.loadURL(u.href).catch(() => {}); // não espera o loadURL (pode nunca resolver); espera o carregamento com limite
    await new Promise((r) => setTimeout(r, 150));
    await this.waitLoad();
    return { url: w.webContents.getURL() };
  }

  async snapshot() {
    if (!this.view || this.view.webContents.isDestroyed()) return { url: "about:blank", title: "", elements: [], text: "", image: null, empty: true };
    if (!this.attached) this.attach();
    const wc = this.view.webContents;
    if (!wc.getURL() || wc.getURL() === "about:blank") return { url: "about:blank", title: "", elements: [], text: "", image: null, empty: true };
    this.js(moveCursor(null, null, "think"), 1500).catch(() => {}); // o cursor "procura" pela página enquanto ela lê
    const page = await this.js(READ_PAGE, 8000).catch(() => ({ url: wc.getURL(), title: wc.getTitle(), elements: [], text: "" }));
    const cap = () => Promise.race([wc.capturePage(), new Promise((r) => setTimeout(() => r(null), 4000))]);
    let img = await cap();
    if (!img || img.isEmpty()) { await new Promise((r) => setTimeout(r, 300)); img = await cap(); }
    if (!img) { page.image = null; return page; }
    const sz = img.getSize();
    if (sz.width > 1100) img = img.resize({ width: 1100, quality: "good" });
    page.image = img.isEmpty() ? null : "data:image/jpeg;base64," + img.toJPEG(68).toString("base64");
    return page;
  }

  async elementCenter(id) {
    const wc = this.win.webContents;
    const r = await this.js(`(() => {
      const el = document.querySelector('[data-iac="${Number(id)}"]');
      if (!el) return null;
      el.scrollIntoView({ block: "center", inline: "center" });
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), password: (el.getAttribute("type") || "").toLowerCase() === "password" };
    })()`);
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
    if (t === "media") {
      const r = await this.js(`(() => { const v = [...document.querySelectorAll("video,audio")].sort((a, b) => (b.duration || 0) - (a.duration || 0))[0]; if (!v) return "sem vídeo na página";
  const d = ${JSON.stringify(a.do)};
  if (d === "seek") { if (v.duration && ${Number(a.seconds) || 0} > v.duration) return "o vídeo tem só " + Math.floor(v.duration / 60) + " min"; v.currentTime = ${Number(a.seconds) || 0}; }
  else if (d === "pause") v.pause(); else if (d === "play") v.play(); else if (d === "mute") v.muted = true; else if (d === "unmute") v.muted = false; else if (d === "speed") v.playbackRate = ${Number(a.rate) || 1};
  const t = Math.floor(v.currentTime), f = (n) => String(n).padStart(2, "0");
  return "ok " + Math.floor(t / 3600) + ":" + f(Math.floor(t % 3600 / 60)) + ":" + f(t % 60) + (v.paused ? " (pausado)" : " (tocando)"); })()`);
      if (!String(r).startsWith("ok")) throw new Error(r);
      return { done: "vídeo: " + a.do + " → " + String(r).slice(3) };
    }
    if (t === "scroll") {
      const amt = Math.max(-25, Math.min(25, Math.round(Number(a.amount) || -5)));
      await this.js(`window.scrollBy({ top: ${-amt * 120}, behavior: "instant" })`);
      await new Promise((r) => setTimeout(r, 250));
      return { done: "rolou" };
    }
    if (t === "key") { this.pressKey(keyCode(a.key)); done = "tecla " + a.key; }
    else if (t === "click") {
      let x, y;
      if (a.id != null) ({ x, y } = await this.elementCenter(a.id));
      else if (Array.isArray(a.point)) { const [vw, vh] = await this.js("[innerWidth, innerHeight]"); y = Math.round(a.point[0] / 1000 * vh); x = Math.round(a.point[1] / 1000 * vw); }
      else throw new Error("clique sem alvo");
      await this.pointTo(x, y, "click");
      await this.clickAt(x, y);
      done = "clicou";
    } else if (t === "type" || t === "select") {
      if (a.id == null) throw new Error("diga em qual campo");
      const c = await this.elementCenter(a.id);
      if (c.password) throw new Error("é um campo de senha: por segurança eu não digito senhas — peça para o usuário");
      if (t === "select") {
        const ok = await this.js(`(() => { const el = document.querySelector('[data-iac="${Number(a.id)}"]'); if (!el || el.tagName !== "SELECT") return false;
          const v = ${JSON.stringify(String(a.value || ""))}.toLowerCase(); const o = [...el.options].find((o) => o.text.toLowerCase().includes(v) || o.value.toLowerCase() === v);
          if (!o) return false; el.value = o.value; el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); return true; })()`);
        if (!ok) throw new Error("não achei essa opção na lista");
        done = "escolheu " + a.value;
      } else {
        await this.pointTo(c.x, c.y, "click");
        await this.clickAt(c.x, c.y);
        await this.js(moveCursor(null, null, "type"), 2000).catch(() => {});
        await new Promise((r) => setTimeout(r, 100));
        if (a.clear !== false) {
          await this.js(`(() => { const el = document.querySelector('[data-iac="${Number(a.id)}"]'); if (!el) return; el.focus();
            if ("value" in el && el.select) el.select(); else { const s = getSelection(); const r = document.createRange(); r.selectNodeContents(el); s.removeAllRanges(); s.addRange(r); } })()`);
        }
        await wc.insertText(String(a.text || "").slice(0, 3000));
        if (a.enter) { await new Promise((r) => setTimeout(r, 150)); this.pressKey("Enter"); }
        await this.js(moveCursor(null, null, ""), 2000).catch(() => {});
        done = "digitou";
      }
    } else throw new Error("ação desconhecida no navegador: " + t);
    // espera a página reagir (e carregar, se navegou)
    await new Promise((r) => setTimeout(r, 300));
    if (wc.isLoading() || wc.getURL() !== before) await this.waitLoad();
    const cur = this.cur; this.cur = null;
    return { done, cur };
  }
}

module.exports = { CopilotBrowser, keyCode };
