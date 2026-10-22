"""Build the distribution without importing inference or desktop libraries."""
import json
from pathlib import Path
import shutil
from setuptools import setup
from setuptools.command.build_py import build_py

ROOT = Path(__file__).resolve().parent


class BuildResources(build_py):
    def run(self):
        super().run()
        resources = Path(self.build_lib) / "cutris" / "resources"
        resources.mkdir(parents=True, exist_ok=True)
        for name in ("branding.json", "LICENSE", "THIRD_PARTY_NOTICES.md"):
            shutil.copyfile(ROOT / name, resources / name)
        for name in ("web", "packaging/assets"):
            shutil.copytree(ROOT / name, resources / name, dirs_exist_ok=True)


setup(version=json.loads((ROOT / "branding.json").read_text(encoding="utf-8"))["version"],
      cmdclass={"build_py": BuildResources})
