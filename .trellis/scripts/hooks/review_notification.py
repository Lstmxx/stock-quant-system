#!/usr/bin/env python3
"""Notify the developer when a Trellis task is ready for human review."""

from __future__ import annotations

import argparse
import json
import os
import shlex
import shutil
import subprocess
import sys
from pathlib import Path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--open",
        dest="repo_path",
        type=Path,
        help="Open the repository in VS Code (used by the notification action).",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print the notification payload without displaying it.",
    )
    return parser.parse_args()


def repository_root() -> Path:
    result = subprocess.run(
        ["git", "rev-parse", "--show-toplevel"],
        check=True,
        capture_output=True,
        text=True,
    )
    return Path(result.stdout.strip()).resolve()


def open_vscode(repo_path: Path) -> int:
    code = shutil.which("code")
    if code is None:
        print("VS Code CLI not found; install the 'code' command in PATH.", file=sys.stderr)
        return 1

    subprocess.Popen(
        [code, "--reuse-window", str(repo_path.resolve())],
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        start_new_session=True,
    )
    return 0


def task_title(task_json_path: Path | None) -> str:
    if task_json_path is None:
        return "Completed Trellis task"

    try:
        task = json.loads(task_json_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return task_json_path.parent.name

    title = task.get("title") or task.get("name")
    return str(title) if title else task_json_path.parent.name


def notify(repo_path: Path, task: str, dry_run: bool) -> int:
    title = "Ready for code review"
    message = f"{task} · {repo_path.name}"
    terminal_notifier = shutil.which("terminal-notifier")

    if dry_run:
        print(json.dumps({"title": title, "message": message, "repo": str(repo_path)}))
        return 0

    if terminal_notifier:
        open_command = shlex.join(
            [sys.executable, str(Path(__file__).resolve()), "--open", str(repo_path)]
        )
        return subprocess.run(
            [
                terminal_notifier,
                "-title",
                title,
                "-message",
                message,
                "-group",
                f"trellis-review-{repo_path}",
                "-execute",
                open_command,
            ],
            check=False,
        ).returncode

    if sys.platform == "darwin":
        script = "display notification (item 1 of argv) with title (item 2 of argv)"
        return subprocess.run(
            ["osascript", "-e", script, message, title],
            check=False,
        ).returncode

    print(f"{title}: {message}", file=sys.stderr)
    return 0


def main() -> int:
    args = parse_args()
    if args.repo_path is not None:
        return open_vscode(args.repo_path)

    repo_path = repository_root()
    raw_task_path = os.environ.get("TASK_JSON_PATH")
    task_json_path = Path(raw_task_path) if raw_task_path else None
    return notify(repo_path, task_title(task_json_path), args.dry_run)


if __name__ == "__main__":
    raise SystemExit(main())
