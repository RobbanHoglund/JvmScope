"""Package the complete local marketplace, including dotfiles and bundled runtime."""
import json
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

repo = Path(__file__).resolve().parents[2]
root = repo / "build/codex-marketplace"
version = json.loads((root / "plugins/jvmscope/plugin.json").read_text(encoding="utf-8"))["version"]
destination = repo / "build" / f"jvmscope-codex-{version}.zip"
with ZipFile(destination, "w", ZIP_DEFLATED) as archive:
    for file in sorted(root.rglob("*")):
        if file.is_file():
            archive.write(file, file.relative_to(root).as_posix())
print(destination)
