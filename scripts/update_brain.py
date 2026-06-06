from pathlib import Path

EXTENSIONS = {".md", ".txt"}

files = []

for path in Path(".").rglob("*"):
    if path.is_file() and path.suffix.lower() in EXTENSIONS:
        files.append(path)

print(f"Found {len(files)} documents")

for file in sorted(files):
    try:
        content = file.read_text(encoding="utf-8")
        print(f"{file}: {len(content)} chars")
    except Exception as e:
        print(f"{file}: ERROR {e}")