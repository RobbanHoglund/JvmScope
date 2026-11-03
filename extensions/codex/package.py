"""Package both the local marketplace and a standalone plugin archive."""
import json
import os
from pathlib import Path
from tempfile import NamedTemporaryFile
from zipfile import ZIP_DEFLATED, ZipFile


def package_archive(source, destination):
    """Expose the destination only after the complete archive passes CRC checks."""
    temporary = None
    try:
        with NamedTemporaryFile(dir=destination.parent, prefix=f".{destination.name}.", suffix=".tmp", delete=False) as output:
            temporary = Path(output.name)
            with ZipFile(output, "w", ZIP_DEFLATED) as archive:
                for file in sorted(source.rglob("*")):
                    if file.is_file():
                        archive.write(file, file.relative_to(source).as_posix())
            output.flush()
            os.fsync(output.fileno())
        with ZipFile(temporary) as archive:
            if archive.testzip() is not None:
                raise ValueError("Packaged archive failed its CRC check")
        os.replace(temporary, destination)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


if __name__ == "__main__":
    repo = Path(__file__).resolve().parents[2]
    root = repo / "build/codex-marketplace"
    version = json.loads((root / "plugins/jvmscope/plugin.json").read_text(encoding="utf-8"))["version"]
    for source, filename in [
        (root, f"jvmscope-codex-{version}.zip"),
        (root / "plugins/jvmscope", f"jvmscope-codex-plugin-{version}.zip"),
    ]:
        destination = repo / "build" / filename
        package_archive(source, destination)
        print(destination)
