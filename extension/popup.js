chrome.runtime.sendMessage({type: "status"}).then(state => {
  document.getElementById("status").textContent = state.connected
    ? "Native Messaging подключён"
    : "Нет подключения: " + (state.error || "запусти install.ps1 и перезапусти браузер.");
  document.getElementById("track").textContent = state.track || "Нет активного медиаплеера.";
  document.getElementById("artwork").textContent = state.hasArtwork
    ? "Обложка получена"
    : "Обложка: " + (state.artworkError || "ожидание метаданных");
  document.getElementById("artwork").style.overflowWrap = "anywhere";
}).catch(error => {
  document.getElementById("status").textContent = "Ошибка: " + error.message;
});
