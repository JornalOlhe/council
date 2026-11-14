// Lógica pura do controle do PC (testável sem Windows): teclas -> códigos virtuais e ações -> comandos.
"use strict";

const VK = {
  enter: 0x0d, tab: 0x09, esc: 0x1b, escape: 0x1b, backspace: 0x08, delete: 0x2e, space: 0x20,
  up: 0x26, down: 0x28, left: 0x25, right: 0x27, home: 0x24, end: 0x23, pageup: 0x21, pagedown: 0x22,
  ctrl: 0x11, control: 0x11, alt: 0x12, shift: 0x10, win: 0x5b, command: 0x5b, option: 0x12,
  capslock: 0x14, printscreen: 0x2c, insert: 0x2d,
  volumeup: 0xaf, volumedown: 0xae, volumemute: 0xad, playpause: 0xb3,
  "-": 0xbd, "=": 0xbb, "+": 0xbb, ",": 0xbc, ".": 0xbe, "/": 0xbf, ";": 0xba, "'": 0xde,
  "[": 0xdb, "]": 0xdd, "\\": 0xdc, "`": 0xc0,
};
for (let i = 1; i <= 12; i++) VK["f" + i] = 0x6f + i;
for (const c of "abcdefghijklmnopqrstuvwxyz") VK[c] = c.toUpperCase().charCodeAt(0);
for (const c of "0123456789") VK[c] = c.charCodeAt(0);

function vk(name) {
  const k = VK[String(name || "").toLowerCase()];
  if (k === undefined) throw new Error("tecla desconhecida: " + name);
  return k;
}

// [y, x] de 0..1000 -> pixels físicos da tela principal
function toPx(point, w, h) {
  if (!Array.isArray(point) || point.length !== 2) throw new Error("ponto inválido");
  const y = Math.min(1000, Math.max(0, Number(point[0])));
  const x = Math.min(1000, Math.max(0, Number(point[1])));
  if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error("ponto inválido");
  return [Math.round((x / 1000) * (w - 1)), Math.round((y / 1000) * (h - 1))];
}

// Converte uma ação do copiloto em uma lista de passos: {cmd} para o PowerShell, {paste} ou {sleep}
function plan(a, w, h) {
  const t = a && a.type;
  const out = [];
  const moveTo = (p) => { const [x, y] = toPx(p, w, h); out.push({ cmd: `move ${x} ${y}` }, { sleep: 90 }); };
  switch (t) {
    case "click": moveTo(a.point); out.push({ cmd: "click left 1" }); break;
    case "double_click": moveTo(a.point); out.push({ cmd: "click left 2" }); break;
    case "right_click": moveTo(a.point); out.push({ cmd: "click right 1" }); break;
    case "move": moveTo(a.point); break;
    case "drag": {
      moveTo(a.point); out.push({ cmd: "down" }, { sleep: 120 });
      const [x1, y1] = toPx(a.point, w, h), [x2, y2] = toPx(a.to, w, h);
      for (let i = 1; i <= 8; i++) out.push({ cmd: `move ${Math.round(x1 + ((x2 - x1) * i) / 8)} ${Math.round(y1 + ((y2 - y1) * i) / 8)}` }, { sleep: 40 });
      out.push({ cmd: "up" });
      break;
    }
    case "scroll": {
      if (a.point) moveTo(a.point);
      const n = Math.max(-25, Math.min(25, Math.round(Number(a.amount) || -5)));
      out.push({ cmd: `wheel ${n * 120}` });
      break;
    }
    case "type": {
      if (a.point) { moveTo(a.point); out.push({ cmd: "click left 1" }, { sleep: 150 }); }
      const text = String(a.text || "").slice(0, 2000);
      if (text) out.push({ paste: text });
      if (a.enter) out.push({ sleep: 120 }, { cmd: `key ${vk("enter")}` });
      break;
    }
    case "key": out.push({ cmd: `key ${vk(a.key)}` }); break;
    case "hotkey": {
      const keys = (Array.isArray(a.keys) ? a.keys : []).slice(0, 4);
      if (!keys.length) throw new Error("atalho vazio");
      out.push({ cmd: "key " + keys.map(vk).join("+") });
      break;
    }
    case "wait": out.push({ sleep: Math.round(Math.max(0.2, Math.min(5, Number(a.seconds) || 1)) * 1000) }); break;
    default: throw new Error("ação desconhecida: " + t);
  }
  return out;
}

function describe(a) {
  return ({ click: "clique", double_click: "clique duplo", right_click: "clique direito", move: "mover", drag: "arrastar",
    scroll: "rolar", type: "digitar", key: "tecla " + (a && a.key), hotkey: "atalho " + ((a && a.keys) || []).join("+"), wait: "esperar" })[a && a.type] || String(a && a.type);
}

module.exports = { VK, vk, toPx, plan, describe };
