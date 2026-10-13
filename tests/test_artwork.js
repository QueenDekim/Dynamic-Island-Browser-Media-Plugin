const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..", "extension");

(async () => {
  const sent = [];
  const callbacks = {};
  const video = {paused:false, ended:false, currentTime:75.5,
                 duration:217.741, videoWidth:1920, videoHeight:1080};
  const document = {
    title: "natori - Serenade - YouTube",
    baseURI: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    querySelectorAll: () => [video],
    querySelector: selector => selector.includes('og:image')
      ? {content: "https://example.com/blocked.jpg"} : null,
    addEventListener: (key, fn) => { callbacks[key] = fn; }
  };
  const pageContext = {
    window: {postMessage: data => sent.push(data), addEventListener: ()=>{}},
    document,
    navigator: {mediaSession: {metadata: {
      title: "natori - Serenade", artist: "natori",
      artwork: [{src: "https://example.com/blocked.jpg", sizes: "512x512"}]
    }, setActionHandler(){}}},
    location: {hostname:"www.youtube.com", origin:"https://www.youtube.com",
      pathname:"/watch", search:"?v=dQw4w9WgXcQ"},
    URL, URLSearchParams, setInterval: () => {}, setTimeout: () => {},
    HTMLMediaElement: Object
  };
  vm.runInNewContext(fs.readFileSync(path.join(root, "page-media.js"), "utf8"),
                     pageContext);
  callbacks.DOMContentLoaded();
  assert.equal(sent[0].durationMs, 217741);
  assert.equal(sent[0].positionMs, 75500);
  assert.ok(sent[0].artworkUrls.some(u => u.includes("/dQw4w9WgXcQ/hqdefault.jpg")));
  assert.ok(sent[0].artworkUrls.some(u => u.includes("blocked.jpg")));
  console.log("PASS: content script provides YouTube fallback and metadata");

  const listeners = [];
  const chrome = {
    runtime: {onMessage: {addListener: cb => listeners.push(cb)},
      onStartup: {addListener(){}}, connectNative(){throw new Error("not required")}},
    tabs: {onActivated:{addListener(){}},onUpdated:{addListener(){}},
      onRemoved:{addListener(){}}}
  };
  const tinyJpeg = Uint8Array.from([0xff,0xd8,0xff,0xe0,0,1,2,3,0xff,0xd9]);
  const calls = [];
  const ctx = vm.createContext({
    chrome, URL, AbortSignal, Uint8Array, Blob, Date, Map, Set, String, Array,
    btoa: str => Buffer.from(str, "binary").toString("base64"),
    fetch: async url => {
      calls.push(url);
      if (url.includes("blocked.jpg")) return {ok:false,status:403,
        headers:{get:()=>null}};
      return {ok:true,status:200,
        headers:{get:k=>k==="content-type"?"image/jpeg":null},
        arrayBuffer:async()=>tinyJpeg.buffer};
    },
  });
  vm.runInContext(fs.readFileSync(path.join(root, "background.js"), "utf8"), ctx);
  const first = await vm.runInContext(
    'resolveArtwork({artworkUrls:["https://example.com/blocked.jpg", ' +
    '"https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg"]}, "1:0:test")',ctx);
  assert.equal(Buffer.from(first,"base64").length,10);
  // Public YouTube thumbnail now has priority over inaccessible artwork,
  // so the blocked URL should not be fetched at all on the first pass.
  assert.equal(calls.length,1);
  assert.ok(calls[0].includes("i.ytimg.com"));
  const second = await vm.runInContext(
    'resolveArtwork({artworkUrls:["https://example.com/blocked.jpg"]}, "1:0:test")',ctx);
  assert.equal(second,first);
  console.log("PASS: artwork falls back to next URL, caches per track");
})().catch(error => {console.error(error);process.exitCode=1;});
