from __future__ import annotations

import sqlite3
import sys
import tempfile
import unittest
from contextlib import closing
from pathlib import Path

sys.path.insert(
    0, str(Path(__file__).resolve().parents[2] / "deployment" / "bootstrap")
)

from marzban_admin_sync import (  # noqa: E402
    ADMIN_MISSING,
    ADMIN_READY,
    Unusable,
    database_path,
    reconcile,
)


class FakeHasher:
    """Deterministic stand-in for the bcrypt context Marzban verifies with."""

    def matches(self, password: str, stored_hash: str) -> bool:
        return stored_hash == self.hash(password)

    def hash(self, password: str) -> str:
        return f"$2b$fake${password}"


def create_admins_table(connection: sqlite3.Connection) -> None:
    connection.execute(
        "CREATE TABLE admins ("
        "id INTEGER PRIMARY KEY,"
        "username TEXT NOT NULL,"
        "hashed_password TEXT NOT NULL,"
        "is_sudo INTEGER NOT NULL DEFAULT 0"
        ")"
    )


class MarzbanAdminSyncTests(unittest.TestCase):
    def test_reports_a_missing_admin_so_the_caller_creates_it(self) -> None:
        with closing(sqlite3.connect(":memory:")) as connection:
            create_admins_table(connection)

            self.assertEqual(
                reconcile(connection, "astra_admin", "secret", FakeHasher()),
                ADMIN_MISSING,
            )

    def test_leaves_a_matching_admin_untouched(self) -> None:
        hasher = FakeHasher()

        with closing(sqlite3.connect(":memory:")) as connection:
            create_admins_table(connection)
            connection.execute(
                "INSERT INTO admins (username, hashed_password, is_sudo)"
                " VALUES (?, ?, 1)",
                ("astra_admin", hasher.hash("secret")),
            )

            self.assertEqual(
                reconcile(connection, "astra_admin", "secret", hasher),
                ADMIN_READY,
            )
            self.assertEqual(
                connection.execute(
                    "SELECT hashed_password FROM admins"
                ).fetchone()[0],
                hasher.hash("secret"),
            )

    def test_reconciles_a_regenerated_password(self) -> None:
        hasher = FakeHasher()

        with closing(sqlite3.connect(":memory:")) as connection:
            create_admins_table(connection)
            connection.execute(
                "INSERT INTO admins (username, hashed_password, is_sudo)"
                " VALUES (?, ?, 1)",
                ("astra_admin", hasher.hash("previous-password")),
            )

            self.assertEqual(
                reconcile(connection, "astra_admin", "rotated", hasher),
                ADMIN_READY,
            )

            stored_hash, is_sudo = connection.execute(
                "SELECT hashed_password, is_sudo FROM admins"
            ).fetchone()
            self.assertTrue(hasher.matches("rotated", stored_hash))
            self.assertEqual(is_sudo, 1)

    def test_restores_the_sudo_flag_of_a_matching_admin(self) -> None:
        hasher = FakeHasher()

        with closing(sqlite3.connect(":memory:")) as connection:
            create_admins_table(connection)
            connection.execute(
                "INSERT INTO admins (username, hashed_password, is_sudo)"
                " VALUES (?, ?, 0)",
                ("astra_admin", hasher.hash("secret")),
            )

            self.assertEqual(
                reconcile(connection, "astra_admin", "secret", hasher),
                ADMIN_READY,
            )
            self.assertEqual(
                connection.execute("SELECT is_sudo FROM admins").fetchone()[0], 1
            )

    def test_refuses_to_overwrite_a_foreign_hash_scheme(self) -> None:
        with closing(sqlite3.connect(":memory:")) as connection:
            create_admins_table(connection)
            connection.execute(
                "INSERT INTO admins (username, hashed_password, is_sudo)"
                " VALUES (?, ?, 1)",
                ("astra_admin", "argon2$something"),
            )

            with self.assertRaises(Unusable):
                reconcile(connection, "astra_admin", "secret", FakeHasher())

            self.assertEqual(
                connection.execute(
                    "SELECT hashed_password FROM admins"
                ).fetchone()[0],
                "argon2$something",
            )

    def test_rejects_a_non_sqlite_database_url(self) -> None:
        with self.assertRaises(Unusable):
            database_path("postgresql://marzban/db")

    def test_accepts_the_marzban_sqlite_url(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            path = Path(temporary_directory) / "db.sqlite3"

            self.assertEqual(
                database_path(f"sqlite:///{path}"),
                str(path),
            )


if __name__ == "__main__":
    unittest.main()
