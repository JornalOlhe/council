// Ponte entre o site do IA Council e a extensão (só roda no site oficial).
(() => {
  const VERSION = chrome.runtime.getManifest().version;
  window.addEventListener("message", (e) => {
    if (e.source !== window || !e.data || e.data.__iac !== "toExt") return;
    const { id, msg } = e.data;
    try {
      chrome.runtime.sendMessage(msg, (resp) => {
        const err = chrome.runtime.lastError;
        window.postMessage({ __iac: "fromExt", id, resp: err ? { error: err.message } : resp }, location.origin);
      });
    } catch (err) {
      window.postMessage({ __iac: "fromExt", id, resp: { error: "A extensão foi atualizada: recarregue a página (F5)." } }, location.origin);
    }
  });
  chrome.runtime.onMessage.addListener((m) => {
    if (m && m.__iacEvent) window.postMessage({ __iac: "event", ev: m.ev }, location.origin);
  });
  const hello = () => window.postMessage({ __iac: "ready", version: VERSION }, location.origin);
  hello();
  document.addEventListener("DOMContentLoaded", hello);
  window.addEventListener("load", hello);
})();
