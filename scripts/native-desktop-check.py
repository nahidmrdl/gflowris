"""Compatibility entry point for the complete embedded editor check."""
from pathlib import Path
import runpy
runpy.run_path(str(Path(__file__).with_name("embedded-check.py")),run_name="__main__")
