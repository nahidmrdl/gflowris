"""Small native setup dialog; no server or AI runtime is needed to download models."""
from __future__ import annotations

import queue
import sys
import threading
import tkinter as tk
from app_paths import APP_NAME, RESOURCE_DIR
from tkinter import ttk
from typing import Iterable

from model_manager import (
    MODELS, ModelDownloadCancelled, ModelDownloadError, ModelProgress,
    ensure_models, installed_models,
)


def run_model_setup(qualities: Iterable[str] | None = None, *,
                    parent: tk.Misc | None = None, required: bool = False) -> bool:
    """Show model selection/download progress and return whether setup finished.

    Select both models by default. ``qualities`` changes the initially selected
    models (app qualities ``detail``/``fast``). With ``required=True`` the dialog
    describes the download as first-run setup. Cancellation never enables an
    unverified model and a later invocation resumes a partial download.
    Call this function on the main GUI thread.
    """
    selected = set(MODELS if qualities is None else qualities)
    if not selected <= MODELS.keys():
        raise ValueError("Choose the Fast or Best detail AI model.")
    window = tk.Tk() if parent is None else tk.Toplevel(parent)
    window.title(f"{APP_NAME} — AI model setup")
    icon = RESOURCE_DIR / "packaging" / "assets" / "app.ico"
    if sys.platform == "win32" and icon.is_file():
        try:
            window.iconbitmap(default=str(icon))
        except tk.TclError:
            # A missing Windows icon handler must not block model setup.
            pass
    window.geometry("570x470")
    window.minsize(530, 440)
    if parent is not None:
        window.transient(parent)
    window.configure(background="#f5f5f7")
    frame = ttk.Frame(window, padding=24)
    frame.pack(fill="both", expand=True)
    ttk.Label(frame, text="Set up your AI models", font=("Segoe UI", 19, "bold")).pack(anchor="w")
    introduction = ("Choose the models to download before you start."
                    if required else "Download or verify the models you want to use.")
    ttk.Label(frame, text=introduction, wraplength=510).pack(anchor="w", pady=(12, 4))
    ttk.Label(frame, text="Models download once from the public BiRefNet release.\n"
              "Your images stay on this computer. Removal works offline after setup.",
              wraplength=510).pack(anchor="w", pady=(0, 16))
    available = installed_models()
    variables: dict[str, tk.BooleanVar] = {}
    checkboxes = []
    for quality, spec in MODELS.items():
        value = tk.BooleanVar(window, value=quality in selected)
        variables[quality] = value
        local = " — Installed" if available[quality] else " — Not installed"
        checkbox = ttk.Checkbutton(frame, variable=value,
                                   text=f"{spec.label} — {spec.size / 1_000_000:.0f} MB{local}")
        checkbox.pack(anchor="w", pady=5)
        checkboxes.append(checkbox)
    ttk.Label(frame, text="Both models need about 1.2 GB of storage. Downloads can be resumed.",
              wraplength=510).pack(anchor="w", pady=(12, 18))
    status = tk.StringVar(window, value="Choose at least one model, then start setup.")
    ttk.Label(frame, textvariable=status, wraplength=510).pack(anchor="w")
    progressbar = ttk.Progressbar(frame, maximum=100, mode="determinate")
    progressbar.pack(fill="x", pady=(12, 6))
    detail = tk.StringVar(window, value="")
    ttk.Label(frame, textvariable=detail, wraplength=510).pack(anchor="w")
    actions = ttk.Frame(frame)
    actions.pack(side="bottom", fill="x", pady=(20, 0))
    events: queue.Queue[tuple[str, object]] = queue.Queue()
    stop = threading.Event()
    state = {"running": False, "success": False, "closing": False}

    def close() -> None:
        if state["running"]:
            stop.set()
            state["closing"] = True
            status.set("Cancelling download…")
            detail.set("Your partial download will be kept. This may take a few seconds.")
            cancel_button.configure(state="disabled")
        else:
            window.destroy()

    def worker(chosen: list[str]) -> None:
        try:
            ensure_models(chosen, lambda update: events.put(("progress", update)), stop.is_set)
            events.put(("complete", None))
        except ModelDownloadCancelled:
            events.put(("cancelled", None))
        except ModelDownloadError as error:
            events.put(("error", str(error)))
        except Exception:
            # A setup dialog must not disclose local paths or account details
            # through an unexpected exception message.
            events.put(("error", "Setup could not finish. Please close it and retry."))

    def start() -> None:
        if state["success"]:
            close()
            return
        chosen = [quality for quality, value in variables.items() if value.get()]
        if not chosen:
            status.set("Select at least one AI model to continue.")
            return
        state["running"] = True
        state["closing"] = False
        stop.clear()
        for checkbox in checkboxes:
            checkbox.configure(state="disabled")
        start_button.configure(state="disabled")
        status.set("Checking selected models…")
        detail.set("Preparing setup…")
        progressbar.configure(mode="indeterminate")
        progressbar.start(10)
        threading.Thread(target=worker, args=(chosen,), name="model-setup", daemon=True).start()

    def poll() -> None:
        while True:
            try:
                kind, payload = events.get_nowait()
            except queue.Empty:
                break
            if kind == "progress":
                update: ModelProgress = payload
                if state["closing"]:
                    continue
                status.set(update.message)
                if update.phase in {"downloading", "ready"}:
                    progressbar.stop()
                    progressbar.configure(mode="determinate", value=100 * update.downloaded / update.total)
                    detail.set(f"{update.downloaded / 1_000_000:.1f} / {update.total / 1_000_000:.1f} MB")
                else:
                    progressbar.stop()
                    progressbar.configure(mode="indeterminate")
                    progressbar.start(10)
                    detail.set("Checking model integrity…" if update.phase == "checking" else "Resuming automatically…")
                continue
            state["running"] = False
            progressbar.stop()
            progressbar.configure(mode="determinate")
            if kind == "complete":
                state["success"] = True
            if state["closing"]:
                window.destroy()
                return
            if kind == "complete":
                progressbar.configure(value=100)
                status.set("Your AI models are ready.")
                detail.set("You can now remove backgrounds without an internet connection.")
                start_button.configure(text="Finish", state="normal")
                cancel_button.configure(state="disabled")
            else:
                status.set("Download cancelled." if kind == "cancelled" else "Setup needs attention.")
                detail.set("Run setup again to resume your download." if kind == "cancelled" else str(payload))
                start_button.configure(text="Retry setup", state="normal")
                cancel_button.configure(text="Close", state="normal")
                for checkbox in checkboxes:
                    checkbox.configure(state="normal")
        window.after(100, poll)

    cancel_button = ttk.Button(actions, text="Cancel" if required else "Close", command=close)
    cancel_button.pack(side="left")
    start_button = ttk.Button(actions, text="Start setup", command=start)
    start_button.pack(side="right")
    window.protocol("WM_DELETE_WINDOW", close)
    window.after(100, poll)
    window.update_idletasks()
    width, height = window.winfo_width(), window.winfo_height()
    window.geometry(f"+{max(0, (window.winfo_screenwidth() - width) // 2)}"
                    f"+{max(0, (window.winfo_screenheight() - height) // 2)}")
    window.lift()
    window.focus_force()
    if parent is None:
        window.mainloop()
    else:
        window.grab_set()
        parent.wait_window(window)
    return state["success"]
