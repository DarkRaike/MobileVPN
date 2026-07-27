from __future__ import annotations

import hashlib
import json
import os
import sqlite3
from contextlib import closing
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Iterable


class BackupError(RuntimeError):
    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


@dataclass(frozen=True)
class VerifiedDatabase:
    foreign_key_violations: int
    integrity: str
    path: Path


def utc_now() -> datetime:
    return datetime.now(UTC)


def parse_json_path_list(value: str | None, field: str) -> list[Path]:
    if not value:
        return []

    try:
        parsed = json.loads(value)
    except json.JSONDecodeError as error:
        raise BackupError(f"{field}_INVALID") from error

    if not isinstance(parsed, list) or not all(
        isinstance(item, str) and item for item in parsed
    ):
        raise BackupError(f"{field}_INVALID")

    paths = [Path(item) for item in parsed]

    if any(not path.is_absolute() for path in paths):
        raise BackupError(f"{field}_MUST_BE_ABSOLUTE")

    return paths


def require_absolute_file(path: Path, field: str) -> Path:
    if not path.is_absolute():
        raise BackupError(f"{field}_MUST_BE_ABSOLUTE")

    resolved = path.resolve(strict=True)

    if not resolved.is_file():
        raise BackupError(f"{field}_NOT_A_FILE")

    return resolved


def create_online_backup(source: Path, destination: Path) -> VerifiedDatabase:
    source = require_absolute_file(source, "DATABASE_PATH")
    destination.parent.mkdir(parents=True, exist_ok=True, mode=0o700)

    if destination.exists():
        raise BackupError("BACKUP_DESTINATION_EXISTS")

    source_uri = f"{source.as_uri()}?mode=ro"

    try:
        with (
            closing(
                sqlite3.connect(source_uri, uri=True, timeout=10)
            ) as source_connection,
            closing(sqlite3.connect(destination)) as destination_connection,
        ):
            source_connection.backup(destination_connection, pages=1_000, sleep=0.05)
            destination_connection.commit()
    except sqlite3.Error as error:
        raise BackupError("SQLITE_ONLINE_BACKUP_FAILED") from error

    os.chmod(destination, 0o600)
    return verify_database(destination)


def verify_database(path: Path) -> VerifiedDatabase:
    path = require_absolute_file(path, "BACKUP_DATABASE")

    try:
        with closing(
            sqlite3.connect(f"{path.as_uri()}?mode=ro", uri=True, timeout=10)
        ) as connection:
            integrity_rows = connection.execute("PRAGMA integrity_check").fetchall()
            foreign_key_rows = connection.execute(
                "PRAGMA foreign_key_check"
            ).fetchall()
    except sqlite3.Error as error:
        raise BackupError("SQLITE_VERIFICATION_FAILED") from error

    integrity = (
        str(integrity_rows[0][0])
        if len(integrity_rows) == 1 and integrity_rows[0]
        else "failed"
    )

    if integrity != "ok":
        raise BackupError("SQLITE_INTEGRITY_CHECK_FAILED")

    if foreign_key_rows:
        raise BackupError("SQLITE_FOREIGN_KEY_CHECK_FAILED")

    return VerifiedDatabase(
        foreign_key_violations=0,
        integrity=integrity,
        path=path,
    )


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()

    with path.open("rb") as source:
        while chunk := source.read(1024 * 1024):
            digest.update(chunk)

    return digest.hexdigest()


def iter_manifest_files(root: Path) -> Iterable[Path]:
    for path in sorted(root.rglob("*")):
        if (
            path.is_file()
            and path.name != "manifest.json"
            and "secrets" not in path.relative_to(root).parts
        ):
            yield path


