// Jarvis — Navegador do Copiloto como extensão (igual ao Claude in Chrome):
// abas num grupo laranja "Jarvis", controladas por depuração (chrome.debugger).
// A tarefa roda AQUI, em segundo plano: continua mesmo se você sair da aba do site.
"use strict";
const API = "https://council-one-sigma.vercel.app/api/copilot";
const SITE = "https://council-one-sigma.vercel.app/*";
const MAX_STEPS = 30;

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
  return { vw, vh, url: location.href, title: document.title, scrollY: Math.round(scrollY), scrollMax: Math.max(0, document.documentElement.scrollHeight - vh), elements: out, text };
})()`;

const KEYS = {
  enter: { key: "Enter", code: "Enter", keyCode: 13, text: "\r" }, tab: { key: "Tab", code: "Tab", keyCode: 9 },
  escape: { key: "Escape", code: "Escape", keyCode: 27 }, backspace: { key: "Backspace", code: "Backspace", keyCode: 8 },
  delete: { key: "Delete", code: "Delete", keyCode: 46 }, space: { key: " ", code: "Space", keyCode: 32, text: " " },
  arrowdown: { key: "ArrowDown", code: "ArrowDown", keyCode: 40 }, arrowup: { key: "ArrowUp", code: "ArrowUp", keyCode: 38 },
  arrowleft: { key: "ArrowLeft", code: "ArrowLeft", keyCode: 37 }, arrowright: { key: "ArrowRight", code: "ArrowRight", keyCode: 39 },
  pagedown: { key: "PageDown", code: "PageDown", keyCode: 34 }, pageup: { key: "PageUp", code: "PageUp", keyCode: 33 },
  home: { key: "Home", code: "Home", keyCode: 36 }, end: { key: "End", code: "End", keyCode: 35 },
};
// Visual igual ao Claude in Chrome: borda laranja brilhando + pílula embaixo com o passo atual e "Parar"
const GLOW = `(() => { if (document.getElementById("iac-glow")) return; const s = document.createElement("style"); s.id = "iac-glow";
  s.textContent = 'html::after{content:"";position:fixed;inset:0;pointer-events:none;z-index:2147483646;box-shadow:inset 0 0 0 3px #d97757,inset 0 0 34px 6px rgba(217,119,87,.5);animation:iacg 2.4s ease-in-out infinite}' +
    '@keyframes iacg{50%{box-shadow:inset 0 0 0 2px #d97757,inset 0 0 18px 2px rgba(217,119,87,.35)}}' +
    '#iac-pill{position:fixed;left:50%;bottom:18px;transform:translateX(-50%);z-index:2147483647;display:flex;align-items:center;gap:10px;padding:7px 7px 7px 14px;border-radius:999px;background:#262624;color:#f3f1ea;font:500 13px/1.2 system-ui,-apple-system,Segoe UI,sans-serif;box-shadow:0 8px 28px rgba(0,0,0,.35),0 0 0 1px rgba(217,119,87,.7);pointer-events:auto}' +
    '#iac-pill i{flex:none;width:8px;height:8px;border-radius:50%;background:#d97757;animation:iacp 1.1s ease-in-out infinite}@keyframes iacp{50%{opacity:.25}}' +
    '#iac-pill b{font-weight:650;color:#d97757}#iac-pill span{max-width:44vw;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:#d6d3cb}' +
    '#iac-pill button{all:unset;cursor:pointer;background:#d97757;color:#fff;border-radius:999px;padding:5px 13px;font-weight:600}#iac-pill button:hover{background:#c4633f}';
  (document.head || document.documentElement).appendChild(s);
  const p = document.createElement("div"); p.id = "iac-pill";
  const dot = document.createElement("i"), b = document.createElement("b"), sp = document.createElement("span"), bt = document.createElement("button");
  b.textContent = "Jarvis"; sp.textContent = window.__iacNow || "trabalhando nesta aba…"; bt.textContent = "Parar";
  bt.onclick = () => { try { window.__iacStop("stop"); } catch (e) {} sp.textContent = "parando…"; };
  p.append(dot, b, sp, bt); (document.body || document.documentElement).appendChild(p); })()`;
// Cursor laranja da IA: mostra onde ela vai clicar/digitar
const CURSOR = (x, y, mode) => `(() => {
  let c = document.getElementById("iac-cursor");
  if (!c) {
    if (!document.getElementById("iac-cstyle")) { const s = document.createElement("style"); s.id = "iac-cstyle";
      s.textContent = '#iac-cursor{position:fixed;left:0;top:0;z-index:2147483647;pointer-events:none;transition:transform .5s cubic-bezier(.22,.9,.3,1)}' +
    '#iac-cursor svg{display:block;filter:drop-shadow(0 1px 2px rgba(0,0,0,.35))}' +
    '#iac-cursor .rp{position:absolute;left:-9px;top:-9px;width:20px;height:20px;border-radius:50%;background:rgba(217,119,87,.4);opacity:0}' +
    '#iac-cursor.clk .rp{animation:iacr .5s ease-out}@keyframes iacr{0%{opacity:1;transform:scale(.4)}100%{opacity:0;transform:scale(1.9)}}' +
    '#iac-cursor .tg{position:absolute;left:14px;top:19px;background:#d97757;color:#fff;font:600 11px/1 system-ui,Segoe UI,sans-serif;padding:4px 7px;border-radius:3px 9px 9px 9px;white-space:nowrap;box-shadow:0 1px 3px rgba(0,0,0,.3);transition:opacity .3s}' +
    '#iac-cursor.typ .tg:after{content:" · digitando"}#iac-cursor.think .tg:after{content:" · lendo…"}' +
    '#iac-cursor .w{transition:opacity .3s}#iac-cursor.idle .w,#iac-cursor.idle .tg{opacity:.45}';
      (document.head || document.documentElement).appendChild(s); }
    c = document.createElement("div"); c.id = "iac-cursor";
    const ns = "http://www.w3.org/2000/svg", svg = document.createElementNS(ns, "svg"), p = document.createElementNS(ns, "path");
    svg.setAttribute("width", "18"); svg.setAttribute("height", "22"); svg.setAttribute("viewBox", "0 0 18 22");
    p.setAttribute("d", "M2 2v16.5l4.3-4.1 2.9 6.6 2.6-1.1-2.9-6.5h6.1z"); p.setAttribute("fill", "#d97757"); p.setAttribute("stroke", "#fff"); p.setAttribute("stroke-width", "1.5"); p.setAttribute("stroke-linejoin", "round");
    svg.appendChild(p); const rp = document.createElement("div"); rp.className = "rp"; const tg = document.createElement("div"); tg.className = "tg"; tg.textContent = "Jarvis";
    const wr = document.createElement("div"); wr.className = "w"; wr.append(svg);
    c.append(rp, wr, tg); (document.body || document.documentElement).appendChild(c);
    const o = window.__iacXY || [innerWidth * 0.55, innerHeight * 0.35]; c.style.transform = "translate(" + o[0] + "px," + o[1] + "px)"; c.getBoundingClientRect();
  }
  ${x == null ? "" : `window.__iacXY = [${x}, ${y}]; c.style.transform = "translate(${x}px,${y}px)";`}
  c.classList.remove("idle"); c.classList.toggle("typ", ${JSON.stringify(mode || "")} === "type"); c.classList.toggle("think", ${JSON.stringify(mode || "")} === "think");
  if (${JSON.stringify(mode || "")} === "click") { c.classList.remove("clk"); void c.offsetWidth; c.classList.add("clk"); }
})()`;
// ao terminar: some a borda e a pílula; o cursor laranja FICA (mais claro) onde parou
const UNGLOW = `(() => { ["iac-glow", "iac-pill"].forEach((id) => { const e = document.getElementById(id); if (e) e.remove(); });
  const c = document.getElementById("iac-cursor"); if (c) { c.classList.remove("think", "typ"); c.classList.add("idle"); } })()`;
const pillText = (t) => `(() => { window.__iacNow = ${JSON.stringify(String(t || "").slice(0, 140))}; const s = document.querySelector("#iac-pill span"); if (s) s.textContent = window.__iacNow; })()`;

const short = (m) => { m = String(m || "IA").replace(/^.*\//, "").replace(/:free$/, ""); return /gemini/i.test(m) ? "Gemini" : /gpt-oss/i.test(m) ? "GPT-OSS (Groq)" : /nemotron/i.test(m) ? "Nemotron" : /llama/i.test(m) ? "Llama" : m.slice(0, 30); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let task = null; // tarefa atual (uma de cada vez)

// ---------- eventos para o site (todas as abas do Jarvis) ----------
function publicState() {
  if (!task) return null;
  const { id, goal, steps, lines, status, now, waiting, answer, plan, shot, url, title, cur } = task;
  return { id, goal, steps, lines, status, now, waiting, answer, plan, shot, url, title, cur };
}
async function emit() {
  const st = publicState();
  try { await chrome.storage.session.set({ lastTask: st }); } catch {}
  const tabs = await chrome.tabs.query({ url: SITE }).catch(() => []);
  for (const t of tabs) chrome.tabs.sendMessage(t.id, { __iacEvent: true, ev: { type: "task", task: st } }).catch(() => {});
  chrome.action.setBadgeText({ text: task && task.status === "running" ? "●" : "" }).catch(() => {});
  chrome.action.setBadgeBackgroundColor({ color: "#d97757" }).catch(() => {});
}
function setNow(t) { if (task) { task.now = t; emit(); if (task.tabId != null && t) evaluate(task.tabId, pillText(t)).catch(() => {}); } }
function addLine(t, kind) { if (task) { task.lines.push({ t, kind: kind || "" }); if (task.lines.length > 80) task.lines.shift(); emit(); } }

// ---------- aba no grupo "Jarvis" ----------
async function ensureTab() {
  if (task.tabId != null) {
    const t = await chrome.tabs.get(task.tabId).catch(() => null);
    if (t) return t.id;
  }
  const st = await chrome.storage.session.get(["groupId", "windowId"]).catch(() => ({}));
  let windowId = st.windowId;
  if (windowId != null && !(await chrome.windows.get(windowId).catch(() => null))) windowId = null;
  const tab = await chrome.tabs.create({ url: "about:blank", active: false, ...(windowId != null ? { windowId } : {}) });
  let groupId = st.groupId;
  const g = groupId != null ? await chrome.tabGroups.get(groupId).catch(() => null) : null;
  if (g && g.windowId === tab.windowId) await chrome.tabs.group({ groupId, tabIds: [tab.id] });
  else groupId = await chrome.tabs.group({ tabIds: [tab.id], createProperties: { windowId: tab.windowId } });
  await chrome.tabGroups.update(groupId, { title: "Jarvis", color: "orange", collapsed: false }).catch(() => {});
  await chrome.storage.session.set({ groupId, windowId: tab.windowId });
  task.tabId = tab.id;
  return tab.id;
}

// Nunca levar o usuário para a aba do Jarvis (ele continua onde está), a não ser que peça "Ver aba" ou precise logar
async function keepFocus() {
  if (!task || task.shown || task.tabId == null) return;
  const t = await chrome.tabs.get(task.tabId).catch(() => null);
  if (!t || !t.active) return;
  const back = task.originTab != null ? await chrome.tabs.get(task.originTab).catch(() => null) : null;
  if (back && back.windowId === t.windowId) await chrome.tabs.update(back.id, { active: true }).catch(() => {});
  else { // a aba do site está em outra janela: deixa a aba anterior desta janela ativa
    const [other] = (await chrome.tabs.query({ windowId: t.windowId })).filter((x) => x.id !== t.id && x.groupId !== t.groupId).sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0));
    if (other) await chrome.tabs.update(other.id, { active: true }).catch(() => {});
  }
}
// tira um print depois de agir (o chat mostra a aba ao vivo, com o cursor)
async function liveShot() {
  if (!task || task.tabId == null) return;
  try {
    const m = await cdp(task.tabId, "Page.getLayoutMetrics"); const vp = m.cssVisualViewport || m.visualViewport;
    const scale = Math.min(1, 1100 / Math.max(1, vp.clientWidth));
    const shot = await Promise.race([cdp(task.tabId, "Page.captureScreenshot", { format: "jpeg", quality: 55, clip: { x: vp.pageX, y: vp.pageY, width: vp.clientWidth, height: vp.clientHeight, scale } }), sleep(2000).then(() => null)]);
    if (shot && shot.data) { task.shot = "data:image/jpeg;base64," + shot.data; emit(); }
  } catch {}
}

// ---------- depuração (CDP) ----------
async function attach(tabId) {
  const targets = await chrome.debugger.getTargets();
  if (targets.some((t) => t.tabId === tabId && t.attached)) return;
  await chrome.debugger.attach({ tabId }, "1.3");
  await cdp(tabId, "Page.enable").catch(() => {});
  await cdp(tabId, "Runtime.enable").catch(() => {});
  await cdp(tabId, "Runtime.addBinding", { name: "__iacStop" }).catch(() => {}); // botão "Parar" da pílula na própria aba
  await cdp(tabId, "Emulation.setFocusEmulationEnabled", { enabled: true }).catch(() => {}); // funciona com a aba em segundo plano
}
function cdp(tabId, method, params) {
  return new Promise((resolve, reject) => {
    chrome.debugger.sendCommand({ tabId }, method, params || {}, (res) => {
      const e = chrome.runtime.lastError;
      if (e) reject(new Error(e.message)); else resolve(res);
    });
  });
}
async function evaluate(tabId, expr) {
  const r = await cdp(tabId, "Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true, userGesture: true });
  if (r.exceptionDetails) throw new Error("erro na página: " + (r.exceptionDetails.exception && r.exceptionDetails.exception.description || r.exceptionDetails.text || "").slice(0, 120));
  return r.result ? r.result.value : undefined;
}
chrome.debugger.onDetach.addListener((src, reason) => {
  if (task && src.tabId === task.tabId && task.status === "running") { task.detached = reason; }
});
chrome.debugger.onEvent.addListener((src, method, params) => {
  if (method === "Runtime.bindingCalled" && params && params.name === "__iacStop" && task && src.tabId === task.tabId && task.status === "running") {
    task.stop = true; const w = waiters.get(task.id); if (w) { waiters.delete(task.id); w(false); }
  }
});
chrome.tabs.onRemoved.addListener((tabId) => { if (task && tabId === task.tabId) task.tabId = null; });

async function waitReady(tabId, ms = 10000) {
  const end = Date.now() + ms;
  await sleep(200);
  while (Date.now() < end) {
    const st = await evaluate(tabId, "document.readyState").catch(() => "loading");
    if (st === "complete" || st === "interactive") break;
    await sleep(300);
  }
  await sleep(250);
  await evaluate(tabId, GLOW).catch(() => {});
  await evaluate(tabId, CURSOR(null, null, "")).catch(() => {});
}

async function snapshot(tabId) {
  const page = await evaluate(tabId, READ_PAGE).catch(() => ({ url: "", title: "", elements: [], text: "" }));
  let image = null;
  try {
    const m = await cdp(tabId, "Page.getLayoutMetrics");
    const vp = m.cssVisualViewport || m.visualViewport;
    const scale = Math.min(1, 1100 / Math.max(1, vp.clientWidth));
    const shot = await Promise.race([
      cdp(tabId, "Page.captureScreenshot", { format: "jpeg", quality: 60, clip: { x: vp.pageX, y: vp.pageY, width: vp.clientWidth, height: vp.clientHeight, scale } }),
      sleep(3000).then(() => null),
    ]);
    if (shot && shot.data) image = "data:image/jpeg;base64," + shot.data;
  } catch {}
  if (task && page.vw) task.vp = [page.vw, page.vh];
  page.image = image; // em segundo plano o print pode falhar: segue só com o texto e os elementos
  return page;
}

async function center(tabId, id) {
  const r = await evaluate(tabId, `(() => { const el = document.querySelector('[data-iac="${Number(id)}"]'); if (!el) return null;
    el.scrollIntoView({ block: "center", inline: "center" }); const r = el.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), password: (el.getAttribute("type") || "").toLowerCase() === "password" }; })()`);
  if (!r) throw new Error("o elemento " + id + " não está mais na página (ela mudou)");
  return r;
}
async function pointTo(tabId, x, y, mode) {
  if (task) {
    task.cursor = [x, y];
    const vp = task.vp || (await evaluate(tabId, "[innerWidth, innerHeight]").catch(() => null)) || [1280, 800];
    task.cur = { x: x / vp[0], y: y / vp[1], mode: mode || "", n: (task.cur ? task.cur.n : 0) + 1 };
    emit();
  }
  await evaluate(tabId, CURSOR(x, y, "")).catch(() => {});
  await sleep(430); // o usuário vê o cursor indo até o alvo
  if (mode) await evaluate(tabId, CURSOR(null, null, mode)).catch(() => {});
}
async function click(tabId, x, y) {
  await pointTo(tabId, x, y, "click");
  await cdp(tabId, "Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
  await cdp(tabId, "Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
  await cdp(tabId, "Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
}
async function key(tabId, name) {
  const k = KEYS[String(name || "").toLowerCase()];
  if (!k) throw new Error("tecla não permitida: " + name);
  const base = { key: k.key, code: k.code, windowsVirtualKeyCode: k.keyCode, nativeVirtualKeyCode: k.keyCode };
  await cdp(tabId, "Input.dispatchKeyEvent", { type: k.text ? "keyDown" : "rawKeyDown", ...base, ...(k.text ? { text: k.text, unmodifiedText: k.text } : {}) });
  await cdp(tabId, "Input.dispatchKeyEvent", { type: "keyUp", ...base });
}

async function act(tabId, a) {
  const before = await evaluate(tabId, "location.href").catch(() => "");
  const t = a.type;
  if (t === "navigate") {
    await cdp(tabId, "Page.navigate", { url: a.url });
    await waitReady(tabId);
    return "abriu " + a.url.replace(/^https?:\/\/(www\.)?/, "").slice(0, 60);
  }
  if (t === "back" || t === "forward") { await evaluate(tabId, t === "back" ? "history.back()" : "history.forward()"); await waitReady(tabId); return t === "back" ? "voltou" : "avançou"; }
  if (t === "wait") { await sleep(Math.max(300, Math.min(5000, (Number(a.seconds) || 1) * 1000))); return ""; }
  if (t === "media") {
    const r = await evaluate(tabId, `(() => { const v = [...document.querySelectorAll("video,audio")].sort((a, b) => (b.duration || 0) - (a.duration || 0))[0]; if (!v) return "sem vídeo na página";
  const d = ${JSON.stringify(a.do)};
  if (d === "seek") { if (v.duration && ${Number(a.seconds) || 0} > v.duration) return "o vídeo tem só " + Math.floor(v.duration / 60) + " min"; v.currentTime = ${Number(a.seconds) || 0}; }
  else if (d === "pause") v.pause(); else if (d === "play") v.play(); else if (d === "mute") v.muted = true; else if (d === "unmute") v.muted = false; else if (d === "speed") v.playbackRate = ${Number(a.rate) || 1};
  const t = Math.floor(v.currentTime), f = (n) => String(n).padStart(2, "0");
  return "ok " + Math.floor(t / 3600) + ":" + f(Math.floor(t % 3600 / 60)) + ":" + f(t % 60) + (v.paused ? " (pausado)" : " (tocando)"); })()`);
    if (!String(r).startsWith("ok")) throw new Error(r);
    return "vídeo: " + a.do + " → " + String(r).slice(3);
  }
  if (t === "scroll") { await evaluate(tabId, `window.scrollBy({ top: ${-(Math.max(-25, Math.min(25, Number(a.amount) || -5))) * 120} })`); await sleep(350); return "rolou a página"; }
  let done = "";
  if (t === "key") { await key(tabId, a.key); done = "apertou " + a.key; }
  else if (t === "click") {
    let x, y;
    if (a.id != null) ({ x, y } = await center(tabId, a.id));
    else if (Array.isArray(a.point)) { const [vw, vh] = await evaluate(tabId, "[innerWidth, innerHeight]"); y = Math.round(a.point[0] / 1000 * vh); x = Math.round(a.point[1] / 1000 * vw); }
    else throw new Error("clique sem alvo");
    await sleep(120); await click(tabId, x, y); done = "clicou";
  } else if (t === "type" || t === "select") {
    const c = await center(tabId, a.id);
    if (c.password) throw new Error("é um campo de senha: por segurança eu não digito senhas");
    if (t === "select") {
      const ok = await evaluate(tabId, `(() => { const el = document.querySelector('[data-iac="${Number(a.id)}"]'); if (!el || el.tagName !== "SELECT") return false;
        const v = ${JSON.stringify(String(a.value || ""))}.toLowerCase(); const o = [...el.options].find((o) => o.text.toLowerCase().includes(v) || o.value.toLowerCase() === v);
        if (!o) return false; el.value = o.value; el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); return true; })()`);
      if (!ok) throw new Error("não achei essa opção na lista");
      done = "escolheu “" + a.value + "”";
    } else {
      await click(tabId, c.x, c.y); await evaluate(tabId, CURSOR(null, null, "type")).catch(() => {}); await sleep(100);
      if (a.clear !== false) await evaluate(tabId, `(() => { const el = document.querySelector('[data-iac="${Number(a.id)}"]'); if (!el) return; el.focus();
        if ("value" in el && el.select) el.select(); else { const s = getSelection(), r = document.createRange(); r.selectNodeContents(el); s.removeAllRanges(); s.addRange(r); } })()`);
      await cdp(tabId, "Input.insertText", { text: String(a.text || "").slice(0, 3000) });
      if (a.enter) { await sleep(150); await key(tabId, "enter"); }
      await evaluate(tabId, CURSOR(null, null, "")).catch(() => {});
      done = "digitou “" + String(a.text || "").slice(0, 50) + "”" + (a.enter ? " + Enter" : "");
    }
  } else throw new Error("ação desconhecida: " + t);
  await sleep(300);
  const after = await evaluate(tabId, "location.href").catch(() => before);
  if (after !== before) await waitReady(tabId);
  return done;
}

// ---------- perguntas ao usuário (login, confirmação) ----------
const waiters = new Map();
function askUser(kind, msg) {
  task.waiting = { kind, msg }; task.now = ""; emit();
  return new Promise((resolve) => waiters.set(task.id, resolve)).then((v) => { if (task) { task.waiting = null; emit(); } return v; });
}

// ---------- permissão por site (como o Claude in Chrome) ----------
function hostOf(u) { try { const x = new URL(u); return /^https?:$/.test(x.protocol) ? x.hostname.replace(/^www\./, "") : ""; } catch { return ""; } }
async function siteAllowed(host) {
  if (!host || task.allowed.has(host)) return true;
  const st = await chrome.storage.local.get(["allowAll", "allowedSites"]).catch(() => ({}));
  return !!st.allowAll || (st.allowedSites || []).includes(host);
}
async function askSite(host) {
  if (await siteAllowed(host)) return true;
  const choice = await askUser("site", host);
  if (!choice) return false;
  task.allowed.add(host);
  if (choice === "always" || choice === "all") {
    const st = await chrome.storage.local.get(["allowedSites"]).catch(() => ({}));
    const list = new Set(st.allowedSites || []); list.add(host);
    await chrome.storage.local.set(choice === "all" ? { allowAll: true, allowedSites: [...list] } : { allowedSites: [...list] }).catch(() => {});
  }
  addLine(choice === "all" ? "Você permitiu o Jarvis em todos os sites" : "Você permitiu o Jarvis em " + host + (choice === "always" ? " (sempre)" : " (só agora)"));
  return true;
}

// ---------- o loop da tarefa ----------
async function runTask(t) {
  task = { ...t, steps: [], lines: [], status: "running", now: "Abrindo a aba no grupo Jarvis…", waiting: null, answer: "", plan: "", tabId: null, stop: false, allowed: new Set(), rejections: 0 };
  emit();
  chrome.alarms.create("iac-keepalive", { periodInMinutes: 0.5 });
  let step = 0;
  const finish = async (status, msg, kind, answer) => {
    if (!task) return;
    task.status = status; task.now = ""; task.waiting = null; if (answer) task.answer = answer;
    addLine(msg, kind);
    if (task.tabId != null) {
      await evaluate(task.tabId, UNGLOW).catch(() => {});
      await chrome.debugger.detach({ tabId: task.tabId }).catch(() => {});
    }
    chrome.alarms.clear("iac-keepalive");
    emit();
  };
  try {
    // a aba só é criada DEPOIS da permissão do primeiro site
    while (true) {
      if (task.stop) return finish("stopped", "Parado por você.", "err");
      if (step >= MAX_STEPS) return finish("max", "Parei depois de " + MAX_STEPS + " passos. Peça para continuar se precisar.", "err");
      if (task.tabId == null && task.opened) return finish("stopped", "A aba do Jarvis foi fechada.", "err");
      if (task.detached) { task.detached = null; await attach(task.tabId).catch(() => {}); }
      step++;
      setNow(step === 1 ? "Planejando…" : "Lendo a página… (passo " + step + ")");
      if (task.opened) evaluate(task.tabId, CURSOR(null, null, "think")).catch(() => {}); // o cursor "procura" enquanto ela lê e decide
      const page = task.opened ? await snapshot(task.tabId) : { url: "", title: "", elements: [], text: "", image: null };
      task.shot = page.image; task.url = page.url; task.title = page.title;
      setNow("Entendendo a página e decidindo o próximo passo…");
      const r = await fetch(API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        stage: "web", rejections: task.rejections, failed: task.failed || 0, goal: task.goal, request: task.request || task.goal, context: task.context || "", plan: task.plan, steps: task.steps,
        page: { url: page.url, title: page.title, elements: page.elements, text: page.text, scrollY: page.scrollY, scrollMax: page.scrollMax }, image: page.image }) });
      const plan = await r.json().catch(() => ({ error: "resposta inválida do servidor" }));
      if (!r.ok) throw new Error(plan.error || "Erro " + r.status);
      if (task.stop) return finish("stopped", "Parado por você.", "err");
      if (plan.plan && !task.plan) { task.plan = plan.plan; addLine("Plano: " + plan.plan); }
      if (plan.rejected) {
        task.rejections++;
        addLine("🔎 A conferência não aprovou: " + plan.rejected, "err");
        task.steps.push("O VERIFICADOR recusou o resultado: " + plan.rejected + " — corrija antes de terminar.");
        continue;
      }
      task.target = null;
      const a = plan.action;
      if (a.type === "done") {
        task.steps.push(plan.say);
        if (plan.checker) addLine("🔎 Resultado conferido");
        return finish("done", "✓ " + plan.say, "", plan.answer);
      }
      if (a.type === "ask_user") {
        task.steps.push("Pediu ajuda: " + plan.say); task.shown = true;
        await chrome.tabs.update(task.tabId, { active: true }).catch(() => {});
        const tab = await chrome.tabs.get(task.tabId).catch(() => null);
        if (tab) chrome.windows.update(tab.windowId, { focused: true }).catch(() => {});
        const go = await askUser("help", plan.say);
        if (!go || task.stop) return finish("stopped", "Encerrado.", "err");
        task.steps.push("O usuário resolveu na aba e pediu para continuar.");
        continue;
      }
      if (plan.confirm) {
        const ok = await askUser("confirm", plan.confirm);
        if (task.stop) return finish("stopped", "Parado por você.", "err");
        if (!ok) { task.steps.push("Usuário NÃO autorizou: " + plan.say); return finish("stopped", "Cancelado: você não autorizou.", "err"); }
      }
      // permissão do site antes de agir nele
      const host = a.type === "navigate" ? hostOf(a.url) : hostOf(page.url);
      if (host && !(await askSite(host))) return finish("stopped", "Você não permitiu o Jarvis em " + host + ".", "err");
      if (task.stop) return finish("stopped", "Parado por você.", "err");
      if (!task.opened) {
        setNow("Abrindo a aba no grupo Jarvis…");
        await ensureTab(); await keepFocus(); await attach(task.tabId); task.opened = true; await keepFocus();
        addLine("Abri uma aba no grupo Jarvis (você continua aqui; clique em “Ver aba” para acompanhar)");
      }
      setNow(plan.say);
      const did = [];
      try {
        for (const x of [a, ...(plan.then || [])]) {
          if (task.stop) break;
          const d = await act(task.tabId, x);
          if (d) did.push(d);
        }
        const line = plan.say + (did.length ? " (" + did.join(", ") + ")" : "");
        addLine(line); task.steps.push(line); task.failed = 0;
        await keepFocus(); await liveShot();
      } catch (e) {
        addLine("Não deu certo: " + e.message, "err"); task.failed = (task.failed || 0) + 1;
        task.steps.push("FALHOU (" + (did.length ? "fez " + did.join(", ") + "; depois " : "") + a.type + "): " + e.message);
      }
      await sleep(60);
    }
  } catch (e) {
    return finish("error", (e && e.message) || "Falha inesperada.", "err");
  }
}
// ---------- atualização automática ----------
// O app Jarvis (Windows) grava a versão nova na pasta da extensão; aqui ela percebe e se recarrega sozinha.
const newerV = (a, b) => { const x = String(a || "0").split(".").map(Number), y = String(b || "0").split(".").map(Number); for (let i = 0; i < Math.max(x.length, y.length); i++) { const d = (x[i] || 0) - (y[i] || 0); if (d) return d > 0; } return false; };
async function checkSelfUpdate() {
  try {
    if (task && task.status === "running") return;
    // pasta "sem compactação": os arquivos no disco podem já ser de uma versão nova (gravada pelo app)
    const r = await fetch(chrome.runtime.getURL("manifest.json") + "?t=" + Date.now(), { cache: "no-store" });
    const disk = (await r.json()).version, mine = chrome.runtime.getManifest().version;
    if (newerV(disk, mine)) chrome.runtime.reload();
  } catch {}
}
// depois de recarregar, reconecta as abas do site que já estavam abertas
async function reinject() {
  const tabs = await chrome.tabs.query({ url: SITE }).catch(() => []);
  for (const t of tabs) chrome.scripting.executeScript({ target: { tabId: t.id }, files: ["content.js"] }).catch(() => {});
}
chrome.alarms.create("iac-update", { periodInMinutes: 1 });
chrome.runtime.onStartup.addListener(checkSelfUpdate);
chrome.runtime.onInstalled.addListener(() => { reinject(); });
chrome.alarms.onAlarm.addListener((a) => { if (a.name === "iac-update") checkSelfUpdate(); /* iac-keepalive mantém a extensão acordada durante a tarefa */ });

// ---------- mensagens do site ----------
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (!sender.url || !sender.url.startsWith("https://council-one-sigma.vercel.app/")) return; // só o site oficial
  (async () => {
    if (msg.type === "hello") return { ok: true, version: chrome.runtime.getManifest().version };
    if (msg.type === "update") { const v = chrome.runtime.getManifest().version; setTimeout(checkSelfUpdate, 50); return { ok: true, version: v }; }
    if (msg.type === "status") {
      if (task) return { task: publicState() };
      const s = await chrome.storage.session.get("lastTask").catch(() => ({}));
      return { task: s.lastTask || null };
    }
    if (msg.type === "start") {
      if (task && task.status === "running") return { error: "Já existe uma tarefa no Jarvis. Espere ou clique em Parar." };
      const goal = String(msg.goal || "").slice(0, 1200);
      if (!goal) return { error: "objetivo vazio" };
      const id = String(msg.id || Date.now());
      runTask({ id, originTab: sender.tab ? sender.tab.id : null, goal, request: String(msg.request || "").slice(0, 2000), context: String(msg.context || "").slice(0, 2000) });
      return { ok: true, id };
    }
    if (msg.type === "stop") { if (task && task.status === "running") { task.stop = true; const w = waiters.get(task.id); if (w) { waiters.delete(task.id); w(false); } } return { ok: true }; }
    if (msg.type === "answer") { if (task) { const w = waiters.get(task.id); if (w) { waiters.delete(task.id); w(msg.choice ? msg.choice : !!msg.yes); } } return { ok: true }; }
    if (msg.type === "perms") {
      if (msg.reset) await chrome.storage.local.set({ allowAll: false, allowedSites: [] }).catch(() => {});
      const st = await chrome.storage.local.get(["allowAll", "allowedSites"]).catch(() => ({}));
      return { allowAll: !!st.allowAll, sites: st.allowedSites || [] };
    }
    if (msg.type === "show") {
      if (task && task.tabId != null) {
        task.shown = true;
        await chrome.tabs.update(task.tabId, { active: true }).catch(() => {});
        const tab = await chrome.tabs.get(task.tabId).catch(() => null);
        if (tab) await chrome.windows.update(tab.windowId, { focused: true }).catch(() => {});
      }
      return { ok: true };
    }
    return { error: "mensagem desconhecida" };
  })().then(reply, (e) => reply({ error: e.message }));
  return true;
});

// clicar no ícone da extensão abre o Jarvis
chrome.action.onClicked.addListener(async () => {
  const [t] = await chrome.tabs.query({ url: SITE });
  if (t) { chrome.tabs.update(t.id, { active: true }); chrome.windows.update(t.windowId, { focused: true }); }
  else chrome.tabs.create({ url: "https://council-one-sigma.vercel.app/" });
});
