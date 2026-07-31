#!/usr/bin/env python3
"""Exit 0 when the configured Marzban sudo admin already exists.

Used to keep the stack restartable: `marzban-cli admin import-from-env` can only
create an admin on Marzban v0.8.4, because its sync branch fails Pydantic
validation for `AdminPartialModify`.
"""

import os
import sqlite3
import sys

DATABASE_URL_PREFIX = "sqlite:///"


def main() -> int:
    username = os.environ.get("SUDO_USERNAME", "").strip()
    database_url = os.environ.get("SQLALCHEMY_DATABASE_URL", "").strip()

    if not username or not database_url.startswith(DATABASE_URL_PREFIX):
        return 1

    database_path = database_url[len(DATABASE_URL_PREFIX) :]

    if not os.path.exists(database_path):
        return 1

    try:
        connection = sqlite3.connect(database_path)
    except sqlite3.Error:
        return 1

    try:
        found = connection.execute(
            "select 1 from admins where username = ? limit 1", (username,)
        ).fetchone()
    except sqlite3.Error:
        return 1
    finally:
        connection.close()

    return 0 if found else 1


if __name__ == "__main__":
    sys.exit(main())
