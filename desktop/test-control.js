// node test-control.js — testa a conversão de ações em comandos de mouse/teclado
const assert = require("assert");
const c = require("./control.js");
assert.deepStrictEqual(c.plan({ type: "click", point: [500, 250] }, 1920, 1080), [{ cmd: "move 480 540" }, { sleep: 90 }, { cmd: "click left 1" }]);
assert.deepStrictEqual(c.plan({ type: "click", point: [1000, 1000] }, 1920, 1080)[0], { cmd: "move 1919 1079" });
assert.deepStrictEqual(c.plan({ type: "click", point: [-50, 5000] }, 1920, 1080)[0], { cmd: "move 1919 0" });
assert.deepStrictEqual(c.plan({ type: "hotkey", keys: ["alt", "tab"] }, 1, 1), [{ cmd: "key 18+9" }]);
assert.deepStrictEqual(c.plan({ type: "key", key: "win" }, 1, 1), [{ cmd: "key 91" }]);
assert.deepStrictEqual(c.plan({ type: "type", text: "olá, mundo", enter: true }, 1, 1), [{ paste: "olá, mundo" }, { sleep: 120 }, { cmd: "key 13" }]);
assert.deepStrictEqual(c.plan({ type: "scroll", amount: -3 }, 1, 1), [{ cmd: "wheel -360" }]);
assert.strictEqual(c.plan({ type: "drag", point: [0, 0], to: [1000, 1000] }, 101, 101).filter((s) => s.cmd && s.cmd.startsWith("move")).pop().cmd, "move 100 100");
assert.throws(() => c.plan({ type: "key", key: "rm -rf" }, 1, 1), /tecla desconhecida/);
assert.throws(() => c.plan({ type: "shell", cmd: "del" }, 1, 1), /ação desconhecida/);
assert.throws(() => c.plan({ type: "click" }, 1, 1), /ponto inválido/);
assert.strictEqual(c.vk("F5"), 0x74);
console.log("12 testes do controle do PC passaram");
