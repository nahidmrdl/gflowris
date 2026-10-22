# Contributing

Keep changes focused and run checks relevant to the behavior being changed.

```powershell
npm ci
npm test
python -B -m unittest discover -s test -p test_release.py -v
python -B scripts/audit_source.py
```

UI checks use generated fixtures and headless Chrome without a Google login. Full native editor checks additionally need a configured Cutris environment.

Check Flow selectors and download handling against a connected project before release. Never retry an ambiguous Generate action automatically. Preserve originals, saved revisions, and cancellation boundaries.

Do not commit `.local`, browser profiles, credentials, models, or workstation paths. Keep required third-party attribution. Screenshots and examples must be free of account details.

`vendor/cutris` is a reviewed runtime snapshot. Update it deliberately from Cutris, preserve notices, and run embedded editing checks. See [provenance](vendor/README.md).
