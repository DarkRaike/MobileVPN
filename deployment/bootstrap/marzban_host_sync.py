#!/usr/bin/env python3
"""Point the Marzban proxy host at the REALITY endpoint of this deployment.

Marzban creates one host row the first time it sees an inbound tag, with the
literal address `{SERVER_IP}`. That placeholder is resolved once per start by
asking a public IP echo service and falls back to `127.0.0.1` when the container
has no egress at that moment. The resolved value is copied verbatim into every
issued subscription, so one failed lookup hands out client configurations that
can never connect while the stack keeps reporting healthy.

The address is therefore reconciled to `vpn.<BASE_DOMAIN>`, the endpoint the
deployment documents and the operator points at the VPS with a DNS-only record.
Only the address, port and remark are owned here; SNI, security and fingerprint
stay inherited from the inbound so the host row cannot drift away from the
rendered Xray config.

A host list an operator has customised is left untouched: this script adopts
Marzban's own default row, updates the row it wrote before, or creates the first
one, and never deletes anything.

Exit codes:
  0  the host row now points at the deployment endpoint
  2  the environment or the Marzban schema is unusable
"""

from __future__ import annotations

import os
import re
import sqlite3
import sys

DATABASE_URL_PREFIX = "sqlite:///"
MARZBAN_DEFAULT_ADDRESS = "{SERVER_IP}"

# Marzban stores these SQLAlchemy enums by member name. `inbound_default` and
# `none` keep security, ALPN and fingerprint inherited from the inbound.
INHERIT_SECURITY = "inbound_default"
INHERIT_ALPN = "none"
INHERIT_FINGERPRINT = "none"

# A domain is the documented endpoint; a literal address is accepted so an
# operator whose `vpn` record is unusable can publish the VPS address directly.
HOST_ADDRESS_PATTERN = re.compile(
    r"^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$"
    r"|^(?:\d{1,3}\.){3}\d{1,3}$"
)

READY = 0
UNUSABLE = 2


class Unusable(RuntimeError):
    """Raised when the deployment cannot be reconciled safely."""


def database_path(database_url: str) -> str:
    if not database_url.startswith(DATABASE_URL_PREFIX):
        raise Unusable("SQLALCHEMY_DATABASE_URL must be a sqlite:/// URL")

    return database_url[len(DATABASE_URL_PREFIX) :]


def ensure_inbound(connection: sqlite3.Connection, inbound_tag: str) -> None:
    """Claim the inbound row so Marzban never adds its `{SERVER_IP}` default.

    `get_or_create_inbound` only seeds a default host when it creates the
    inbound itself, so an inbound that already exists keeps the host list this
    script owns.
    """
    connection.execute("insert or ignore into inbounds (tag) values (?)", (inbound_tag,))
    connection.commit()


def reconcile(
    connection: sqlite3.Connection,
    inbound_tag: str,
    address: str,
    port: int,
    remark: str,
) -> int:
    ensure_inbound(connection, inbound_tag)
    rows = connection.execute(
        "select id, remark, address, port from hosts where inbound_tag = ?"
        " order by id",
        (inbound_tag,),
    ).fetchall()
    adoptable = [
        row for row in rows if row[1] == remark or row[2] == MARZBAN_DEFAULT_ADDRESS
    ]

    if not rows:
        connection.execute(
            "insert into hosts"
            " (remark, address, port, security, alpn, fingerprint, inbound_tag)"
            " values (?, ?, ?, ?, ?, ?, ?)",
            (
                remark,
                address,
                port,
                INHERIT_SECURITY,
                INHERIT_ALPN,
                INHERIT_FINGERPRINT,
                inbound_tag,
            ),
        )
        connection.commit()
        print(f'marzban-init: published "{inbound_tag}" at {address}:{port}')
        return READY

    if not adoptable:
        print(
            f'marzban-init: "{inbound_tag}" has an operator owned host list;'
            f" leaving it unchanged"
        )
        return READY

    host_id, _, current_address, current_port = adoptable[0]

    if current_address == address and current_port == port:
        print(f'marzban-init: "{inbound_tag}" already points at {address}:{port}')
        return READY

    connection.execute(
        "update hosts set remark = ?, address = ?, port = ? where id = ?",
        (remark, address, port, host_id),
    )
    connection.commit()
    print(
        f'marzban-init: moved "{inbound_tag}" from {current_address}'
        f" to {address}:{port}"
    )
    return READY


def main() -> int:
    inbound_tag = os.environ.get("MARZBAN_VLESS_INBOUND_TAG", "").strip()
    address = os.environ.get("MARZBAN_HOST_ADDRESS", "").strip().lower()
    port = os.environ.get("MARZBAN_HOST_PORT", "").strip()
    remark = os.environ.get("MARZBAN_HOST_REMARK", "").strip()
    database_url = os.environ.get("SQLALCHEMY_DATABASE_URL", "").strip()

    try:
        if not inbound_tag or not remark:
            raise Unusable(
                "MARZBAN_VLESS_INBOUND_TAG and MARZBAN_HOST_REMARK are required"
            )

        if not HOST_ADDRESS_PATTERN.fullmatch(address):
            raise Unusable("MARZBAN_HOST_ADDRESS must be a domain name")

        if not port.isdigit() or not 0 < int(port) <= 65535:
            raise Unusable("MARZBAN_HOST_PORT must be a valid TCP port")

        path = database_path(database_url)
        connection = sqlite3.connect(path)

        try:
            connection.execute("pragma foreign_keys = on")
            return reconcile(connection, inbound_tag, address, int(port), remark)
        except sqlite3.Error as error:
            raise Unusable(f"Marzban database is unusable: {error}") from error
        finally:
            connection.close()
    except Unusable as error:
        print(f"marzban-init: {error}", file=sys.stderr)
        return UNUSABLE


if __name__ == "__main__":
    sys.exit(main())
