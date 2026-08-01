from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path

BOOTSTRAP_DIRECTORY = (
    Path(__file__).resolve().parents[2] / "deployment" / "bootstrap"
)
sys.path.insert(0, str(BOOTSTRAP_DIRECTORY))

import bootstrap  # noqa: E402
from bootstrap import ConfigurationError, render_xray_config  # noqa: E402

TEMPLATE = (
    Path(__file__).resolve().parents[2]
    / "deployment"
    / "xray"
    / "xray_config.template.json"
)


def render(**overrides) -> dict:
    arguments = {
        "inbound_tag": "VLESS WS",
        "websocket_port": 2096,
        "websocket_path": "/fixture-path",
    }
    arguments.update(overrides)

    return json.loads(render_xray_config(**arguments))


class XrayConfigRenderTests(unittest.TestCase):
    def setUp(self) -> None:
        self._template = bootstrap.TEMPLATE_FILE
        bootstrap.TEMPLATE_FILE = TEMPLATE

    def tearDown(self) -> None:
        bootstrap.TEMPLATE_FILE = self._template

    def test_renders_the_tunnel_inbound(self) -> None:
        config = render()
        inbound = config["inbounds"][0]

        self.assertEqual(inbound["tag"], "VLESS WS")
        self.assertEqual(inbound["port"], 2096)
        self.assertEqual(inbound["protocol"], "vless")
        self.assertEqual(inbound["settings"]["decryption"], "none")
        self.assertEqual(inbound["streamSettings"]["network"], "ws")
        # Caddy terminates TLS on the public 443; the inbound behind it is plain.
        self.assertEqual(inbound["streamSettings"]["security"], "none")
        self.assertEqual(
            inbound["streamSettings"]["wsSettings"]["path"], "/fixture-path"
        )
        self.assertNotIn(
            "PLACEHOLDER", json.dumps(config), "a placeholder survived rendering"
        )

    def test_defaults_to_the_quiet_log_level(self) -> None:
        config = render()

        self.assertEqual(config["log"]["loglevel"], "warning")

    def test_applies_the_requested_log_level(self) -> None:
        config = render(log_level="info")

        self.assertEqual(config["log"]["loglevel"], "info")

    def test_never_enables_access_logging(self) -> None:
        # Access logs are disabled by the data retention policy in tech.md.
        for level in ("debug", "info", "warning"):
            self.assertEqual(render(log_level=level)["log"]["access"], "none")

    def test_rejects_a_template_with_more_than_one_inbound(self) -> None:
        broken = TEMPLATE.parent / "broken.template.json"
        source = json.loads(TEMPLATE.read_text(encoding="utf-8"))
        source["inbounds"].append(dict(source["inbounds"][0]))
        broken.write_text(json.dumps(source), encoding="utf-8")
        bootstrap.TEMPLATE_FILE = broken

        try:
            with self.assertRaises(ConfigurationError):
                render()
        finally:
            broken.unlink()


if __name__ == "__main__":
    unittest.main()
