from __future__ import annotations

import sys
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(
    0, str(Path(__file__).resolve().parents[2] / "deployment" / "bootstrap")
)

from bootstrap import (  # noqa: E402
    boolean_environment,
    positive_integer_environment,
    read_environment,
    require_environment,
)


class ReadEnvironmentTests(unittest.TestCase):
    """Compose passes an optional stack variable as an empty string.

    `deployment/compose.production.yaml` forwards optional values as
    `${NAME:-}`, so the variable is present and empty rather than unset. Reading
    it with a plain `os.environ.get(name, default)` never reaches the default
    and rejects a deployment that simply left the value out.
    """

    def test_falls_back_to_the_default_when_the_variable_is_absent(self) -> None:
        with mock.patch.dict("os.environ", {}, clear=True):
            self.assertEqual(read_environment("MISSING", "fallback"), "fallback")

    def test_falls_back_to_the_default_when_compose_passes_an_empty_value(
        self,
    ) -> None:
        with mock.patch.dict("os.environ", {"REALITY_ENDPOINT_HOST": ""}):
            self.assertEqual(
                read_environment("REALITY_ENDPOINT_HOST", "vpn.example.org"),
                "vpn.example.org",
            )

    def test_treats_a_whitespace_only_value_as_absent(self) -> None:
        with mock.patch.dict("os.environ", {"REALITY_SERVER_NAMES": "   "}):
            self.assertEqual(
                read_environment("REALITY_SERVER_NAMES", "www.example.org"),
                "www.example.org",
            )

    def test_keeps_a_supplied_value(self) -> None:
        with mock.patch.dict("os.environ", {"REALITY_ENDPOINT_HOST": " vpn.set.org "}):
            self.assertEqual(
                read_environment("REALITY_ENDPOINT_HOST", "vpn.example.org"),
                "vpn.set.org",
            )

    def test_an_empty_required_variable_is_still_an_error(self) -> None:
        with mock.patch.dict("os.environ", {"BASE_DOMAIN": ""}):
            with self.assertRaises(Exception):
                require_environment("BASE_DOMAIN")

    def test_typed_readers_use_their_defaults_for_an_empty_value(self) -> None:
        with mock.patch.dict(
            "os.environ", {"ENABLE_LIVE_OPERATIONS": "", "VLESS_PORT": ""}
        ):
            self.assertFalse(boolean_environment("ENABLE_LIVE_OPERATIONS"))
            self.assertEqual(positive_integer_environment("VLESS_PORT", 8443), 8443)


if __name__ == "__main__":
    unittest.main()
