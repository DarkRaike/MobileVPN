from __future__ import annotations

import json
import os
import sqlite3
import subprocess
import sys
import tempfile
from contextlib import closing
from pathlib import Path

import backup


def create_database(path: Path, label: str) -> None:
    with closing(sqlite3.connect(path)) as connection:
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute(
            "CREATE TABLE records (id INTEGER PRIMARY KEY, label TEXT NOT NULL)"
        )
        connection.execute(
            "INSERT INTO records (id, label) VALUES (1, ?)", (label,)
        )
        connection.commit()


def main() -> int:
    with tempfile.TemporaryDirectory(prefix="astra-local-drill-") as directory:
        root = Path(directory)
        sources = root / "sources"
        sources.mkdir()
        app_database = sources / "astra-vpn.sqlite"
        marzban_database = sources / "marzban.sqlite3"
        create_database(app_database, "app")
        create_database(marzban_database, "marzban")

        repository = root / "restic-repository"
        password_file = root / "restic-password"
        password_file.write_text("local-drill-password\n", encoding="utf-8")
        os.chmod(password_file, 0o600)
        environment = {
            **os.environ,
            "APP_DATABASE_PATH": str(app_database),
            "BACKUP_PUBLIC_INCLUDE_PATHS_JSON": "[]",
            "BACKUP_SECRET_PATHS_JSON": "[]",
            "BACKUP_STATUS_FILE": str(root / "operations" / "backup-status.json"),
            "BACKUP_WORK_DIRECTORY": str(root / "work"),
            "MARZBAN_DATABASE_PATH": str(marzban_database),
            "RELEASE_VERSION": "local-drill",
            "RESTIC_PASSWORD_FILE": str(password_file),
            "RESTIC_REPOSITORY": str(repository),
        }
        os.environ.update(environment)
        subprocess.run(
            ["restic", "init"],
            check=True,
            capture_output=True,
            encoding="utf-8",
            env=environment,
        )
        backup.backup()
        status = json.loads(
            Path(environment["BACKUP_STATUS_FILE"]).read_text(encoding="utf-8")
        )
        snapshot_id = status["snapshotId"]
        restore_target = root / "restore-drill"
        restore_environment = {
            **environment,
            "RESTORE_LIVE_PATHS_JSON": json.dumps([str(sources)]),
        }
        result = subprocess.run(
            [
                sys.executable,
                str(Path(__file__).with_name("restore_drill.py")),
                "--snapshot",
                snapshot_id,
                "--target",
                str(restore_target),
                "--expected-release",
                "local-drill",
            ],
            check=False,
            capture_output=True,
            encoding="utf-8",
            env=restore_environment,
        )

        if result.returncode != 0:
            raise RuntimeError("LOCAL_RESTORE_DRILL_FAILED")

        evidence = json.loads(result.stdout)

        if not evidence.get("withinObjectives") or evidence.get("databaseCount") != 2:
            raise RuntimeError("LOCAL_RESTORE_EVIDENCE_INVALID")

        print(
            json.dumps(
                {
                    "databaseCount": evidence["databaseCount"],
                    "releaseVersion": evidence["releaseVersion"],
                    "status": "ok",
                    "withinObjectives": evidence["withinObjectives"],
                },
                separators=(",", ":"),
            )
        )
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
