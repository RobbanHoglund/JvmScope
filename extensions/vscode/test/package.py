"""Validate the actual VSIX (including Markdown rewritten by vsce).

Run with Python 3 after `npm run package --prefix extensions/vscode`.
Only the standard library is used; this gate runs on the packaging job.
"""
import hashlib
import json
import posixpath
import re
import struct
import sys
import zipfile
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote, urlsplit
from xml.etree import ElementTree

extension = Path(__file__).resolve().parents[1]
root = extension.parents[1]
expected = json.loads((extension / "package.json").read_text())
package = Path(sys.argv[1]) if len(sys.argv) > 1 else root / "build/vscode" / f"jvmscope-{expected['version']}.vsix"

with zipfile.ZipFile(package) as archive:
    names = set(archive.namelist())
    assert len(names) == len(archive.namelist()), "Duplicate ZIP entries"
    assert not any(".." in name.split("/") or name.startswith("/") for name in names)
    assert all(name in {"extension.vsixmanifest", "[Content_Types].xml"} or re.fullmatch(
        r"extension/(?:package\.json|readme\.md|changelog\.md|LICENSE\.txt|NOTICE|THIRD-PARTY-NOTICES\.md|icon\.png|(?:src|media|resources)/.+)", name
    ) for name in names), "Unexpected development files in the release package"
    manifest = json.loads(archive.read("extension/package.json"))
    for key in ["name", "publisher", "version", "engines", "preview"]:
        assert manifest[key] == expected[key], f"Wrong packaged {key}"
    assert manifest["preview"] is False, "GA releases must not enable the Preview badge"
    assert not manifest.get("dependencies"), "Runtime dependencies need a new packaging review"
    assert "extension/" + manifest["main"].removeprefix("./") in names
    for item in manifest["contributes"]["viewsContainers"]["activitybar"]:
        assert "extension/" + item["icon"] in names
    # A missing toolbar image leaves a working command with an invisible button.
    # Check every declared variant in the actual archive, not just the source tree.
    for command in manifest["contributes"]["commands"]:
        command_icon = command.get("icon")
        if not command_icon or isinstance(command_icon, str) and command_icon.startswith("$("):
            continue
        paths = [command_icon] if isinstance(command_icon, str) else [command_icon["light"], command_icon["dark"]]
        for relative in paths:
            asset = "extension/" + relative
            assert asset in names, f"Missing command icon: {relative}"
            if relative.endswith(".svg"):
                svg = ElementTree.fromstring(archive.read(asset))
                assert svg.tag == "{http://www.w3.org/2000/svg}svg", relative
                viewbox = [float(value) for value in svg.attrib["viewBox"].split()]
                assert len(viewbox) == 4 and viewbox[2] > 0 and viewbox[3] > 0, relative
    icon = archive.read("extension/" + manifest["icon"])
    assert icon[:8] == b"\x89PNG\r\n\x1a\n"
    width, height = struct.unpack(">II", icon[16:24])
    assert width == height and width >= 128
    assert b"Apache License" in archive.read("extension/LICENSE.txt")
    assert archive.read("extension/NOTICE")
    assert archive.read("extension/THIRD-PARTY-NOTICES.md")
    xml = ElementTree.fromstring(archive.read("extension.vsixmanifest"))
    identity = xml.find(".//{*}Identity")
    assert identity.attrib["Id"] == expected["name"]
    assert identity.attrib["Publisher"] == expected["publisher"]
    assert identity.attrib["Version"] == expected["version"]
    gallery_flags = xml.findtext(".//{*}GalleryFlags", default="").split()
    assert "Preview" not in gallery_flags, "GA VSIX must not advertise Preview in Marketplace"
    assert not any(
        prop.get("Id") == "Microsoft.VisualStudio.Code.PreRelease"
        and prop.get("Value", "").lower() == "true"
        for prop in xml.findall(".//{*}Property")
    ), "GA VSIX must use the stable release channel"
    readme = archive.read("extension/readme.md").decode()
    assert "https://github.com/RobbanHoglund/JvmScope/blob/main/docs/VSCODE.md" in readme
    for document in [readme, archive.read("extension/changelog.md").decode()]:
        for image, target in re.findall(r"(!?)\[[^\]]*\]\(([^)]+)\)", document):
            url = urlsplit(target)
            assert ".." not in unquote(url.path).split("/"), f"Malformed Marketplace link: {target}"
            if image:
                assert url.scheme == "https" and not url.path.lower().endswith(".svg"), target

    class Assets(HTMLParser):
        def handle_starttag(self, tag, attributes):
            for key, value in attributes:
                if key not in {"src", "href"} or not value:
                    continue
                url = urlsplit(value)
                if url.scheme or url.netloc or not url.path:
                    continue
                asset = posixpath.normpath(posixpath.join(posixpath.dirname(self.page), url.path))
                if asset.startswith("assets/"):
                    assert "extension/media/" + asset in names, f"Missing resource: {asset}"

    pages = json.loads(archive.read("extension/media/pages.json"))
    assert {"index.html", "jvmscope/tda.html", "jvmscope/tls.html", "jvmscope/gc.html", "knowledge/index.html"} <= set(pages)
    for page in [*pages, 'ai-result.html']:
        parser = Assets()
        parser.page = page
        parser.feed(archive.read("extension/media/" + page).decode())
    assert 'extension/src/ai-result.cjs' in names
    assert b'markdown-it 15.0.2' in archive.read('extension/media/assets/legal/markdown-it-NOTICES.txt')

digest = hashlib.sha256(package.read_bytes()).hexdigest()
print(f"PASS: {package.name}: stable GA metadata, {len(names)} entries, {len(pages)} pages, {width}x{height} icon, valid assets, legal notices and Marketplace links. SHA-256: {digest}")
