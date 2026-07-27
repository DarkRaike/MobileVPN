from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile
from contextlib import contextmanager
from datetime import datetime, timedelta
from pathlib import Path
from typing import Iterator

from backup_lib import (
    BackupError,
    build_manifest,
    create_online_backup,
    load_json_object,
    parse_json_path_list,
    require_absolute_file,
    utc_now,
    write_json_atomic,
)


def require_environment(name: str) -> str:
    value = os.environ.get(name, "").strip()

    if not value:
        raise BackupError(f"{name}_REQUIRED")

    return value


def log(level: str, **fields: object) -> None:
    print(
        json.dumps(
            {
                **fields,
                "level": level,
                "timestamp": utc_now().isoformat().replace("+00:00", "Z"),
            },
            separators=(",", ":"),
        ),
        file=sys.stderr if level == "error" else sys.stdout,
        flush=True,
    )


@contextmanager
def backup_lock(work_directory: Path) -> Iterator[None]:
    lock_path = work_directory / "backup.lock"

    try:
        descriptor = os.open(lock_path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    except FileExistsError as error:
        raise BackupError("BACKUP_ALREADY_RUNNING") from error

    try:
        os.write(descriptor, f"{os.getpid()}\n".encode())
        os.close(descriptor)
        yield
    finally:
        lock_path.unlink(missing_ok=True)


def copy_input(source: Path, destination: Path) -> None:
    source = source.resolve(strict=True)

    if source.is_dir():
        shutil.copytree(source, destination)
    elif source.is_file():
        destination.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        shutil.copy2(source, destination)
    else:
        raise BackupError("BACKUP_INCLUDE_PATH_INVALID")


def run_restic(arguments: list[str], cwd: Path | None = None) -> str:
    try:
        result = subprocess.run(
            ["restic", *arguments],
            cwd=cwd,
            check=True,
            capture_output=True,
            encoding="utf-8",
            timeout=3_600,
        )
    except FileNotFoundError as error:
        raise BackupError("RESTIC_NOT_INSTALLED") from error
    except subprocess.TimeoutExpired as error:
        raise BackupError("RESTIC_TIMEOUT") from error
    except subprocess.CalledProcessError as error:
        raise BackupError("RESTIC_COMMAND_FAILED") from error

    return result.stdout


def extract_snapshot_id(output: str) -> str:
    for line in reversed(output.splitlines()):
        try:
            value = json.loads(line)
        except json.JSONDecodeError:
            continue

        if (
            isinstance(value, dict)
            and value.get("message_type") == "summary"
            and isinstance(value.get("snapshot_id"), str)
        ):
            return value["snapshot_id"]

    raise BackupError("RESTIC_SNAPSHOT_ID_MISSING")


def list_project_snapshots() -> list[dict[str, object]]:
    try:
        value = json.loads(run_restic(["snapshots", "--json", "--tag", "astra-vpn"]))
    except json.JSONDecodeError as error:
        raise BackupError("RESTIC_SNAPSHOT_LIST_INVALID") from error

    if not isinstance(value, list):
        raise BackupError("RESTIC_SNAPSHOT_LIST_INVALID")

    return [snapshot for snapshot in value if isinstance(snapshot, dict)]


def apply_retention(now) -> None:
    run_restic(
        [
            "forget",
            "--keep-hourly",
            "48",
            "--keep-daily",
            "30",
            "--keep-weekly",
            "12",
            "--tag",
            "astra-vpn",
        ]
    )
    maximum_age = now - timedelta(days=84)
    expired_snapshot_ids: list[str] = []

    for snapshot in list_project_snapshots():
        snapshot_id = snapshot.get("id")
        snapshot_time = snapshot.get("time")

        if not isinstance(snapshot_id, str) or not isinstance(snapshot_time, str):
            raise BackupError("RESTIC_SNAPSHOT_LIST_INVALID")

        try:
            parsed_time = datetime.fromisoformat(
                snapshot_time.replace("Z", "+00:00")
            )
        except ValueError as error:
            raise BackupError("RESTIC_SNAPSHOT_LIST_INVALID") from error

        if parsed_time < maximum_age:
            expired_snapshot_ids.append(snapshot_id)

    if expired_snapshot_ids:
        run_restic(["forget", *expired_snapshot_ids])

    run_restic(["prune"])


def backup() -> None:
    app_database = require_absolute_file(
        Path(require_environment("APP_DATABASE_PATH")), "APP_DATABASE_PATH"
    )
    marzban_database = require_absolute_file(
        Path(require_environment("MARZBAN_DATABASE_PATH")), "MARZBAN_DATABASE_PATH"
    )
    work_directory = Path(require_environment("BACKUP_WORK_DIRECTORY"))
    status_file = Path(require_environment("BACKUP_STATUS_FILE"))
    release_version = require_environment("RELEASE_VERSION")
    public_paths = parse_json_path_list(
        os.environ.get("BACKUP_PUBLIC_INCLUDE_PATHS_JSON"),
        "BACKUP_PUBLIC_INCLUDE_PATHS_JSON",
    )
    secret_paths = parse_json_path_list(
        os.environ.get("BACKUP_SECRET_PATHS_JSON"),
        "BACKUP_SECRET_PATHS_JSON",
    )

    if not work_directory.is_absolute() or not status_file.is_absolute():
        raise BackupError("BACKUP_OUTPUT_PATHS_MUST_BE_ABSOLUTE")

    work_directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    created_at = utc_now()

    with backup_lock(work_directory):
        staging_directory = Path(
            tempfile.mkdtemp(prefix="astra-backup-", dir=work_directory)
        )
        os.chmod(staging_directory, 0o700)

        try:
            databases_directory = staging_directory / "databases"
            create_online_backup(
                app_database, databases_directory / "astra-vpn.sqlite"
            )
            create_online_backup(
                marzban_database, databases_directory / "marzban.sqlite3"
            )

            for index, path in enumerate(public_paths):
                copy_input(path, staging_directory / "release" / f"item-{index}")

            for index, path in enumerate(secret_paths):
                copy_input(path, staging_directory / "secrets" / f"item-{index}")

            manifest = build_manifest(
                staging_directory,
                release_version,
                created_at,
                ["databases/astra-vpn.sqlite", "databases/marzban.sqlite3"],
            )
            write_json_atomic(staging_directory / "manifest.json", manifest)
            snapshot_id = extract_snapshot_id(
                run_restic(
                    [
                        "backup",
                        ".",
                        "--json",
                        "--tag",
                        "astra-vpn",
                        "--tag",
                        "hourly",
                    ],
                    cwd=staging_directory,
                )
            )
            snapshots = list_project_snapshots()

            if not any(snapshot.get("id") == snapshot_id for snapshot in snapshots):
                raise BackupError("RESTIC_SNAPSHOT_NOT_CONFIRMED")

            run_restic(["check", "--read-data-subset=1/7"])
            apply_retention(created_at)
            write_json_atomic(
                status_file,
                {
                    "lastAttemptAt": created_at.isoformat().replace("+00:00", "Z"),
                    "lastSuccessAt": created_at.isoformat().replace("+00:00", "Z"),
                    "snapshotId": snapshot_id[:128],
                    "status": "success",
                },
                mode=0o644,
            )
            log("info", event="BACKUP_COMPLETED", snapshotId=snapshot_id[:12])
        finally:
            shutil.rmtree(staging_directory)


def main() -> int:
    status_file_value = os.environ.get("BACKUP_STATUS_FILE", "")
    status_file = Path(status_file_value) if status_file_value else None

    try:
        backup()
        return 0
    except BackupError as error:
        if status_file and status_file.is_absolute():
            previous_status = load_json_object(status_file)
            failed_status = {
                "lastAttemptAt": utc_now().isoformat().replace("+00:00", "Z"),
                "lastErrorCode": error.code,
                "status": "failed",
            }

            if isinstance(previous_status.get("lastSuccessAt"), str):
                failed_status["lastSuccessAt"] = previous_status["lastSuccessAt"]

            if isinstance(previous_status.get("snapshotId"), str):
                failed_status["snapshotId"] = previous_status["snapshotId"]

            try:
                write_json_atomic(status_file, failed_status, mode=0o644)
            except OSError:
                pass

        log("error", errorCode=error.code)
        return 1
    except Exception:
        log("error", errorCode="BACKUP_UNEXPECTED_FAILURE")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
