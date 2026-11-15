// node extension/test/background.test.js — roda o motor da extensão com um navegador simulado
const assert = require("assert");
const fs = require("fs"), path = require("path"), vm = require("vm");
const cmds = [], events = [], listeners = {};
let reloads = 0, remoteV = "1.0.0", lastErr = null, plans = [], groupTitle = null, page = { url: "about:blank" };
const ev = (name) => ({ addListener: (f) => (listeners[name] = f) });
const chrome = {
  runtime: { onMessage: ev("msg"), onStartup: ev("startup"), onInstalled: ev("installed"), reload() { reloads++; }, getURL: (p) => "chrome-extension://x/" + p, getManifest: () => ({ version: "1.0.0" }), get lastError() { return lastErr; } },
  storage: { session: { _d: {}, async get(k) { return this._d; }, async set(o) { Object.assign(this._d, o); } }, local: { _d: {}, async get(k) { return this._d; }, async set(o) { Object.assign(this._d, o); } } },
  tabs: {
    async query() { return [{ id: 99 }]; }, async sendMessage(id, m) { events.push(m.ev.task); },
    async create(o) { return { id: 7, windowId: 1 }; }, async group(o) { return 55; }, async get(id) { return { id, windowId: 1 }; }, async update() {},
    onRemoved: ev("removed"),
  },
  tabGroups: { async get() { return null; }, async update(id, o) { groupTitle = o.title + "/" + o.color; } },
  windows: { async get() { return null; }, async update() {} },
  action: { setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {}, onClicked: ev("click") },
  alarms: { create() {}, clear() {}, onAlarm: ev("alarm") },
  debugger: {
    async getTargets() { return []; }, async attach(t, v) { cmds.push("attach " + t.tabId); }, async detach() { cmds.push("detach"); },
    onDetach: ev("detach"), onEvent: ev("dbg"),
    sendCommand(t, method, params, cb) {
      cmds.push(method + (params && params.type ? ":" + params.type : "") + (params && params.url ? " " + params.url : "") + (params && params.text ? " «" + params.text + "»" : ""));
      let res = {};
      if (method === "Runtime.evaluate") {
        const e = params.expression;
        if (e === "document.readyState") res = { result: { value: "complete" } };
        else if (e === "location.href") res = { result: { value: page.url } };
        else if (e.includes("READ") || e.includes("data-iac\") .forEach") || e.includes("querySelectorAll(\"[data-iac]\")")) res = { result: { value: { url: page.url, title: "Página", elements: [{ id: 1, kind: "campo:text", label: "Pesquisar" }], text: "texto" } } };
        else if (e.includes("scrollIntoView")) res = { result: { value: { x: 100, y: 50, password: false } } };
        else res = { result: { value: true } };
      }
      if (method === "Page.navigate") page.url = params.url;
      if (method === "Page.getLayoutMetrics") res = { cssVisualViewport: { clientWidth: 1000, clientHeight: 700, pageX: 0, pageY: 0 } };
      if (method === "Page.captureScreenshot") res = { data: "AAAA" };
      setTimeout(() => cb(res), 0);
    },
  },
};
global.fetch = async (url, init) => {
  if (String(url).includes("manifest.json")) return { ok: true, json: async () => ({ version: remoteV }) };
  const body = JSON.parse(init.body);
  assert.equal(body.stage, "web");
  const p = plans.shift();
  return { ok: true, json: async () => p };
};
const ctx = { chrome, fetch: global.fetch, console, setTimeout, clearTimeout, Promise, URL, JSON, Math, String, Number, Date, Map, Array, Object, Error };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "background.js"), "utf8"), ctx);
const send = (msg) => new Promise((r) => listeners.msg(msg, { url: "https://council-one-sigma.vercel.app/" }, r));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  // mensagem de outro site é ignorada
  assert.equal(listeners.msg({ type: "hello" }, { url: "https://site-malicioso.com/" }, () => {}), undefined);
  assert.equal((await send({ type: "hello" })).ok, true);
  plans = [
    { plan: "1) buscar 2) ler", say: "Vou pesquisar.", action: { type: "navigate", url: "https://www.google.com/search?q=ps5" }, then: [] },
    { say: "Vou digitar.", action: { type: "type", id: 1, text: "preço ps5", enter: true }, then: [] },
    { say: "Vou comprar.", confirm: "Posso finalizar a compra?", action: { type: "click", id: 1 }, then: [] },
    { say: "Achei.", action: { type: "wait", seconds: 0.3 }, rejected: "o preço não está na página", checker: "openai/gpt-oss-120b" },
    { say: "Achei.", action: { type: "done" }, answer: "R$ 3.999 na loja X", checker: "openai/gpt-oss-120b" },
  ];
  const st = await send({ type: "start", id: "t1", goal: "preço do ps5", request: "veja o preço do ps5" });
  assert.equal(st.ok, true);
  assert.ok((await send({ type: "start", id: "t2", goal: "outra" })).error, "não deixa duas tarefas ao mesmo tempo");
  for (let i = 0; i < 100 && !(events.at(-1) && events.at(-1).waiting); i++) await wait(20);
  assert.equal(events.at(-1).waiting.kind, "site", "pede permissão antes de usar o site");
  assert.equal(events.at(-1).waiting.msg, "google.com");
  assert.ok(!cmds.some((c) => c.startsWith("Page.navigate")), "não navega antes da permissão");
  assert.ok(!cmds.includes("attach 7"), "não abre a aba antes da permissão");
  await send({ type: "answer", choice: "always" });
  for (let i = 0; i < 100 && !(events.at(-1).waiting && events.at(-1).waiting.kind === "confirm"); i++) await wait(20);
  assert.equal(events.at(-1).waiting.kind, "confirm");
  await send({ type: "answer", yes: true });
  for (let i = 0; i < 100 && events.at(-1).status === "running"; i++) await wait(20);
  const last = events.at(-1);
  assert.equal(last.status, "done");
  assert.equal(last.answer, "R$ 3.999 na loja X");
  assert.equal(groupTitle, "Jarvis/orange");
  assert.ok(cmds.includes("attach 7"));
  assert.ok(cmds.includes("Page.navigate https://www.google.com/search?q=ps5"));
  assert.ok(cmds.includes("Input.insertText «preço ps5»"));
  assert.ok(cmds.includes("Input.dispatchMouseEvent:mousePressed"));
  assert.ok(cmds.some((c) => c.startsWith("Input.dispatchKeyEvent:keyDown")), "apertou Enter");
  assert.ok(cmds.includes("detach") && !cmds.slice(cmds.lastIndexOf("detach")).some((c) => c.startsWith("Input.")), "desconecta e não age depois");
  assert.ok(last.lines.some((l) => /não aprovou/.test(l.t)) && last.lines.some((l) => /Conferido por/.test(l.t)), "verificador recusou e depois aprovou");
  assert.deepEqual((await send({ type: "perms" })).sites, ["google.com"]);
  assert.ok(cmds.includes("Runtime.addBinding"), "botão Parar na própria aba");
  assert.ok(cmds.filter((c) => c === "Runtime.evaluate").length > 0);
  console.log("✓ tarefa completa na aba Jarvis (grupo laranja, navegar, digitar, confirmar, resposta, desconectar)");
  // parar no meio
  plans = [{ say: "Vou esperar.", action: { type: "wait", seconds: 1 }, then: [] }, { say: "x", action: { type: "wait", seconds: 1 } }, { say: "x", action: { type: "wait", seconds: 1 } }];
  await send({ type: "start", id: "t3", goal: "algo" });
  await wait(100); await send({ type: "stop" });
  for (let i = 0; i < 150 && events.at(-1).status === "running"; i++) await wait(20);
  assert.equal(events.at(-1).status, "stopped");
  console.log("✓ botão Parar interrompe a tarefa");
  plans = [{ say: "Vou esperar.", action: { type: "wait", seconds: 1 }, then: [] }, { say: "x", action: { type: "wait", seconds: 1 } }, { say: "x", action: { type: "wait", seconds: 1 } }];
  await send({ type: "start", id: "t4", goal: "algo" });
  await wait(150); listeners.dbg({ tabId: 7 }, "Runtime.bindingCalled", { name: "__iacStop" });
  for (let i = 0; i < 150 && events.at(-1).status === "running"; i++) await wait(20);
  assert.equal(events.at(-1).status, "stopped");
  console.log("✓ pílula na aba (borda laranja + Parar) e permissão por site");
  const s = await send({ type: "status" });
  assert.equal(s.task.id, "t4");
  console.log("✓ o site recupera o estado da tarefa ao voltar");
  await listeners.alarm({ name: "iac-update" }); await wait(20);
  assert.equal(reloads, 0, "mesma versão: não recarrega");
  remoteV = "1.0.9"; await listeners.alarm({ name: "iac-update" }); await wait(20);
  assert.equal(reloads, 1, "arquivos novos no disco: recarrega");
  console.log("✓ extensão se recarrega sozinha quando sai versão nova");
})().catch((e) => { console.error(e); process.exit(1); });
