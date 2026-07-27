from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from datetime import UTC, datetime
from pathlib import Path

from backup_lib import (
    BackupError,
    load_and_verify_manifest,
    parse_json_path_list,
    utc_now,
    validate_restore_target,
    verify_database,
    write_json_atomic,
)


def parse_arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Restore an offsite backup for a drill")
    parser.add_argument("--snapshot", required=True)
    parser.add_argument("--target", required=True, type=Path)
    parser.add_argument("--expected-release")
    return parser.parse_args()


def restore_snapshot(snapshot: str, target: Path) -> None:
    if not snapshot or len(snapshot) > 128:
        raise BackupError("RESTORE_SNAPSHOT_ID_INVALID")

    try:
        subprocess.run(
            ["restic", "restore", snapshot, "--target", str(target)],
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
        raise BackupError("RESTIC_RESTORE_FAILED") from error


def find_single_manifest(target: Path) -> Path:
    manifests = list(target.rglob("manifest.json"))

    if len(manifests) != 1:
        raise BackupError("RESTORE_MANIFEST_NOT_UNIQUE")

    return manifests[0]


def parse_created_at(value: object) -> datetime:
    if not isinstance(value, str):
        raise BackupError("RESTORE_MANIFEST_INVALID")

    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(UTC)
    except ValueError as error:
        raise BackupError("RESTORE_MANIFEST_INVALID") from error


def drill() -> dict[str, object]:
    arguments = parse_arguments()
    live_paths = parse_json_path_list(
        os.environ.get("RESTORE_LIVE_PATHS_JSON"), "RESTORE_LIVE_PATHS_JSON"
    )
    target = validate_restore_target(arguments.target, live_paths)
    started_at = utc_now()
    target.mkdir(parents=True, mode=0o700)

    try:
        restore_snapshot(arguments.snapshot, target)
        manifest_path = find_single_manifest(target)
        manifest = load_and_verify_manifest(manifest_path)

        if (
            arguments.expected_release
            and manifest["releaseVersion"] != arguments.expected_release
        ):
            raise BackupError("RESTORE_RELEASE_MISMATCH")

        database_paths = manifest["databases"]

        if not all(isinstance(path, str) for path in database_paths):
            raise BackupError("RESTORE_MANIFEST_INVALID")

        verified_databases = [
            verify_database((manifest_path.parent / path).resolve())
            for path in database_paths
        ]
        completed_at = utc_now()
        rpo_minutes = max(
            0,
            int(
                (
                    started_at - parse_created_at(manifest["createdAt"])
                ).total_seconds()
                // 60
            ),
        )
        rto_minutes = max(
            0, int((completed_at - started_at).total_seconds() // 60)
        )
        evidence = {
            "completedAt": completed_at.isoformat().replace("+00:00", "Z"),
            "databaseCount": len(verified_databases),
            "integrityChecks": ["ok" for _ in verified_databases],
            "releaseVersion": manifest["releaseVersion"],
            "rpoMinutes": rpo_minutes,
            "rtoMinutes": rto_minutes,
            "snapshotId": arguments.snapshot,
            "startedAt": started_at.isoformat().replace("+00:00", "Z"),
            "withinObjectives": rpo_minutes <= 60 and rto_minutes <= 240,
        }
        write_json_atomic(target / "restore-drill-evidence.json", evidence)
        return evidence
    except Exception:
        # The disposable target is intentionally preserved for investigation.
        raise


def main() -> int:
    try:
        evidence = drill()
        print(json.dumps(evidence, separators=(",", ":")))
        return 0 if evidence["withinObjectives"] else 2
    except BackupError as error:
        print(
            json.dumps(
                {
                    "errorCode": error.code,
                    "level": "error",
                    "timestamp": utc_now().isoformat().replace("+00:00", "Z"),
                },
                separators=(",", ":"),
            ),
            file=sys.stderr,
        )
        return 1
    except Exception:
        print(
            json.dumps(
                {
                    "errorCode": "RESTORE_DRILL_UNEXPECTED_FAILURE",
                    "level": "error",
                    "timestamp": utc_now().isoformat().replace("+00:00", "Z"),
                },
                separators=(",", ":"),
            ),
            file=sys.stderr,
        )
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
