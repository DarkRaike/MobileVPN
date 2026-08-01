from __future__ import annotations

import sqlite3
import sys
import unittest
from contextlib import closing
from pathlib import Path

sys.path.insert(
    0, str(Path(__file__).resolve().parents[2] / "deployment" / "bootstrap")
)

from marzban_host_sync import READY, reconcile  # noqa: E402

INBOUND_TAG = "VLESS WS"
REMARK = "Astra VPN"


def create_schema(connection: sqlite3.Connection) -> None:
    """Mirror the Marzban v0.8.4 columns this script writes."""
    connection.execute(
        "CREATE TABLE inbounds (id INTEGER PRIMARY KEY, tag TEXT NOT NULL UNIQUE)"
    )
    connection.execute(
        "CREATE TABLE hosts ("
        "id INTEGER PRIMARY KEY,"
        "remark TEXT NOT NULL,"
        "address TEXT NOT NULL,"
        "port INTEGER,"
        "sni TEXT,"
        "host TEXT,"
        "security TEXT NOT NULL,"
        "alpn TEXT NOT NULL DEFAULT 'none',"
        "fingerprint TEXT NOT NULL DEFAULT 'none',"
        "inbound_tag TEXT NOT NULL REFERENCES inbounds (tag)"
        ")"
    )


def hosts(connection: sqlite3.Connection) -> list[tuple]:
    return connection.execute(
        "SELECT remark, address, port, security, host FROM hosts ORDER BY id"
    ).fetchall()


class MarzbanHostSyncTests(unittest.TestCase):
    def test_publishes_the_endpoint_before_marzban_sees_the_inbound(self) -> None:
        with closing(sqlite3.connect(":memory:")) as connection:
            create_schema(connection)

            self.assertEqual(
                reconcile(connection, INBOUND_TAG, "vpn.example.org", 8443, REMARK),
                READY,
            )
            # Claiming the inbound row is what stops Marzban from seeding its
            # own `{SERVER_IP}` host when it starts.
            self.assertEqual(
                connection.execute("SELECT tag FROM inbounds").fetchall(),
                [(INBOUND_TAG,)],
            )
            self.assertEqual(
                hosts(connection),
                [(REMARK, "vpn.example.org", 8443, "tls", None)],
            )

    def test_moves_an_existing_deployment_off_the_detected_ip(self) -> None:
        with closing(sqlite3.connect(":memory:")) as connection:
            create_schema(connection)
            connection.execute("INSERT INTO inbounds (tag) VALUES (?)", (INBOUND_TAG,))
            connection.execute(
                "INSERT INTO hosts (remark, address, security, inbound_tag)"
                " VALUES (?, ?, ?, ?)",
                ("🚀 Marz", "{SERVER_IP}", "tls", INBOUND_TAG),
            )

            self.assertEqual(
                reconcile(connection, INBOUND_TAG, "vpn.example.org", 8443, REMARK),
                READY,
            )
            self.assertEqual(
                hosts(connection),
                [(REMARK, "vpn.example.org", 8443, "tls", None)],
            )

    def test_follows_a_changed_domain_and_port(self) -> None:
        with closing(sqlite3.connect(":memory:")) as connection:
            create_schema(connection)
            reconcile(connection, INBOUND_TAG, "vpn.old.org", 8443, REMARK)

            self.assertEqual(
                reconcile(connection, INBOUND_TAG, "vpn.new.org", 9443, REMARK),
                READY,
            )
            self.assertEqual(
                hosts(connection),
                [(REMARK, "vpn.new.org", 9443, "tls", None)],
            )

    def test_repeated_runs_change_nothing(self) -> None:
        with closing(sqlite3.connect(":memory:")) as connection:
            create_schema(connection)
            reconcile(connection, INBOUND_TAG, "vpn.example.org", 8443, REMARK)
            before = hosts(connection)

            reconcile(connection, INBOUND_TAG, "vpn.example.org", 8443, REMARK)

            self.assertEqual(hosts(connection), before)

    def test_leaves_an_operator_owned_host_list_alone(self) -> None:
        with closing(sqlite3.connect(":memory:")) as connection:
            create_schema(connection)
            connection.execute("INSERT INTO inbounds (tag) VALUES (?)", (INBOUND_TAG,))
            connection.execute(
                "INSERT INTO hosts (remark, address, port, security, inbound_tag)"
                " VALUES (?, ?, ?, ?, ?)",
                ("Backup entry", "vpn2.example.org", 2053, "tls", INBOUND_TAG),
            )
            before = hosts(connection)

            self.assertEqual(
                reconcile(connection, INBOUND_TAG, "vpn.example.org", 8443, REMARK),
                READY,
            )
            self.assertEqual(hosts(connection), before)


if __name__ == "__main__":
    unittest.main()
