"use strict";

const HOST_NAME = "dev.dekim.dynamic_island_media";
const frames = new Map();
const artCache = new Map();
const rejectedArt = new Map();
const lastGoodCover = new Map();
let artFailure = "";
let artPickedUrl = "";
let port = null;
let connected = false;
let nativeError = "";
let selectedFrame = null;
let lastTrack = "";
let publishing = false;
let pendingPublish = false;
let activeTab = -1;

function safeText(value, limit = 600) {
  return typeof value === "string" ? value.trim().slice(0, limit) : "";
}
function validNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ?
    Math.max(0, Math.min(Math.round(value), 86400000)) : 0;
}
function toFrameKey(tabId, frameId) { return String(tabId) + ":" + String(frameId); }

function ensureNative() {
  if (port) return;
  try {
    const newPort = chrome.runtime.connectNative(HOST_NAME);
    port = newPort;
    connected = false;
    nativeError = "";
    newPort.onMessage.addListener(message => {
      if (message?.type === "ready") {
        connected = true;
        void publish();
      } else if (message?.type === "command") {
        const chosen = selectedFrame || chooseFrame();
        if (chosen && ["toggle", "previous", "next", "seek"].includes(message.action)) {
          void chrome.tabs.sendMessage(chosen.tabId, {
            type: "control",
            action: message.action,
            positionMs: validNumber(message.positionMs)
          }, {frameId: chosen.frameId}).catch(() => {});
        }
      }
    });
    newPort.onDisconnect.addListener(() => {
      if (port !== newPort) return;
      nativeError = chrome.runtime.lastError?.message || "Native host disconnected";
      port = null;
      connected = false;
    });
  } catch (error) {
    port = null;
    nativeError = String(error);
    connected = false;
  }
}

function chooseFrame() {
  const now = Date.now();
  let candidates = [];
  for (const [key, value] of frames) {
    if (now - value.when > 6500) {
      frames.delete(key);
    } else {
      candidates.push(value);
    }
  }
  candidates.sort((a, b) =>
    Number(b.data.playing) - Number(a.data.playing) ||
    Number(b.tabId === activeTab) - Number(a.tabId === activeTab) ||
    b.when - a.when);
  return candidates[0] || null;
}

function safeArtworkUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) return "";
    const host = parsed.hostname.toLowerCase();
    if (!host || host === "localhost" || host.endsWith(".local") ||
        host.endsWith(".internal") || host.endsWith(".home.arpa") ||
        host === "[::1]" || /^[0-9.]+$/.test(host)) return "";
    return parsed.href;
  } catch (_) { return ""; }
}

async function artworkBase64(url) {
  if (!url) return "";
  if (artCache.has(url)) return artCache.get(url);
  if ((rejectedArt.get(url) || 0) > Date.now()) return "";
  try {
    const response = await fetch(url, {
      credentials: "omit",
      redirect: "error",
      referrerPolicy: "no-referrer",
      cache: "force-cache",
      signal: AbortSignal.timeout(3500)
    });
    if (!response.ok) throw new Error("HTTP " + response.status);
    const type = response.headers.get("content-type") || "";
    if (!/^image\/(jpeg|png|webp|gif|avif)/i.test(type))
      throw new Error("Not an image: " + type);
    const length = Number(response.headers.get("content-length") || 0);
    if (length > 3000000) throw new Error("Image > 3 MB");
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (!bytes.length || bytes.length > 3000000)
      throw new Error("Invalid size: " + bytes.length);

    // Windhawk uses the system WIC decoder: some Windows installations cannot
    // decode WebP/AVIF thumbnails. Normalize them to a small standard JPEG.
    let outputBytes = bytes;
    if (/webp|gif|avif/i.test(type) || bytes.length > 350000) {
      const bitmap = await createImageBitmap(new Blob([bytes], {type}));
      try {
        const scale = Math.min(1, 384 / Math.max(bitmap.width, bitmap.height));
        const canvas = new OffscreenCanvas(
          Math.max(1, Math.round(bitmap.width * scale)),
          Math.max(1, Math.round(bitmap.height * scale)));
        const context = canvas.getContext("2d", {alpha: false});
        if (!context) throw new Error("Cannot create canvas");
        context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        const jpeg = await canvas.convertToBlob({type: "image/jpeg", quality: 0.85});
        outputBytes = new Uint8Array(await jpeg.arrayBuffer());
      } finally {
        bitmap.close();
      }
    }
    if (!outputBytes.length || outputBytes.length > 400000)
      throw new Error("Converted image > 400 KB");
    let binary = "";
    for (let i = 0; i < outputBytes.length; i += 8192) {
      binary += String.fromCharCode(...outputBytes.subarray(i, i + 8192));
    }
    const base64 = btoa(binary);
    artCache.set(url, base64);
    rejectedArt.delete(url);
    artPickedUrl = url;
    artFailure = "";
    if (artCache.size > 20) artCache.delete(artCache.keys().next().value);
    return base64;
  } catch (error) {
    artFailure = String(error) + " — " + url.slice(0, 170);
    rejectedArt.set(url, Date.now() + 15000);
    if (rejectedArt.size > 60)
      rejectedArt.delete(rejectedArt.keys().next().value);
    return "";
  }
}

