import subprocess, pathlib
p = pathlib.Path(r"C:\Projects\DynamicIslandBrowserMedia\native\launcher.exe")
r = subprocess.run([str(p)], input=b"", stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=5)
print("EXIT:",r.returncode)
print("STDOUT:",repr(r.stdout[:300]))
print("STDERR:",repr(r.stderr[:300]))
print("PYTHON-PATH:",(p.parent / "python-path.txt").read_bytes())
