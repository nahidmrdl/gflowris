"""Release inputs, privacy boundaries, and relocatable registration."""
import base64
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
from release_utils import audit, release_body, source_files, version
from launch import configure


class ReleaseTests(unittest.TestCase):
    def test_version_validation(self):
        for text in ('1.0.0', '1.0.1', '65535.0.2'):
            self.assertEqual(version(text), text)
        for text in ('v1.0.0', '01.0.0', '1.2', '65536.0.0', '1.0.0; echo x', None):
            with self.assertRaises(ValueError):
                version(text)

    def test_notes_split_semicolons_and_preserve_plain_text(self):
        body = release_body('First change; Second\nchange ; ; Keep $literal `code`')
        self.assertIn('- First change\n- Second change\n- Keep $literal `code`\n', body)
        with self.assertRaises(ValueError):
            release_body(' ; ; ')

    def test_source_selection_excludes_credentials_and_models(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for name in ('README.md', '.local/session.json', 'scripts/x.py', 'vendor/cutris/models/secret.onnx', 'node_modules/x.js'):
                file = root / name
                file.parent.mkdir(parents=True, exist_ok=True)
                file.write_text('fixture')
            self.assertEqual([p.relative_to(root).as_posix() for p in source_files(root)], ['README.md', 'scripts/x.py'])

    def test_privacy_fails_without_echoing_identity(self):
        with tempfile.TemporaryDirectory() as directory:
            file = Path(directory) / 'fixture.txt'
            file.write_text(r'C:\Users\PrivatePerson\Pictures\fixture.png')
            with self.assertRaises(RuntimeError) as found:
                audit([file])
            self.assertNotIn('PrivatePerson', str(found.exception))
            file.write_text('https://github.com/nahidmrdl/gflowris')
            audit([file])

    def test_public_key_matches_fixed_extension_id(self):
        data = json.loads((ROOT / 'packaging/extension-identity.json').read_text())
        digest = hashlib.sha256(base64.b64decode(data['key'])).hexdigest()[:32]
        self.assertEqual(data['id'], ''.join(chr(97 + int(n, 16)) for n in digest))

    def test_bootstrap_relocates_paths_and_keeps_existing_settings(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / 'folder with spaces'
            for name in ('runtime/node/node.exe', 'runtime/python/python.exe', 'native/gflowris-host.exe'):
                file = root / name
                file.parent.mkdir(parents=True, exist_ok=True)
                file.write_bytes(b'fixture')
            (root / 'packaging').mkdir()
            (root / 'packaging/extension-identity.json').write_bytes((ROOT / 'packaging/extension-identity.json').read_bytes())
            settings = root / '.local/state/settings.json'
            settings.parent.mkdir(parents=True)
            settings.write_text('{"preserved":true}')
            runtime = configure(root, register=False)
            self.assertEqual(runtime['pythonExe'], str(root / 'runtime/python/python.exe'))
            self.assertEqual(json.loads(settings.read_text()), {'preserved': True})
            descriptor = json.loads((root / '.local/native-host/com.automationflowgen.bridge.json').read_text())
            self.assertEqual(len(descriptor['allowed_origins']), 1)
            self.assertTrue(Path(descriptor['path']).is_file())
            configure(root, register=False)


if __name__ == '__main__':
    unittest.main()
