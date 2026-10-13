import base64, hashlib, json, os, struct, sys, threading, time
from pathlib import Path

BASE = Path(os.environ["LOCALAPPDATA"]) / "DynamicIslandBrowserMedia"
STATE = BASE / "state.tsv"
COMMAND = BASE / "command.txt"
LOCK = threading.Lock()
STOP = threading.Event()

def send(payload):
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    with LOCK:
        sys.stdout.buffer.write(struct.pack("<I", len(data)) + data)
        sys.stdout.buffer.flush()

def atomic_write(path, payload):
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_bytes(payload)
    os.replace(tmp, path)

def tidy(value, size):
    if not isinstance(value, str):
        return ""
    return "".join(" " if c in "\r\n\t\x00" else c for c in value.strip())[:size]

def as_ms(value):
    if isinstance(value, bool) or not isinstance(value, (float, int)):
        return 0
    return max(0, min(86400000, int(value)))

def save_media(message):
    cover = ""
    encoded = message.get("artBase64", "")
    if isinstance(encoded, str) and len(encoded) < 600000:
        try:
            raw = base64.b64decode(encoded, validate=True)
            valid = (raw.startswith(b"\xff\xd8\xff")
                     or raw.startswith(b"\x89PNG\r\n\x1a\n")
                     or raw.startswith(b"RIFF") and raw[8:12] == b"WEBP"
                     or raw.startswith((b"GIF87a", b"GIF89a")))
            if 0 < len(raw) <= 400000 and valid:
                cover = hashlib.sha256(raw).hexdigest()
                dst = BASE / ("cover-" + cover + ".bin")
                if not dst.exists():
                    atomic_write(dst, raw)
        except (ValueError, OSError):
            cover = ""
    lines = [
        "DIBRIDGE1",
        "1" if message.get("playing") is True else "0",
        tidy(message.get("title"), 600),
        tidy(message.get("artist"), 600),
        tidy(message.get("album"), 600),
        tidy(message.get("site"), 150),
        str(as_ms(message.get("positionMs"))),
        str(as_ms(message.get("durationMs"))),
        cover
    ]
    atomic_write(STATE, ("\n".join(lines) + "\n").encode("utf-8"))

def clear_state():
    try:
        STATE.unlink(missing_ok=True)
    except OSError:
        pass

def watch_commands():
    seen = COMMAND.stat().st_mtime_ns if COMMAND.exists() else None
    while not STOP.wait(0.15):
        try:
            modified = COMMAND.stat().st_mtime_ns
            if seen == modified:
                continue
            seen = modified
            parts = COMMAND.read_text(encoding="ascii").splitlines()
            if not parts or parts[0] not in ("toggle", "next", "previous", "seek"):
                continue
            position = int(parts[1]) if len(parts) > 1 else 0
            send({"type": "command", "action": parts[0],
                  "positionMs": max(0, min(position, 86400000))})
        except (FileNotFoundError, ValueError, OSError):
            pass

def main():
    BASE.mkdir(parents=True, exist_ok=True)
    threading.Thread(target=watch_commands, daemon=True).start()
    send({"type": "ready", "protocol": 1})
    try:
        while True:
            size_bytes = sys.stdin.buffer.read(4)
            if len(size_bytes) != 4:
                break
            size, = struct.unpack("<I", size_bytes)
            if size <= 0 or size > 1024 * 1024:
                break
            payload = sys.stdin.buffer.read(size)
            if len(payload) != size:
                break
            try:
                message = json.loads(payload)
                if isinstance(message, dict):
                    if message.get("type") == "media":
                        save_media(message)
                    elif message.get("type") == "clear":
                        clear_state()
            except (ValueError, OverflowError, OSError):
                pass
    finally:
        STOP.set()
        clear_state()
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
