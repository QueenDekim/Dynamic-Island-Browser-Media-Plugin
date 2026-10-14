const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const posted = [];
const timers = [];
const listeners = new Map();
const domListeners = new Map();
let url = new URL("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
class MediaElement {
  constructor(main, paused = false) {
    this.main = main; this.paused = paused; this.ended = false;
    this.isConnected = true; this.currentTime = 71; this.duration = 213;
    this.videoWidth = 1920; this.videoHeight = 1080;
  }
  matches(selector) { return selector === "video.html5-main-video" && this.main; }
}
const main = new MediaElement(true);
const hover = new MediaElement(false);
let miniActive = false;
const mini = {
  isConnected: true,
  hasAttribute(key) {return key === "active" ? miniActive : false;},
  getAttribute() {return null;}
};
const context = {
  URL, URLSearchParams, Date, console,
  HTMLMediaElement: MediaElement,
  get location() {return url},
  navigator: { mediaSession: {metadata: {title: "Full video",artist:"Artist",artwork:[]},
                             setActionHandler() {}} },
  window: {
    addEventListener(name, cb){listeners.set(name,cb)},
    postMessage(m){posted.push(m)}
  },
  document: {
    title:"Full video - YouTube",baseURI:url.href,
    querySelector(s) {
      if(s==="ytd-miniplayer") return mini;
      if(s==="#movie_player video.html5-main-video" ||
         s==="ytd-miniplayer video.html5-main-video") return main.isConnected?main:null;
      return null;
    },
    querySelectorAll(){return [hover,main]},
    addEventListener(name,cb){domListeners.set(name,cb)}
  },
  setInterval(cb){timers.push(cb)}, setTimeout(){},
  queueMicrotask(cb){cb()}
};
vm.runInNewContext(fs.readFileSync(path.join(__dirname,"page-media.js"),"utf8"),context);
domListeners.get("DOMContentLoaded")();
assert.equal(posted.at(-1).title,"Full video");
assert.equal(posted.at(-1).positionMs,71000);
main.paused=true;
domListeners.get("pause")({target: main,type:"pause"});
assert.equal(posted.at(-1).playing,false,"paused watch player must stay selected");
const length=posted.length;
hover.paused=false;
domListeners.get("play")({target:hover,type:"play"});
assert.equal(posted.length,length,"hover preview must never trigger source change");
domListeners.get("timeupdate")({target:hover,type:"timeupdate"});
assert.equal(posted.length,length,"preview progress must not update the island");
url = new URL("https://www.youtube.com/");
miniActive = true;
timers[0]();
assert.equal(posted.at(-1).type,"media","YouTube home miniplayer must retain actual video");
assert.equal(posted.at(-1).youtubeMiniPlayer,true,"YouTube miniplayer must be explicitly identified");
miniActive = false;
listeners.get("yt-navigate-finish")();
assert.equal(posted.at(-1).type,"clear","closing YouTube miniplayer must clear");
const afterClear=posted.length;
timers[1]();
assert.equal(posted.length,afterClear,"clear must not be spammed");
url=new URL("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
timers[0]();
assert.equal(posted.at(-1).type,"media","returning to watch page must restore player");
console.log("PASS watch player, complete hover preview ignored, miniplayer survives home SPA, close clears");
