const vm = require("vm");
const fs = require("fs");
const assert = require("assert");

(async () => {
  const listeners = {};
  const hostMessages = [];
  const add = name => ({addListener(fn) {listeners[name] = fn;}});
  const port = {
    onMessage: add("nativeIncoming"),
    onDisconnect: add("nativeDisconnect"),
    postMessage(msg) {hostMessages.push(msg);}
  };
  const chrome = {
    runtime: {
      connectNative() {return port;},
      onMessage: add("extensionMessage"),
      onStartup: add("startup")
    },
    tabs: {
      onActivated: add("activated"),
      onRemoved: add("removed"),
      onUpdated: add("updated")
    }
  };
  let fetchCount = 0;
  const env = {
    console, Date, URL, Set, Map, Promise, btoa,
    chrome,
    fetch() {fetchCount++; throw new Error("Page JPEG should bypass fetch")},
    AbortSignal,
    setTimeout,
    clearTimeout
  };
  vm.runInNewContext(fs.readFileSync("C:/Projects/DynamicIslandBrowserMedia/extension/background.js","utf8"),env);
  listeners.extensionMessage({
    type:"media",
    data: {
      type:"media",
      kind:"dynamic-island-browser-media-v1",
      title:"Artist - Song",
      artist:"Artist",
      album:"Album",
      playing:true,
      site:"YouTube",
      pageUrl:"https://www.youtube.com/watch",
      durationMs:45000,
      positionMs:5000,
      artBase64:"QUJDRA==",
      artworkUrl:"blob:https://www.youtube.com/abcdef",
      artworkUrls:["blob:https://www.youtube.com/abcdef"]
    }
  },{tab:{id:10},frameId:0,url:"https://www.youtube.com/watch?v=dQw4w9WgXcQ"},()=>{});
  for (let i=0; i<20 && !hostMessages.some(m=>m.type==="media"); i++)
    await new Promise(r=>setTimeout(r,10));
  assert(hostMessages.some(m=>m.type==="media" && m.artBase64==="QUJDRA==" && m.durationMs===45000),JSON.stringify(hostMessages));
  assert.equal(fetchCount,0);
  console.log("PASS: background forwards in-page artwork bytes to Native Messaging without fetching again");
})().catch(e=>{console.error(e);process.exit(1)});
