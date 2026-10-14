(() => {
  "use strict";
  if (window.__dynamicIslandMediaInstalled) return;
  window.__dynamicIslandMediaInstalled = true;

  const MARKER = "dynamic-island-browser-media-v1";
  let previous = "";
  let lastSent = 0;
  let wasPublished = false;
  let lastClearSent = 0;
  let lastPageUrl = location.href;
  let missingPlayerSince = 0;
  let lastKnownMainPlayer = null;
  const PLAYER_CLOSE_GRACE_MS = 3000;
  let mostRecentPlayingElement = null;
  const handlers = new Map();

  // Read handlers installed by websites (YouTube and other Media Session clients).
  // Always pass them through unchanged, preserving the site's own behavior.
  if (navigator.mediaSession && typeof navigator.mediaSession.setActionHandler === "function") {
    const original = navigator.mediaSession.setActionHandler.bind(navigator.mediaSession);
    navigator.mediaSession.setActionHandler = function (action, handler) {
      if (typeof handler === "function") handlers.set(action, handler);
      else handlers.delete(action);
      return original(action, handler);
    };
  }

  function isYoutube() {
    return /(^|\.)youtube\.com$/i.test(location.hostname);
  }
  function isYoutubePlaybackPage() {
    return /^\/(watch|shorts\/[^/]+|live\/[^/]+)(?:\/|$)/.test(location.pathname) &&
      (location.pathname !== "/watch" ||
       /^[\w-]{11}$/.test(new URLSearchParams(location.search).get("v") || ""));
  }
  function youtubeMiniPlayerActive() {
    // YouTube moves the *same* #movie_player into ytd-miniplayer on SPA
    // navigation; a hover thumbnail never lives inside this container.
    const mini = document.querySelector("ytd-miniplayer");
    if (!mini || !mini.isConnected) return false;
    // Polymer can keep the 'hidden' attribute during the transition.
    // Check the actual movie-player container and its video rather than
    // relying solely on asynchronously updated active/hidden flags.
    const player = mini.querySelector?.("video.html5-main-video");
    if (player?.isConnected && !player.ended) return true;
    return !mini.hasAttribute("hidden") &&
      (mini.hasAttribute("active") ||
       mini.getAttribute("player-state") === "playing" ||
       mini.getAttribute("player-state") === "paused");
  }
  function bestMedia() {
    if (isYoutube()) {
      // The real watch player persists in YouTube's mini player. Merely
      // leaving /watch must not clear it; closing the mini player should.
      if (!isYoutubePlaybackPage() && !youtubeMiniPlayerActive()) return null;
      const player = document.querySelector("ytd-miniplayer video.html5-main-video") ||
                     document.querySelector("#movie_player video.html5-main-video");
      if (player && player.isConnected && !player.ended) {
        lastKnownMainPlayer = player;
        return player;
      }
      return null;
    }
    const all = Array.from(document.querySelectorAll("video, audio"));
    if (mostRecentPlayingElement && mostRecentPlayingElement.isConnected &&
        !mostRecentPlayingElement.paused && !mostRecentPlayingElement.ended) {
      return mostRecentPlayingElement;
    }
    const playing = all.filter(el => !el.paused && !el.ended);
    if (playing.length) {
      return playing.sort((a, b) => (b.videoWidth * b.videoHeight) - (a.videoWidth * a.videoHeight))[0];
    }
    return all.find(el => el === mostRecentPlayingElement) || all[0] || null;
  }

  function clean(value, limit = 600) {
    return typeof value === "string" ? value.trim().slice(0, limit) : "";
  }
  function finiteSeconds(value) {
    return Number.isFinite(value) && value >= 0 ? Math.round(value * 1000) : 0;
  }
  function titleFromPage() {
    return clean(document.title.replace(/\s*[-–—]\s*(YouTube|Яндекс Браузер|Yandex Browser)\s*$/i, ""));
  }
  function siteLabel() {
    if (/youtube\.com$|youtu\.be$/i.test(location.hostname)) return "YouTube";
    if (/music\.yandex\./i.test(location.hostname)) return "Яндекс Музыка";
    return clean(location.hostname, 150);
  }
  function artworkCandidates(meta) {
    const urls = [];
    const append = src => {
      if (!src || typeof src !== "string") return;
      try {
        const resolved = new URL(src, document.baseURI);
        if ((resolved.protocol === "https:" || resolved.protocol === "blob:" ||
             (resolved.protocol === "data:" && /^data:image\/(?:png|jpeg|webp|gif);base64,/i.test(resolved.href))) &&
            !urls.includes(resolved.href)) {
          urls.push(resolved.href);
        }
      } catch (_) {}
    };

    // Sites frequently expose several artwork sizes, formats and CDNs.
    // A particular URL may not be retrievable from an extension service worker.
    const artwork = meta && meta.artwork ? Array.from(meta.artwork) : [];
    artwork.sort((a, b) => (parseInt(b.sizes, 10) || 0) -
                             (parseInt(a.sizes, 10) || 0));
    for (const item of artwork) append(item.src);

    for (const selector of [
      'meta[property="og:image"]',
      'meta[name="twitter:image"]',
      'meta[property="og:image:secure_url"]'
    ]) {
      append(document.querySelector(selector)?.content);
    }

    // YouTube uses ?v=VIDEO_ID. The page URL sent to the native host
    // deliberately omits query strings; build safe public thumbnail URLs here.
    if (/(^|\.)youtube\.com$/i.test(location.hostname)) {
      let id = new URLSearchParams(location.search).get("v");
      if (!id && location.pathname.startsWith("/shorts/")) {
        id = location.pathname.split("/")[2];
      }
      if (id && /^[\w-]{11}$/.test(id)) {
        append("https://i.ytimg.com/vi/" + id + "/hqdefault.jpg");
        append("https://i.ytimg.com/vi/" + id + "/mqdefault.jpg");
      }
    }
    // The first choice is artwork actually supplied to the browser media
    // session. Only fall back to the public YouTube thumbnail if needed.
    return urls.slice(0, 12);
  }

  // Media Session artwork belongs to the page's JavaScript context.
  // A service worker cannot dereference blob: URLs originating in a tab.
  // Read the actual artwork here, turn it into a small JPEG and forward bytes.
  let coverKey = "";
  let coverBase64 = "";
  let coverRequest = 0;

  async function readArtworkInPage(source) {
    if (/^data:image\/(?:jpeg|png|webp|gif);base64,/i.test(source)) {
      const comma = source.indexOf(",");
      if (source.length - comma - 1 > 500000) return "";
    }
    const origin = new URL(source, document.baseURI);
    const response = await fetch(origin.href, {
      credentials: origin.origin === location.origin ? "include" : "omit",
      signal: AbortSignal.timeout(3000)
    });
    if (!response.ok) return "";
    const blob = await response.blob();
    if (!blob.type.startsWith("image/") || blob.size > 2500000 || blob.size < 1) return "";
    const bitmap = await createImageBitmap(blob);
    try {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 224;
      const context = canvas.getContext("2d");
      if (!context) return "";
      context.fillStyle = "#161616";
      context.fillRect(0, 0, 224, 224);
      const square = Math.min(bitmap.width, bitmap.height);
      if (!square) return "";
      context.drawImage(bitmap, (bitmap.width - square) / 2,
                        (bitmap.height - square) / 2, square, square,
                        0, 0, 224, 224);
      const encoded = canvas.toDataURL("image/jpeg", 0.82).split(",")[1] || "";
      return encoded.length <= 500000 ? encoded : "";
    } finally {
      bitmap.close();
    }
  }

  function requestPageArtwork(urls, title) {
    const key = title + "\n" + urls.join("\n");
    if (coverKey === key) return;
    coverKey = key;
    coverBase64 = "";
    const request = ++coverRequest;
    void (async () => {
      // Prefer the Media Session artwork in the page (including blob: URLs).
      // The background script retains independent HTTPS fallbacks.
      for (const url of urls.slice(0, 6)) {
        try {
          const encoded = await readArtworkInPage(url);
          if (request !== coverRequest) return;
          if (!encoded) continue;
          coverBase64 = encoded;
          emit(true);
          return;
        } catch (_) {}
      }
    })();
  }

  function snapshot() {
    const media = bestMedia();
    if (!media) return null;
    const meta = navigator.mediaSession && navigator.mediaSession.metadata;
    const artworkUrls = artworkCandidates(meta);
    const title = clean(meta && meta.title) || titleFromPage() || "Browser media";
    requestPageArtwork(artworkUrls, title);
    return {
      kind: MARKER,
      type: "media",
      playing: !media.paused && !media.ended,
      title,
      artist: clean(meta && meta.artist),
      album: clean(meta && meta.album),
      site: siteLabel(),
      positionMs: finiteSeconds(media.currentTime),
      durationMs: finiteSeconds(media.duration),
      artworkUrl: artworkUrls[0] || "",
      artworkUrls,
      artBase64: coverBase64,
      pageUrl: location.origin + location.pathname,
      youtubeMiniPlayer: isYoutube() && !isYoutubePlaybackPage() && youtubeMiniPlayerActive()
    };
  }

  function emit(force = false) {
    const now = Date.now();
    if (!force && now - lastSent < 1000) return;
    const data = snapshot();
    if (!data) {
      // A watch -> feed transition temporarily detaches the primary video
      // while Polymer moves it into the mini player. Do not clear on the
      // same navigation event; confirm a stable absence first.
      if (isYoutube() && wasPublished) {
        if (!missingPlayerSince) missingPlayerSince = now;
        if (now - missingPlayerSince < PLAYER_CLOSE_GRACE_MS) return;
      }
      if (wasPublished) {
        previous = "";
        coverKey = "";
        coverBase64 = "";
        ++coverRequest;
        wasPublished = false;
      }
      // Keep a fresh tombstone only after the watch player or mini player
      // has actually closed, not merely after navigation to the home feed.
      if (isYoutube() && (!lastClearSent || now - lastClearSent >= 3000)) {
        lastClearSent = now;
        window.postMessage({kind: MARKER, type: "clear"}, "*");
      }
      return;
    }
    missingPlayerSince = 0;
    wasPublished = true;
    const serialized = JSON.stringify(data);
    if (!force && serialized === previous && now - lastSent < 4000) return;
    previous = serialized;
    lastSent = now;
    window.postMessage(data, "*");
  }

  function mediaChanged(event) {
    if (event.target instanceof HTMLMediaElement) {
      if (isYoutube() && !event.target.matches("video.html5-main-video")) return;
      if (event.type === "play") mostRecentPlayingElement = event.target;
    }
    emit(true);
  }
  for (const event of ["play", "playing", "pause", "ended", "loadedmetadata", "durationchange", "seeked"]) {
    document.addEventListener(event, mediaChanged, true);
  }
  document.addEventListener("timeupdate", event => {
    if (isYoutube() && !event.target.matches?.("video.html5-main-video")) return;
    emit();
  }, true);
  // YouTube navigates via History API without reloading its document.
  for (const event of ["yt-navigate-start", "yt-navigate-finish",
                       "popstate", "pageshow"]) {
    window.addEventListener(event, () => queueMicrotask(() => emit(true)));
  }
  setInterval(() => {
    if (location.href !== lastPageUrl) {
      lastPageUrl = location.href;
      emit(true);
    }
  }, 250);

  function control(action, positionMs) {
    const el = bestMedia();
    if (!el) return;
    try {
      if (action === "seek") {
        if (!Number.isFinite(positionMs) || positionMs < 0) return;
        const time = positionMs / 1000;
        if (typeof el.fastSeek === "function") el.fastSeek(time);
        else el.currentTime = time;
      } else if (action === "toggle") {
        if (el.paused) void el.play().catch(() => {});
        else el.pause();
      } else if (action === "previous" || action === "next") {
        const mediaAction = action === "previous" ? "previoustrack" : "nexttrack";
        const handler = handlers.get(mediaAction);
        if (handler) handler({});
        else if (location.hostname.endsWith("youtube.com")) {
          const selector = action === "next" ? ".ytp-next-button" : ".ytp-prev-button";
          document.querySelector(selector)?.click();
        }
      }
      setTimeout(() => emit(true), 180);
    } catch (_) {
      // The website may reject the request; never break playback.
    }
  }

  window.addEventListener("message", event => {
    if (event.source !== window || !event.data ||
        event.data.kind !== MARKER || event.data.type !== "control") return;
    control(event.data.action, event.data.positionMs);
  });

  // Run after the DOM has loaded and keep position updated while in a background tab.
  document.addEventListener("DOMContentLoaded", () => emit(true), {once: true});
  setInterval(() => emit(), 1500);
})();
