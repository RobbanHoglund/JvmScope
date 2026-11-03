import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('failed or corrupt archive builds preserve the previous downloadable package', () => {
    execFileSync('python3', ['-c', `
import importlib.util, sys
sys.dont_write_bytecode = True
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch
from zipfile import ZipFile
spec = importlib.util.spec_from_file_location('packager', sys.argv[1])
packager = importlib.util.module_from_spec(spec)
spec.loader.exec_module(packager)
with TemporaryDirectory() as directory:
    root = Path(directory)
    source = root / 'source'
    source.mkdir()
    (source / 'plugin.json').write_text('{"version":"test"}')
    destination = root / 'plugin.zip'
    packager.package_archive(source, destination)
    with ZipFile(destination) as archive:
        assert archive.read('plugin.json') == b'{"version":"test"}'
    previous = destination.read_bytes()
    for method, args in [('write', {'side_effect': OSError('simulated write failure')}), ('testzip', {'return_value': 'plugin.json'})]:
        with patch.object(packager.ZipFile, method, **args):
            try:
                packager.package_archive(source, destination)
            except (OSError, ValueError):
                pass
            else:
                raise AssertionError('packaging failure was hidden')
        assert destination.read_bytes() == previous
        assert not list(root.glob('*.tmp'))
`, fileURLToPath(new URL('../package.py', import.meta.url))]);
});
