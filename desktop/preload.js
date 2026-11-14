// Ponte segura entre o site do IA Council e o controle do PC (só funciona dentro do app).
"use strict";
const { contextBridge, ipcRenderer } = require("electron");
const clean = (e) => { throw new Error(String((e && e.message) || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, "")); };
contextBridge.exposeInMainWorld("iaDesktop", {
  app: "ia-council-desktop",
  info: () => ipcRenderer.invoke("pc:info").catch(clean),
  screenshot: () => ipcRenderer.invoke("pc:shot").catch(clean),
  act: (a) => ipcRenderer.invoke("pc:act", a).catch(clean),
  mini: (on) => ipcRenderer.invoke("pc:mini", !!on).catch(clean),
  onStop: (cb) => { ipcRenderer.on("pc:stop", () => cb()); },
  updateState: () => ipcRenderer.invoke("app:update-state").catch(clean),
  checkUpdate: () => ipcRenderer.invoke("app:check-update").catch(clean),
  installUpdate: () => ipcRenderer.invoke("app:install-update").catch(clean),
  web: {
    open: (url) => ipcRenderer.invoke("web:open", url).catch(clean),
    snapshot: () => ipcRenderer.invoke("web:snapshot").catch(clean),
    act: (a) => ipcRenderer.invoke("web:act", a).catch(clean),
    working: (on, status) => ipcRenderer.invoke("web:working", !!on, status || "").catch(clean),
    show: (focus) => ipcRenderer.invoke("web:show", !!focus).catch(clean),
  },
  ext: {
    info: () => ipcRenderer.invoke("ext:info").catch(clean),
    sync: () => ipcRenderer.invoke("ext:sync").catch(clean),
    open: () => ipcRenderer.invoke("ext:open").catch(clean),
  },
  onUpdate: (cb) => { ipcRenderer.on("app:update", (_e, st) => cb(st)); },
});
