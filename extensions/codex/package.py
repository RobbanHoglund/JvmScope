"""Package both the local marketplace and a standalone plugin archive."""
import json
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

repo = Path(__file__).resolve().parents[2]
root = repo / "build/codex-marketplace"
version = json.loads((root / "plugins/jvmscope/plugin.json").read_text(encoding="utf-8"))["version"]
for source, filename in [
    (root, f"jvmscope-codex-{version}.zip"),
    (root / "plugins/jvmscope", f"jvmscope-codex-plugin-{version}.zip"),
]:
    destination = repo / "build" / filename
    with ZipFile(destination, "w", ZIP_DEFLATED) as archive:
        for file in sorted(source.rglob("*")):
            if file.is_file():
                archive.write(file, file.relative_to(source).as_posix())
    print(destination)