def build_manifest(
    staging_directory: Path,
    release_version: str,
    created_at: datetime,
    database_names: list[str],
) -> dict[str, Any]:
    if not release_version or len(release_version) > 128:
        raise BackupError("RELEASE_VERSION_INVALID")

    files = [
        {
            "path": path.relative_to(staging_directory).as_posix(),
            "sha256": sha256_file(path),
            "sizeBytes": path.stat().st_size,
        }
        for path in iter_manifest_files(staging_directory)
    ]

    return {
        "contractVersion": 1,
        "createdAt": created_at.isoformat().replace("+00:00", "Z"),
        "databases": database_names,
        "excludedFromChecksums": ["secrets"],
        "files": files,
        "releaseVersion": release_version,
    }


def write_json_atomic(path: Path, value: object, mode: int = 0o600) -> None:
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    temporary_path = path.with_name(f".{path.name}.{os.getpid()}.tmp")

    try:
        with temporary_path.open("x", encoding="utf-8") as destination:
            json.dump(value, destination, ensure_ascii=False, separators=(",", ":"))
            destination.write("\n")
            destination.flush()
            os.fsync(destination.fileno())

        os.chmod(temporary_path, mode)
        temporary_path.replace(path)
    finally:
        temporary_path.unlink(missing_ok=True)


def load_json_object(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return {}

    return value if isinstance(value, dict) else {}


def validate_restore_target(target: Path, live_paths: Iterable[Path]) -> Path:
    if not target.is_absolute():
        raise BackupError("RESTORE_TARGET_MUST_BE_ABSOLUTE")

    resolved_target = target.resolve(strict=False)

    if resolved_target.exists():
        raise BackupError("RESTORE_TARGET_MUST_NOT_EXIST")

    for live_path in live_paths:
        resolved_live_path = live_path.resolve(strict=False)

        if (
            resolved_target == resolved_live_path
            or resolved_target in resolved_live_path.parents
            or resolved_live_path in resolved_target.parents
        ):
            raise BackupError("RESTORE_TARGET_OVERLAPS_LIVE_PATH")

    return resolved_target


def load_and_verify_manifest(manifest_path: Path) -> dict[str, Any]:
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError) as error:
        raise BackupError("RESTORE_MANIFEST_INVALID") from error

    if (
        not isinstance(manifest, dict)
        or manifest.get("contractVersion") != 1
        or not isinstance(manifest.get("releaseVersion"), str)
        or not isinstance(manifest.get("createdAt"), str)
        or not isinstance(manifest.get("databases"), list)
        or not isinstance(manifest.get("files"), list)
    ):
        raise BackupError("RESTORE_MANIFEST_INVALID")

    root = manifest_path.parent.resolve()

    for entry in manifest["files"]:
        if (
            not isinstance(entry, dict)
            or not isinstance(entry.get("path"), str)
            or not isinstance(entry.get("sha256"), str)
            or not isinstance(entry.get("sizeBytes"), int)
        ):
            raise BackupError("RESTORE_MANIFEST_INVALID")

        relative_path = Path(entry["path"])

        if relative_path.is_absolute() or ".." in relative_path.parts:
            raise BackupError("RESTORE_MANIFEST_PATH_INVALID")

        file_path = (root / relative_path).resolve(strict=False)

        if root not in file_path.parents or not file_path.is_file():
            raise BackupError("RESTORE_MANIFEST_PATH_INVALID")

        if (
            file_path.stat().st_size != entry["sizeBytes"]
            or sha256_file(file_path) != entry["sha256"]
        ):
            raise BackupError("RESTORE_CHECKSUM_MISMATCH")

    for database_path_value in manifest["databases"]:
        if not isinstance(database_path_value, str):
            raise BackupError("RESTORE_MANIFEST_INVALID")

        database_path = Path(database_path_value)

        if database_path.is_absolute() or ".." in database_path.parts:
            raise BackupError("RESTORE_MANIFEST_PATH_INVALID")

        resolved_database_path = (root / database_path).resolve(strict=False)

        if (
            root not in resolved_database_path.parents
            or not resolved_database_path.is_file()
        ):
            raise BackupError("RESTORE_MANIFEST_PATH_INVALID")

    return manifest
