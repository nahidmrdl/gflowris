"""Headless commands; GUI libraries are imported only by the desktop command."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

from app_paths import VERSION, public_error


def main(argv=None):
    parser = argparse.ArgumentParser(prog="cutris", description="Local background removal, with or without a desktop app.")
    parser.add_argument("--version", action="version", version=VERSION)
    sub = parser.add_subparsers(dest="command", required=True)
    remove = sub.add_parser("remove", help="Remove backgrounds and save transparent PNGs.")
    remove.add_argument("inputs", type=Path, nargs="+")
    remove.add_argument("-o", "--output", type=Path, required=True, help="PNG filename for one input, or an output directory.")
    remove.add_argument("--quality", choices=["detail", "fast"], default="detail")
    remove.add_argument("--mode", choices=["ai", "white"], default="ai")
    remove.add_argument("--no-auto-crop", action="store_true")
    remove.add_argument("--resize", metavar="WIDTHxHEIGHT")
    remove.add_argument("--offline", action="store_true", help="Use installed models only; never download.")
    remove.add_argument("--overwrite", action="store_true")
    remove.add_argument("--json", action="store_true", help="Write result metadata as JSON to stdout.")
    api = sub.add_parser("serve", help="Run the authenticated HTTP API on loopback.")
    api.add_argument("--port", type=int, default=4320)
    api.add_argument("--key-file", type=Path)
    api.add_argument("--descriptor", type=Path)
    api.add_argument("--download-models", action="store_true")
    models = sub.add_parser("models", help="Inspect or download shared AI models.")
    models.add_argument("action", choices=["list", "download"], default="list", nargs="?")
    models.add_argument("--quality", choices=["detail", "fast", "all"], default="detail")
    editor = sub.add_parser("desktop", help="Open the editor (requires the desktop extra).")
    editor.add_argument("--project", help="Open an editable project created by the API.")
    args = parser.parse_args(argv)
    try:
        if args.command == "desktop":
            from desktop import main as open_desktop
            return open_desktop(["--project", args.project] if args.project else [])
        if args.command == "serve":
            from .service import serve
            serve(port=args.port, key_file=args.key_file, descriptor=args.descriptor, download_models=args.download_models)
            return 0
        if args.command == "models":
            from model_manager import ensure_model, model_status
            if args.action == "download":
                for quality in (["detail", "fast"] if args.quality == "all" else [args.quality]):
                    ensure_model(quality, progress=lambda event: print(event.message, file=sys.stderr))
            print(json.dumps({"models": model_status()}, indent=2))
            return 0
        from .processing import MAX_BYTES, Processor, write_output
        resize = None
        if args.resize:
            import re
            match = re.fullmatch(r"([1-9][0-9]*)x([1-9][0-9]*)", args.resize)
            if not match:
                raise ValueError("Resize must be WIDTHxHEIGHT, for example 512x512.")
            resize = {"width": int(match[1]), "height": int(match[2])}
        sources = []
        for entry in args.inputs:
            if entry.is_dir():
                sources.extend(sorted(p for p in entry.iterdir() if p.suffix.lower() in {".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tif", ".tiff"} and p.is_file()))
            else:
                sources.append(entry)
        if not sources:
            raise ValueError("No supported input images found.")
        single = len(sources) == 1 and args.output.suffix.lower() == ".png" and not args.output.is_dir()
        targets = [args.output if single else args.output / (source.stem + "-cutout.png") for source in sources]
        if len({target.resolve() for target in targets}) != len(targets):
            raise ValueError("Inputs would produce duplicate output names. Process them separately.")
        source_paths = {source.resolve() for source in sources}
        for target in targets:
            if target.resolve() in source_paths:
                raise ValueError("Output must differ from every input image.")
            if target.exists() and not args.overwrite:
                raise ValueError("An output already exists. Choose another folder or use --overwrite.")
        worker = Processor()
        results = []
        for source, target in zip(sources, targets):
            with source.open("rb") as stream:
                content = stream.read(MAX_BYTES + 1)
            image, metadata = worker.remove(content, quality=args.quality, mode=args.mode,
                                           auto_crop=not args.no_auto_crop, resize=resize,
                                           download_models=not args.offline,
                                           progress=lambda stage: print(stage, file=sys.stderr))
            write_output(image, target, overwrite=args.overwrite)
            results.append({"input": str(source), "output": str(target), **metadata})
            if not args.json:
                print(str(target))
        if args.json:
            print(json.dumps(results, indent=2))
        return 0
    except (Exception, KeyboardInterrupt) as exc:
        print("cutris: " + public_error(exc, "Operation failed. Check inputs, output permissions, and model installation."), file=sys.stderr)
        return 130 if isinstance(exc, KeyboardInterrupt) else 1