async function resolveArtwork(data, key) {
  const candidates = Array.isArray(data.artworkUrls)
    ? data.artworkUrls : [data.artworkUrl];
  const urls = [...new Set(candidates.map(safeArtworkUrl).filter(Boolean))];
  // In the background, prefer the independent public YouTube thumbnail.
  // The original mediaSession artwork takes priority when decoded in-page.
  const youtube = urls.filter(url => /^https:\/\/i\.ytimg\.com\/vi\//.test(url));
  const ordered = [...youtube, ...urls.filter(url => !youtube.includes(url))];
  let cover = "";
  for (const url of ordered.slice(0, 8)) {
    cover = await artworkBase64(url);
    if (cover) break;
  }
  if (cover) {
    lastGoodCover.set(key, cover);
    if (lastGoodCover.size > 15)
      lastGoodCover.delete(lastGoodCover.keys().next().value);
  } else {
    cover = lastGoodCover.get(key) || "";
    if (!urls.length) artFailure = "No public artwork URLs provided by page";
  }
  return cover;
}

async function publish() {
  if (publishing) { pendingPublish = true; return; }
  publishing = true;
  try {
    const chosen = chooseFrame();
    selectedFrame = chosen;
    if (!chosen) {
      if (connected && port) port.postMessage({type: "clear"});
      lastTrack = "";
      return;
    }

    ensureNative();
    if (!port) return;

    const data = chosen.data;
    const artKey = toFrameKey(chosen.tabId, chosen.frameId) + ":" + data.title;
    // Prefer the actual Media Session image extracted in the page context.
    // It may be a blob: URL that only the media tab can read.
    const pageCover = typeof data.artBase64 === "string" &&
      data.artBase64.length > 0 && data.artBase64.length <= 500000 &&
      /^[a-zA-Z0-9+/]+={0,2}$/.test(data.artBase64) ? data.artBase64 : "";
    const artBase64 = pageCover || await resolveArtwork(data, artKey);
    if (pageCover) {
      artFailure = "";
      artPickedUrl = "Media Session (page context)";
      lastGoodCover.set(artKey, pageCover);
    }
    const latest = chooseFrame();
    if (!latest || latest.tabId !== chosen.tabId ||
        latest.frameId !== chosen.frameId ||
        latest.data.title !== data.title) {
      pendingPublish = true;
      return;
    }
    lastTrack = data.title;
    port.postMessage({
      type: "media",
      playing: data.playing,
      title: data.title,
      artist: data.artist,
      album: data.album,
      site: data.site,
      positionMs: data.positionMs,
      durationMs: data.durationMs,
      artBase64
    });
  } catch (error) {
    nativeError = String(error);
  } finally {
    publishing = false;
    if (pendingPublish) {
      pendingPublish = false;
      void publish();
    }
  }
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message?.type === "status") {
    respond({connected, track: lastTrack, error: nativeError,
             artwork: artPickedUrl, artworkError: artFailure,
             hasArtwork: Boolean(lastTrack && [...lastGoodCover.keys()].some(k => k.endsWith(":" + lastTrack)))});
    return;
  }
  if (!["media", "clear"].includes(message?.type) || !sender.tab ||
      !/^https?:\/\//.test(sender.url || "")) return;
  if (message.type === "clear") {
    frames.delete(toFrameKey(sender.tab.id, sender.frameId || 0));
    void publish();
    return;
  }
  const data = message.data || {};
  if (data.kind !== "dynamic-island-browser-media-v1" || data.type !== "media" ||
      typeof data.playing !== "boolean") return;

  const tabId = sender.tab.id;
  const frameId = sender.frameId || 0;
  // YouTube preview videos can play for their entire duration. Only accept
  // the top-level watch/live/shorts player; never an iframe/hover preview.
  if (data.site === "YouTube") {
    const page = safeText(data.pageUrl, 2048);
    let valid = false;
    try {
      const parsed = new URL(page);
      valid = /(^|\.)youtube\.com$/i.test(parsed.hostname) &&
        (/^\/watch$/.test(parsed.pathname) ||
         /^\/(shorts|live)\/[^/]+/.test(parsed.pathname) ||
         data.youtubeMiniPlayer === true);
    } catch (_) {}
    if (frameId !== 0 || !valid) {
      frames.delete(toFrameKey(tabId, frameId));
      void publish();
      return;
    }
  }
  frames.set(toFrameKey(tabId, frameId), {
    tabId, frameId, when: Date.now(),
    data: {
      playing: data.playing,
      title: safeText(data.title),
      artist: safeText(data.artist),
      album: safeText(data.album),
      site: safeText(data.site, 150),
      artworkUrl: safeText(data.artworkUrl, 2048),
      artBase64: safeText(data.artBase64, 500000),
      artworkUrls: Array.isArray(data.artworkUrls)
        ? data.artworkUrls.slice(0, 12).map(u => safeText(u, 2048))
        : [],
      positionMs: validNumber(data.positionMs),
      durationMs: validNumber(data.durationMs)
    }
  });
  void publish();
});

chrome.tabs.onActivated.addListener(info => {
  activeTab = info.tabId;
  void publish();
});
chrome.tabs.onRemoved.addListener(tabId => {
  for (const [key, value] of frames) {
    if (value.tabId === tabId) frames.delete(key);
  }
  void publish();
});
chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (change.status !== "loading") return;
  for (const [key, value] of frames) {
    if (value.tabId === tabId) frames.delete(key);
  }
  void publish();
});
chrome.runtime.onStartup.addListener(() => { void publish(); });
