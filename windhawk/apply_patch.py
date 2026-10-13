"""Integrate browser native messaging bridge with Dynamic Island source."""
from pathlib import Path
import shutil
import sys

SOURCE = Path(r"C:\ProgramData\Windhawk\EditorWorkspace\mod.wh.cpp")
HERE = Path(__file__).resolve().parent
OUTPUT = HERE / "mod.wh.cpp"
BACKUP = HERE / "mod.before-browser-bridge.wh.cpp"

def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected exactly one match, got {count}")
    return text.replace(old, new, 1)

original = SOURCE.read_bytes()
newline = "\r\n" if b"\r\n" in original else "\n"
text = original.decode("utf-8-sig").replace("\r\n", "\n")
if "browser_media_bridge.h" in text:
    raise RuntimeError("Windhawk bridge was already integrated; refusing to patch twice")

text = replace_once(
    text,
    "    bool browserAudioFallback = false; // No controllable GSMTC session for this source",
    "    bool browserAudioFallback = false; // No controllable GSMTC session for this source\n"
    "    bool browserBridge = false; // Native Messaging media metadata from browser extension",
    "MediaSnapshot field"
)
text = replace_once(
    text,
    "DWORD WINAPI MediaThreadProc(void*) {",
    '#include "C:/Projects/DynamicIslandBrowserMedia/windhawk/browser_media_bridge.h"\n\n'
    "DWORD WINAPI MediaThreadProc(void*) {",
    "Include browser bridge"
)
text = replace_once(
    text,
    "        bool trackJustChanged = false;\n        {\n            std::lock_guard lock(g_stateMutex);",
    """        // Prefer real tab metadata from the local Yandex Browser extension.
        // The bridge also works when the browser doesn't export a GSMTC session.
        if (preferBrowser) {
            MediaSnapshot browserBridgeSnapshot;
            if (TryReadBrowserBridgeSnapshot(&browserBridgeSnapshot)) {
                bool keepPausedBrowser = false;
                {
                    std::lock_guard lock(g_stateMutex);
                    keepPausedBrowser = g_state.media.browserBridge && !next.playing;
                }
                if (browserBridgeSnapshot.playing || keepPausedBrowser) {
                    next = std::move(browserBridgeSnapshot);
                    recentBrowserAudio = {};
                    lastBrowserAudioAt = -100.0;
                }
            }
        }

        bool trackJustChanged = false;
        {
            std::lock_guard lock(g_stateMutex);""",
    "Bridge snapshot selection"
)
text = replace_once(
    text,
    """        {
            std::lock_guard lock(g_stateMutex);
            if (g_state.media.browserAudioFallback) return;
        }
        winrt::init_apartment(winrt::apartment_type::multi_threaded);""",
    """        {
            std::lock_guard lock(g_stateMutex);
            if (g_state.media.browserBridge) {
                SendBrowserBridgeCommand("seek", targetTicks / 10000);
                return;
            }
            if (g_state.media.browserAudioFallback) return;
        }
        winrt::init_apartment(winrt::apartment_type::multi_threaded);""",
    "Seek browser bridge"
)
text = replace_once(
    text,
    """        bool isBrowserFallback = false;
        {
            std::lock_guard lock(g_stateMutex);
            isBrowserFallback = g_state.media.browserAudioFallback;
        }
        if (isBrowserFallback) {""",
    """        bool isBrowserFallback = false;
        bool isBrowserBridge = false;
        {
            std::lock_guard lock(g_stateMutex);
            isBrowserFallback = g_state.media.browserAudioFallback;
            isBrowserBridge = g_state.media.browserBridge;
        }
        if (isBrowserBridge) {
            const char* action = cmd == 0 ? "previous" : cmd == 2 ? "next" : "toggle";
            SendBrowserBridgeCommand(action);
            winrt::uninit_apartment();
            return;
        }
        if (isBrowserFallback) {""",
    "Browser transport controls"
)
BACKUP.write_bytes(original)
text = text.replace("\n", newline)
OUTPUT.write_bytes(text.encode("utf-8-sig") if original.startswith(b"\xef\xbb\xbf") else text.encode("utf-8"))
print(f"Backup: {BACKUP}")
print(f"Patched: {OUTPUT}")
print("Windhawk bridge code included; browser metadata, artwork, timeline and controls enabled.")
