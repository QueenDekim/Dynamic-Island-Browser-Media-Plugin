import base64, json, os, pathlib, struct, subprocess, sys, time, tempfile, shutil

sandbox = tempfile.mkdtemp(prefix="dib-bridge-test-")
base = pathlib.Path(sandbox) / "DynamicIslandBrowserMedia"
cmd = base / "command.txt"
native = pathlib.Path(__file__).resolve().parents[1] / "native"
launcher = native / "launcher.exe"
host_command = [str(launcher)] if launcher.exists() else [
    sys.executable, "-u", str(native / "host.py")
]
env = os.environ.copy()
env["LOCALAPPDATA"] = sandbox
p = subprocess.Popen(host_command, env=env,
                     stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                     stderr=subprocess.PIPE)

def receive():
    size_data = p.stdout.read(4)
    if len(size_data) != 4:
        raise AssertionError("native host closed connection")
    size = struct.unpack("<I", size_data)[0]
    return json.loads(p.stdout.read(size))

def send(payload):
    data = json.dumps(payload).encode()
    p.stdin.write(struct.pack("<I", len(data)) + data)
    p.stdin.flush()

try:
    ready = receive()
    assert ready["type"] == "ready", ready
    png = base64.b64encode(base64.b64decode(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO2L/YQAAAAASUVORK5CYII=")).decode()
    send({"type": "media", "playing": True, "title": "Тестовый трек",
          "artist": "Тестовый исполнитель", "album": "Тестовый альбом",
          "site": "YouTube", "positionMs": 15000, "durationMs": 182000,
          "artBase64": png})
    deadline = time.time() + 3
    while not (base / "state.tsv").exists() and time.time() < deadline:
        time.sleep(.05)
    data = (base / "state.tsv").read_text(encoding="utf-8").splitlines()
    assert data[0] == "DIBRIDGE1" and data[2] == "Тестовый трек", data
    assert data[7] == "182000", data
    assert len(data[8]) == 64, data
    cmd.write_text("toggle\n0\n", encoding="ascii")
    response = receive()
    assert response["type"] == "command" and response["action"] == "toggle", response
    print("PASS: Native Messaging protocol, UTF-8, title, artist, duration, artwork, commands")
finally:
    p.stdin.close()
    p.wait(timeout=5)
    shutil.rmtree(sandbox, ignore_errors=True)
