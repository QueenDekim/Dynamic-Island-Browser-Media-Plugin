(() => {
  "use strict";
  const MARKER = "dynamic-island-browser-media-v1";
  window.addEventListener("message", event => {
    if (event.source !== window) return;
    const msg = event.data;
    if (!msg || msg.kind !== MARKER || msg.type !== "media") return;
    if (typeof msg.playing !== "boolean" || typeof msg.title !== "string") return;
    try {
      chrome.runtime.sendMessage({type: "media", data: msg}, () => {
        void chrome.runtime.lastError;
      });
    } catch (_) {}
  });
  chrome.runtime.onMessage.addListener(message => {
    if (message?.type !== "control") return;
    if (!["toggle", "next", "previous", "seek"].includes(message.action)) return;
    window.postMessage({
      kind: MARKER,
      type: "control",
      action: message.action,
      positionMs: message.positionMs || 0
    }, "*");
  });
})();
