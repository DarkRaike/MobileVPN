from __future__ import annotations

import re
import unittest
from pathlib import Path

CADDYFILE = (
    Path(__file__).resolve().parents[2] / "deployment" / "Caddyfile"
)
MARZBAN_SOCKET = "unix//run/marzban/uvicorn.sock"


def strip_comments(text: str) -> str:
    return "\n".join(
        line for line in text.splitlines() if not line.strip().startswith("#")
    )


def site_body(text: str, address: str) -> str:
    """Return the body of the site block introduced by `address`."""
    match = re.search(
        rf"^{re.escape(address)}[^\n{{]*{{", text, flags=re.MULTILINE
    )

    if not match:
        raise AssertionError(f"no site block for {address}")

    depth = 1
    start = match.end()

    for index in range(start, len(text)):
        if text[index] == "{":
            depth += 1
        elif text[index] == "}":
            depth -= 1

            if depth == 0:
                return text[start:index]

    raise AssertionError(f"unterminated site block for {address}")


def top_level_directives(body: str) -> list[str]:
    """Directive names written directly in a block, ignoring nested blocks."""
    directives: list[str] = []
    depth = 0

    for line in body.splitlines():
        stripped = line.strip()

        if not stripped:
            continue

        if depth == 0 and not stripped.startswith("}"):
            directives.append(stripped.split()[0])

        depth += stripped.count("{") - stripped.count("}")

    return directives


class CaddyfileRouteTests(unittest.TestCase):
    """Guard the routing semantics Caddy's directive order can silently break.

    Caddy sorts bare directives by its own order, in which `respond` runs
    before `reverse_proxy`. A catch-all `respond 404` written after a proxy
    therefore answers every request and makes the proxy unreachable, which is
    how every subscription URL came to return an empty 404.
    """

    def setUp(self) -> None:
        self.text = strip_comments(CADDYFILE.read_text(encoding="utf-8"))

    def test_subscription_host_proxies_the_subscription_path(self) -> None:
        body = site_body(self.text, "sub.{$BASE_DOMAIN}")

        self.assertRegex(body, r"handle\s+/sub/\*\s*\{")
        self.assertIn(MARZBAN_SOCKET, body)

    def test_subscription_host_has_no_bare_response_directive(self) -> None:
        body = site_body(self.text, "sub.{$BASE_DOMAIN}")

        # A `respond` outside a `handle` block outranks the proxy and answers
        # the subscription requests instead of Marzban.
        self.assertNotIn("respond", top_level_directives(body))

    def test_subscription_host_denies_everything_else(self) -> None:
        body = site_body(self.text, "sub.{$BASE_DOMAIN}")

        self.assertRegex(body, r"handle\s*\{\s*respond\s+404")

    def test_application_host_proxies_the_application(self) -> None:
        body = site_body(self.text, "app.{$BASE_DOMAIN}")

        self.assertIn("reverse_proxy app:3000", body)
        self.assertNotIn("respond", top_level_directives(body))

    def test_private_api_listener_reaches_marzban(self) -> None:
        body = site_body(self.text, ":8000")

        self.assertIn(MARZBAN_SOCKET, body)


if __name__ == "__main__":
    unittest.main()
