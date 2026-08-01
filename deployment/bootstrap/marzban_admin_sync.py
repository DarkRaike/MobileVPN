#!/usr/bin/env python3
"""Make the Marzban sudo admin match the generated credentials.

`marzban-cli admin import-from-env` can only create an admin on Marzban
v0.8.4: its update branch fails Pydantic validation for `AdminPartialModify`.
Without a working update path a regenerated `MARZBAN_PASSWORD` leaves the
stack permanently unable to authenticate, because the application reads the
new password while Marzban keeps the old hash, and every provisioning attempt
ends in `MARZBAN_AUTH_FAILED`.

The hash is therefore reconciled directly, using the same bcrypt scheme
Marzban verifies with. A stored hash written by any other scheme is left
untouched and reported, because overwriting it would lock the operator out of
the dashboard.

Exit codes:
  0  the admin exists and its password now matches
  1  the admin does not exist and has to be created by the caller
  2  the environment or the stored hash is unusable
"""

from __future__ import annotations

import os
import sqlite3
import sys

DATABASE_URL_PREFIX = "sqlite:///"
BCRYPT_PREFIX = "$2"

ADMIN_READY = 0
ADMIN_MISSING = 1
UNUSABLE = 2


class Unusable(RuntimeError):
    """Raised when the deployment cannot be reconciled safely."""


class BcryptHasher:
    """Password hashing bound to the scheme Marzban verifies with."""

    def __init__(self) -> None:
        try:
            from passlib.context import CryptContext
        except ImportError as error:  # pragma: no cover - image provides it
            raise Unusable(
                "passlib is unavailable; run this inside the Marzban image"
            ) from error

        self._context = CryptContext(schemes=["bcrypt"], deprecated="auto")

    def matches(self, password: str, stored_hash: str) -> bool:
        try:
            return bool(self._context.verify(password, stored_hash))
        except ValueError:
            # A hash the context cannot parse is reported as a mismatch; the
            # caller refuses to overwrite anything that is not bcrypt anyway.
            return False

    def hash(self, password: str) -> str:
        return self._context.hash(password)


def database_path(database_url: str) -> str:
    if not database_url.startswith(DATABASE_URL_PREFIX):
        raise Unusable("SQLALCHEMY_DATABASE_URL must be a sqlite:/// URL")

    return database_url[len(DATABASE_URL_PREFIX) :]


def reconcile(connection: sqlite3.Connection, username: str, password: str, hasher) -> int:
    rows = connection.execute(
        "select hashed_password, is_sudo from admins where username = ? limit 1",
        (username,),
    ).fetchall()

    if not rows:
        return ADMIN_MISSING

    stored_hash = rows[0][0] or ""
    is_sudo = bool(rows[0][1])

    if not stored_hash.startswith(BCRYPT_PREFIX):
        raise Unusable(
            f'the stored password of "{username}" is not a bcrypt hash; '
            "reconcile it manually before starting the stack"
        )

    if hasher.matches(password, stored_hash) and is_sudo:
        print(f'marzban-init: sudo admin "{username}" already matches')
        return ADMIN_READY

    connection.execute(
        "update admins set hashed_password = ?, is_sudo = 1 where username = ?",
        (hasher.hash(password), username),
    )
    connection.commit()

    verification = connection.execute(
        "select hashed_password from admins where username = ? limit 1",
        (username,),
    ).fetchone()

    if not verification or not hasher.matches(password, verification[0]):
        raise Unusable(f'failed to reconcile the password of "{username}"')

    print(f'marzban-init: reconciled the sudo admin "{username}"')
    return ADMIN_READY


def main() -> int:
    username = os.environ.get("SUDO_USERNAME", "").strip()
    password = os.environ.get("SUDO_PASSWORD", "")
    database_url = os.environ.get("SQLALCHEMY_DATABASE_URL", "").strip()

    try:
        if not username or not password:
            raise Unusable("SUDO_USERNAME and SUDO_PASSWORD are required")

        path = database_path(database_url)

        if not os.path.exists(path):
            return ADMIN_MISSING

        connection = sqlite3.connect(path)

        try:
            return reconcile(connection, username, password, BcryptHasher())
        except sqlite3.Error as error:
            raise Unusable(f"Marzban database is unreadable: {error}") from error
        finally:
            connection.close()
    except Unusable as error:
        print(f"marzban-init: {error}", file=sys.stderr)
        return UNUSABLE


if __name__ == "__main__":
    sys.exit(main())
