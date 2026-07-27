from __future__ import annotations

import os
import subprocess
import sys
import time
from pathlib import Path


def interval_seconds() -> int:
    try:
        value = int(os.environ.get("BACKUP_INTERVAL_SECONDS", "3600"))
    except ValueError as error:
        raise RuntimeError("BACKUP_INTERVAL_SECONDS_INVALID") from error

    if value < 900 or value > 86_400:
        raise RuntimeError("BACKUP_INTERVAL_SECONDS_INVALID")

    return value


def main() -> int:
    interval = interval_seconds()
    backup_script = Path(__file__).with_name("backup.py")

    while True:
        started_at = time.monotonic()
        result = subprocess.run(
            [sys.executable, str(backup_script)],
            check=False,
        )
        elapsed = time.monotonic() - started_at
        delay = max(60, interval - int(elapsed))

        if result.returncode not in (0, 1):
            return result.returncode

        time.sleep(delay)


if __name__ == "__main__":
    raise SystemExit(main())
