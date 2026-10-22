"""Apply the workflow version only to this build; never edit the default branch."""
import json
import os
from release_utils import ROOT, version, release_body

value = version(os.environ.get('RELEASE_VERSION'))
body = release_body(os.environ.get('RELEASE_NOTES'))
for name in ('package.json', 'package-lock.json', 'extension/manifest.json'):
    file = ROOT / name
    data = json.loads(file.read_text(encoding='utf-8'))
    data['version'] = value
    if name == 'package-lock.json':
        data['packages']['']['version'] = value
    file.write_text(json.dumps(data, indent=2) + '\n', encoding='utf-8')
control = ROOT / 'build' / 'release-control'
control.mkdir(parents=True, exist_ok=True)
(control / 'notes.md').write_text(body, encoding='utf-8')
(control / 'request.json').write_text(json.dumps({'version': value, 'tag': 'v' + value,
    'source_sha': os.environ.get('GITHUB_SHA', ''), 'repository': os.environ.get('GITHUB_REPOSITORY', '')}, indent=2) + '\n', encoding='utf-8')
print('Prepared gflowris ' + value)
