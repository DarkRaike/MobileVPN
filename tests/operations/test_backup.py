from __future__ import annotations

import json
import sqlite3
import tempfile
import unittest
from contextlib import closing
from datetime import UTC, datetime
from pathlib import Path

import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts"))

from backup_lib import (  # noqa: E402
    BackupError,
    build_manifest,
    create_online_backup,
    load_and_verify_manifest,
    validate_restore_target,
)


class BackupTests(unittest.TestCase):
    def test_online_backup_is_consistent_and_manifest_is_verified(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            source = root / "source.sqlite"
            destination = root / "snapshot" / "app.sqlite"

            with closing(sqlite3.connect(source)) as connection:
                connection.execute("PRAGMA foreign_keys = ON")
                connection.execute(
                    "CREATE TABLE parent (id INTEGER PRIMARY KEY)"
                )
                connection.execute(
                    "CREATE TABLE child ("
                    "id INTEGER PRIMARY KEY,"
                    "parent_id INTEGER NOT NULL REFERENCES parent(id)"
                    ")"
                )
                connection.execute("INSERT INTO parent (id) VALUES (1)")
                connection.execute(
                    "INSERT INTO child (id, parent_id) VALUES (1, 1)"
                )
                connection.commit()

            verification = create_online_backup(source.resolve(), destination)
            self.assertEqual(verification.integrity, "ok")
            self.assertEqual(verification.foreign_key_violations, 0)

            manifest = build_manifest(
                destination.parent,
                "test-release",
                datetime(2026, 7, 28, tzinfo=UTC),
                ["app.sqlite"],
            )
            manifest_path = destination.parent / "manifest.json"
            manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
            loaded = load_and_verify_manifest(manifest_path)
            self.assertEqual(loaded["releaseVersion"], "test-release")

    def test_manifest_verification_rejects_tampering(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            payload = root / "payload.txt"
            payload.write_text("expected", encoding="utf-8")
            manifest = build_manifest(
                root,
                "test-release",
                datetime(2026, 7, 28, tzinfo=UTC),
                [],
            )
            manifest_path = root / "manifest.json"
            manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
            payload.write_text("tampered", encoding="utf-8")

            with self.assertRaisesRegex(
                BackupError, "RESTORE_CHECKSUM_MISMATCH"
            ):
                load_and_verify_manifest(manifest_path)

    def test_restore_target_must_be_new_and_separate_from_live_data(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory).resolve()
            live = root / "live"
            live.mkdir()

            with self.assertRaisesRegex(
                BackupError, "RESTORE_TARGET_OVERLAPS_LIVE_PATH"
            ):
                validate_restore_target(live / "restore", [live])

            existing = root / "existing"
            existing.mkdir()

            with self.assertRaisesRegex(
                BackupError, "RESTORE_TARGET_MUST_NOT_EXIST"
            ):
                validate_restore_target(existing, [live])

            safe_target = root / "drills" / "restore-1"
            self.assertEqual(
                validate_restore_target(safe_target, [live]), safe_target
            )


if __name__ == "__main__":
    unittest.main()
