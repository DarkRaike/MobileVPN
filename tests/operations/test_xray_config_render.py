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
        "inbound_tag": "VLESS_TCP_REALITY_V1",
        "vless_port": 8443,
        "reality_dest": "www.swift.com:443",
        "reality_server_names": ["www.swift.com"],
        "private_key": "fixture-private-key",
        "public_key": "fixture-public-key",
        # Deliberately not a value any deployment uses: a real short ID is
        # handed to clients and does not belong in the repository.
        "short_id": "fdd0e6ec2a4b7c91",
    }
    arguments.update(overrides)

    return json.loads(render_xray_config(**arguments))


class XrayConfigRenderTests(unittest.TestCase):
    def setUp(self) -> None:
        self._template = bootstrap.TEMPLATE_FILE
        bootstrap.TEMPLATE_FILE = TEMPLATE

    def tearDown(self) -> None:
        bootstrap.TEMPLATE_FILE = self._template

    def test_substitutes_every_reality_placeholder(self) -> None:
        config = render()
        inbound = config["inbounds"][0]
        reality = inbound["streamSettings"]["realitySettings"]

        self.assertEqual(inbound["tag"], "VLESS_TCP_REALITY_V1")
        self.assertEqual(inbound["port"], 8443)
        self.assertEqual(inbound["protocol"], "vless")
        self.assertEqual(inbound["settings"]["decryption"], "none")
        self.assertEqual(inbound["streamSettings"]["security"], "reality")
        self.assertEqual(reality["dest"], "www.swift.com:443")
        self.assertEqual(reality["serverNames"], ["www.swift.com"])
        self.assertEqual(reality["privateKey"], "fixture-private-key")
        # Marzban builds client links from this value instead of re-deriving it
        # with `xray x25519 -i`, which rejects the inbound when it cannot parse.
        self.assertEqual(reality["publicKey"], "fixture-public-key")
        # The empty short ID is accepted on purpose: Marzban v0.8.4 builds the
        # first link after every start with an empty `sid`, and a client holding
        # it authenticates only if the inbound allows it.
        self.assertEqual(reality["shortIds"], ["", "fdd0e6ec2a4b7c91"])
        self.assertNotIn(
            "PLACEHOLDER", json.dumps(config), "a placeholder survived rendering"
        )

    def test_routing_rules_follow_the_inbound_tag(self) -> None:
        config = render(inbound_tag="VLESS_TCP_REALITY_V2")

        for rule in config["routing"]["rules"]:
            self.assertEqual(rule["inboundTag"], ["VLESS_TCP_REALITY_V2"])

    def test_reality_diagnostics_stay_off_unless_requested(self) -> None:
        reality = render()["inbounds"][0]["streamSettings"]["realitySettings"]
        self.assertFalse(reality["show"])

        loud = render(reality_show=True)["inbounds"][0]["streamSettings"]
        self.assertTrue(loud["realitySettings"]["show"])

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
