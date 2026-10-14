const fs = require("fs");
const vm = require("vm");
const assert = require("assert");

(async () => {
  const messages = [];
  const domEvents = new Map();
  const media = {paused: false, ended: false, isConnected: true,
    muted: false, volume: 1, currentTime: 12, duration: 123,
    videoWidth: 300, videoHeight: 300};
  class FakeHTMLMediaElement {}
  Object.setPrototypeOf(media, FakeHTMLMediaElement.prototype);
  media.matches = () => true;
  const obj = {
    URL, Date, console, HTMLMediaElement: FakeHTMLMediaElement,
    location: new URL("https://www.youtube.com/watch?v=dQw4w9WgXcQ"),
    navigator: {mediaSession: { metadata: {title: "Test video", artist: "Test artist",
      artwork: [{src:"blob:https://www.youtube.com/art-test", sizes:"512x512"}]},
      setActionHandler() {}}},
    window: {
      addEventListener() {},
      postMessage(message) { messages.push(message); }
    },
    document: {
      title: "Test video - YouTube",
      baseURI: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      querySelectorAll(selector) { return selector === "video, audio" ? [media] : []; },
      querySelector(selector) {
        return selector.includes("video.html5-main-video") ? media : null;
      },
      addEventListener(name, callback) {domEvents.set(name, callback)},
      createElement(tag) {
        assert.equal(tag, "canvas");
        return {
          width: 0, height: 0,
          getContext() {return {fillRect(){},drawImage(){},set fillStyle(v) {}}},
          toDataURL() {return "data:image/jpeg;base64,QUJDRA==";}
        };
      }
    },
    fetch: async url => {
      assert(url.startsWith("blob:"));
      return {ok:true,blob:async()=>({type:"image/png",size:100})};
    },
    createImageBitmap: async () => ({width:400,height:400,close(){}}),
    AbortSignal, setTimeout, setInterval(){},
    URLSearchParams
  };
  vm.runInNewContext(fs.readFileSync(
    "C:/Projects/DynamicIslandBrowserMedia/extension/page-media.js","utf8"
  ), obj);
  domEvents.get("DOMContentLoaded")();
  for (let i=0;i<15 && !messages.some(m=>m.artBase64);i++)
    await new Promise(r=>setTimeout(r,20));
  assert(messages.some(m=>m.artBase64==="QUJDRA=="));
  assert(messages.some(m=>m.durationMs===123000));
  media.muted = true;
  domEvents.get("volumechange")({target:media,type:"volumechange"});
  assert.equal(messages.at(-1).audioMuted, true);
  media.muted = false;
  domEvents.get("volumechange")({target:media,type:"volumechange"});
  assert.equal(messages.at(-1).audioMuted, false);
  console.log("PASS: reads mediaSession.metadata.artwork blob URL in page context; posts JPEG base64 and duration");
})().catch(e=>{console.error(e);process.exit(1)});
