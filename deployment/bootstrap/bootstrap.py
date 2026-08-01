#!/usr/bin/env python3
"""Prepare deployment secrets, the Xray REALITY config and per-service env files.

The script runs as a one-shot Compose service before every other service starts.
Generated values are persisted in ``generated-secrets.json`` and are only created
when missing, so repeated runs keep credentials, REALITY keys and subscription
URLs stable. Rendered env files and the Xray config are rewritten on every run so
that changes in the stack env file propagate without manual edits.
"""

from __future__ import annotations

import json
import os
import re
import secrets
import shlex
import subprocess
import tempfile
import sys
from base64 import urlsafe_b64encode
from pathlib import Path

SECRETS_DIRECTORY = Path(os.environ.get("SECRETS_DIRECTORY", "/run/astra/secrets"))
TEMPLATE_FILE = Path(
    os.environ.get("XRAY_TEMPLATE_FILE", "/run/astra/templates/xray_config.template.json")
)
GENERATED_STORE_FILE = SECRETS_DIRECTORY / "generated-secrets.json"
XRAY_CONFIG_FILE = SECRETS_DIRECTORY / "xray_config.json"
RESTIC_PASSWORD_FILE = SECRETS_DIRECTORY / "restic_password"
REALITY_CLIENT_FILE = SECRETS_DIRECTORY / "reality-client.json"

# Runtime container paths, not host paths: services read the rendered files from
# the same read-only bind mount.
CONTAINER_SECRETS_DIRECTORY = "/run/astra/secrets"
MARZBAN_SOCKET_PATH = "/run/marzban/uvicorn.sock"

# Label of the Marzban proxy host this deployment owns. It is also how
# `marzban_host_sync.py` recognises its own row on the next start.
MARZBAN_HOST_REMARK = "Astra VPN"

DOMAIN_PATTERN = re.compile(
    r"^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$"
)
IPV4_PATTERN = re.compile(
    r"^(?:(?:25[0-5]|2[0-4]\d|1\d{2}|[1-9]?\d)\.){3}"
    r"(?:25[0-5]|2[0-4]\d|1\d{2}|[1-9]?\d)$"
)
MARZBAN_USERNAME_PATTERN = re.compile(r"^[a-z0-9_]{3,32}$")
XRAY_LOG_LEVELS = ("debug", "info", "warning", "error", "none")
TELEGRAM_BOT_TOKEN_PATTERN = re.compile(r"^\d+:[A-Za-z0-9_-]{20,}$")
TELEGRAM_USER_ID_PATTERN = re.compile(r"^\d{1,20}$")

DIRECTORY_MODE = 0o711
ROOT_FILE_MODE = 0o600
APPLICATION_FILE_MODE = 0o400


class ConfigurationError(RuntimeError):
    """Raised when the operator supplied stack configuration is unusable."""


def random_secret(byte_length: int) -> str:
    """Return an unpadded base64url secret accepted by the application schema."""
    return urlsafe_b64encode(secrets.token_bytes(byte_length)).decode("ascii").rstrip("=")


def read_environment(name: str, default: str = "") -> str:
    """Read a stack variable, treating an empty value as absent.

    Compose passes an optional variable as an empty string rather than leaving
    it unset, so `os.environ.get(name, default)` never reaches its default and
    every documented fallback here would be unreachable.
    """
    return os.environ.get(name, "").strip() or default


def require_environment(name: str) -> str:
    value = read_environment(name)

    if not value:
        raise ConfigurationError(f"{name} is required in the stack env file")

    return value


def boolean_environment(name: str, default: bool = False) -> bool:
    value = read_environment(name).lower()

    if not value:
        return default

    if value in {"true", "false"}:
        return value == "true"

    raise ConfigurationError(f"{name} must be true or false")


def positive_integer_environment(name: str, default: int) -> int:
    value = read_environment(name)

    if not value:
        return default

    if not value.isdigit() or int(value) <= 0:
        raise ConfigurationError(f"{name} must be a positive integer")

    return int(value)


def load_generated_secrets() -> dict[str, str]:
    if not GENERATED_STORE_FILE.exists():
        return {}

    try:
        stored = json.loads(GENERATED_STORE_FILE.read_text(encoding="utf-8"))
    except json.JSONDecodeError as error:
        raise ConfigurationError(
            f"{GENERATED_STORE_FILE} is not valid JSON; restore it from backup"
        ) from error

    if not isinstance(stored, dict):
        raise ConfigurationError(f"{GENERATED_STORE_FILE} must contain a JSON object")

    return {str(key): str(value) for key, value in stored.items()}


def generate_reality_key_pair() -> tuple[str, str]:
    """Generate an X25519 key pair with the Xray binary bundled in the image."""
    executable = os.environ.get("XRAY_EXECUTABLE_PATH", "/usr/local/bin/xray")

    try:
        completed = subprocess.run(
            [executable, "x25519"],
            capture_output=True,
            check=True,
            text=True,
            timeout=30,
        )
    except (OSError, subprocess.SubprocessError) as error:
        raise ConfigurationError(
            f"Unable to generate REALITY keys with {executable}"
        ) from error

    values = [
        line.split(":", 1)[1].strip()
        for line in completed.stdout.splitlines()
        if ":" in line
    ]

    if len(values) < 2 or not values[0] or not values[1]:
        raise ConfigurationError("Unexpected `xray x25519` output format")

    return values[0], values[1]


def ensure_generated_secrets(marzban_username: str) -> dict[str, str]:
    generated = load_generated_secrets()

    def ensure(key: str, factory) -> None:
        if not generated.get(key):
            generated[key] = factory()

    ensure("SESSION_SECRET", lambda: random_secret(48))
    ensure("SUBSCRIPTION_URL_ENCRYPTION_KEY", lambda: random_secret(32))
    ensure("INTERNAL_JOB_SECRET", lambda: random_secret(32))
    ensure("MONITORING_SECRET", lambda: random_secret(32))
    ensure("TELEGRAM_WEBHOOK_SECRET", lambda: random_secret(32))
    ensure("MARZBAN_PASSWORD", lambda: random_secret(32))
    ensure("REALITY_SHORT_ID", lambda: secrets.token_hex(8))

    if not generated.get("REALITY_PRIVATE_KEY") or not generated.get(
        "REALITY_PUBLIC_KEY"
    ):
        private_key, public_key = generate_reality_key_pair()
        generated["REALITY_PRIVATE_KEY"] = private_key
        generated["REALITY_PUBLIC_KEY"] = public_key

    # The admin username is operator owned; rotating it in the stack env file has
    # to reach Marzban through `admin import-from-env` on the next start.
    generated["MARZBAN_USERNAME"] = marzban_username

    write_private_file(
        GENERATED_STORE_FILE, json.dumps(generated, indent=2, sort_keys=True) + "\n"
    )

    return generated


def write_file(
    path: Path, content: str, mode: int, owner: tuple[int, int] | None = None
) -> None:
    """Replace a generated file atomically.

    The container keeps only CAP_CHOWN, so the mode has to be applied while the
    temporary file still belongs to root, and ownership is handed over last.
    Renaming over the target also avoids rewriting the read-only files that an
    earlier run created; a unique temporary name keeps a failed run from
    blocking the next one.
    """
    descriptor, temporary_name = tempfile.mkstemp(
        dir=path.parent, prefix=f"{path.name}.", suffix=".tmp"
    )
    temporary_path = Path(temporary_name)

    try:
        with os.fdopen(descriptor, "w", encoding="utf-8", newline="\n") as handle:
            handle.write(content)

        os.chmod(temporary_path, mode)

        if owner is not None:
            os.chown(temporary_path, owner[0], owner[1])

        os.replace(temporary_path, path)
    except BaseException:
        temporary_path.unlink(missing_ok=True)
        raise


def write_private_file(path: Path, content: str) -> None:
    write_file(path, content, ROOT_FILE_MODE)


def write_application_file(path: Path, content: str, uid: int, gid: int) -> None:
    write_file(path, content, APPLICATION_FILE_MODE, (uid, gid))


def render_env_file(values: dict[str, str]) -> str:
    lines = [
        "# Generated by deployment/bootstrap/bootstrap.py. Do not edit by hand.",
    ]
    lines.extend(f"{key}={shlex.quote(value)}" for key, value in sorted(values.items()))

    return "\n".join(lines) + "\n"


def render_xray_config(
    inbound_tag: str,
    vless_port: int,
    reality_dest: str,
    reality_server_names: list[str],
    private_key: str,
    public_key: str,
    short_id: str,
    log_level: str = "warning",
    reality_show: bool = False,
) -> str:
    try:
        config = json.loads(TEMPLATE_FILE.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise ConfigurationError(f"Unable to read {TEMPLATE_FILE}") from error

    inbounds = config.get("inbounds")

    if not isinstance(inbounds, list) or len(inbounds) != 1:
        raise ConfigurationError("The Xray template must declare exactly one inbound")

    # A rejected REALITY handshake is only reported below `warning`, so a client
    # that cannot connect leaves no trace at the default level. Access logging
    # stays off: the retention policy forbids it.
    config.setdefault("log", {})["loglevel"] = log_level
    config["log"]["access"] = "none"

    inbound = inbounds[0]
    inbound["tag"] = inbound_tag
    inbound["port"] = vless_port
    reality = inbound["streamSettings"]["realitySettings"]
    # `show` makes REALITY print why it refused a handshake, which is the only
    # way to tell a client that presented the wrong short ID from one whose
    # ClientHello the build cannot parse at all. Both are logged identically as
    # `processed invalid connection`. It prints one block per connection, so it
    # stays off outside a diagnosis.
    reality["show"] = reality_show
    reality["dest"] = reality_dest
    reality["serverNames"] = reality_server_names
    reality["privateKey"] = private_key
    # Xray ignores `publicKey` on an inbound that declares `dest`, but Marzban
    # reads it to build client links and otherwise re-derives it by running
    # `xray x25519 -i`; a parse failure there rejects the whole inbound.
    reality["publicKey"] = public_key
    # The empty short ID has to be accepted alongside the generated one because
    # Marzban v0.8.4 copies the inbound before it assigns `sid`
    # (`app/subscription/share.py`, `host_inbound = inbound.copy()` precedes
    # `inbound["sid"] = random.choice(sids)`). The dict it mutates is shared, so
    # the first link built after every Marzban start carries an empty short ID
    # and every later one carries the real value. Accepting both keeps a
    # subscription fetched in that window connectable instead of silently
    # unauthenticated. Short IDs distinguish client groups; REALITY's security
    # rests on the X25519 key, which this does not weaken.
    reality["shortIds"] = ["", short_id]

    for rule in config.get("routing", {}).get("rules", []):
        if isinstance(rule.get("inboundTag"), list):
            rule["inboundTag"] = [inbound_tag]

    return json.dumps(config, indent=2) + "\n"


def parse_reality_destination(value: str) -> tuple[str, str]:
    host, separator, port = value.rpartition(":")

    if not separator or not host or not port.isdigit():
        raise ConfigurationError("REALITY_DEST must use the host:port format")

    return host, port


def main() -> int:
    SECRETS_DIRECTORY.mkdir(parents=True, exist_ok=True)
    os.chmod(SECRETS_DIRECTORY, DIRECTORY_MODE)

    base_domain = require_environment("BASE_DOMAIN").lower()

    if not DOMAIN_PATTERN.fullmatch(base_domain) or base_domain.endswith(
        (".example", ".test")
    ):
        raise ConfigurationError(
            "BASE_DOMAIN must be a concrete domain, for example vpn-service.com"
        )

    telegram_bot_token = require_environment("TELEGRAM_BOT_TOKEN")

    if not TELEGRAM_BOT_TOKEN_PATTERN.fullmatch(telegram_bot_token):
        raise ConfigurationError("TELEGRAM_BOT_TOKEN has an unexpected format")

    telegram_admin_user_id = require_environment("TELEGRAM_ADMIN_USER_ID")

    if not TELEGRAM_USER_ID_PATTERN.fullmatch(telegram_admin_user_id):
        raise ConfigurationError("TELEGRAM_ADMIN_USER_ID must be a Telegram user ID")

    marzban_username = read_environment("MARZBAN_USERNAME", "astra_admin").lower()

    if not MARZBAN_USERNAME_PATTERN.fullmatch(marzban_username):
        raise ConfigurationError(
            "MARZBAN_USERNAME must match [a-z0-9_] and be 3-32 characters long"
        )

    inbound_tag = read_environment("MARZBAN_VLESS_INBOUND_TAG", "VLESS_TCP_REALITY_V1")
    vless_port = positive_integer_environment("VLESS_PORT", 8443)

    if vless_port > 65535:
        raise ConfigurationError("VLESS_PORT must be a valid TCP port")

    # Clients connect to the documented DNS-only record rather than to the
    # public IP Marzban would otherwise detect once per start. The override
    # exists for an operator whose `vpn` record cannot be used yet: without it
    # a missing record can only be fixed by editing the deployment.
    vpn_host = read_environment("REALITY_ENDPOINT_HOST", f"vpn.{base_domain}").lower()

    if not DOMAIN_PATTERN.fullmatch(vpn_host) and not IPV4_PATTERN.fullmatch(
        vpn_host
    ):
        raise ConfigurationError(
            "REALITY_ENDPOINT_HOST must be a domain or an IPv4 address"
        )

    reality_dest = read_environment("REALITY_DEST", "www.nvidia.com:443")
    reality_host, _ = parse_reality_destination(reality_dest)
    reality_server_names = [
        name.strip()
        for name in read_environment("REALITY_SERVER_NAMES", reality_host).split(",")
        if name.strip()
    ]

    if not reality_server_names:
        raise ConfigurationError("REALITY_SERVER_NAMES must list at least one SNI")

    application_uid = positive_integer_environment("APP_UID", 1000)
    application_gid = positive_integer_environment("APP_GID", 1000)
    xray_log_level = read_environment("XRAY_LOG_LEVEL", "warning").lower()

    if xray_log_level not in XRAY_LOG_LEVELS:
        raise ConfigurationError(
            f"XRAY_LOG_LEVEL must be one of {', '.join(XRAY_LOG_LEVELS)}"
        )

    generated = ensure_generated_secrets(marzban_username)

    write_private_file(
        XRAY_CONFIG_FILE,
        render_xray_config(
            inbound_tag,
            vless_port,
            reality_dest,
            reality_server_names,
            generated["REALITY_PRIVATE_KEY"],
            generated["REALITY_PUBLIC_KEY"],
            generated["REALITY_SHORT_ID"],
            xray_log_level,
            boolean_environment("REALITY_SHOW"),
        ),
    )

    if not RESTIC_PASSWORD_FILE.exists():
        write_private_file(RESTIC_PASSWORD_FILE, random_secret(32) + "\n")

    write_private_file(
        REALITY_CLIENT_FILE,
        json.dumps(
            {
                "flow": "xtls-rprx-vision",
                "inboundTag": inbound_tag,
                "port": vless_port,
                "publicKey": generated["REALITY_PUBLIC_KEY"],
                "serverNames": reality_server_names,
                "shortId": generated["REALITY_SHORT_ID"],
                "vpnHost": vpn_host,
            },
            indent=2,
            sort_keys=True,
        )
        + "\n",
    )

    live_operations = "true" if boolean_environment("ENABLE_LIVE_OPERATIONS") else "false"

    write_application_file(
        SECRETS_DIRECTORY / "app.env",
        render_env_file(
            {
                "BASE_DOMAIN": base_domain,
                "ENABLE_LIVE_OPERATIONS": live_operations,
                "INTERNAL_JOB_SECRET": generated["INTERNAL_JOB_SECRET"],
                "MARZBAN_PASSWORD": generated["MARZBAN_PASSWORD"],
                "MARZBAN_USERNAME": marzban_username,
                "MARZBAN_VLESS_INBOUND_TAG": inbound_tag,
                "MONITORING_SECRET": generated["MONITORING_SECRET"],
                "SESSION_SECRET": generated["SESSION_SECRET"],
                "SUBSCRIPTION_URL_ENCRYPTION_KEY": generated[
                    "SUBSCRIPTION_URL_ENCRYPTION_KEY"
                ],
                "TELEGRAM_ADMIN_USER_ID": telegram_admin_user_id,
                "TELEGRAM_BOT_TOKEN": telegram_bot_token,
                "TELEGRAM_INIT_DATA_MAX_AGE_SECONDS": str(
                    positive_integer_environment("TELEGRAM_INIT_DATA_MAX_AGE_SECONDS", 300)
                ),
                "TELEGRAM_WEBHOOK_SECRET": generated["TELEGRAM_WEBHOOK_SECRET"],
            }
        ),
        application_uid,
        application_gid,
    )
    write_application_file(
        SECRETS_DIRECTORY / "worker.env",
        render_env_file(
            {
                "ENABLE_LIVE_OPERATIONS": live_operations,
                "INTERNAL_JOB_SECRET": generated["INTERNAL_JOB_SECRET"],
                "RECONCILIATION_INTERVAL_MILLISECONDS": str(
                    positive_integer_environment(
                        "RECONCILIATION_INTERVAL_MILLISECONDS", 30000
                    )
                ),
            }
        ),
        application_uid,
        application_gid,
    )
    alert_chat_id = read_environment("ALERT_TELEGRAM_CHAT_ID")
    monitoring_environment = {
        "ALERT_REPEAT_MILLISECONDS": str(
            positive_integer_environment("ALERT_REPEAT_MILLISECONDS", 1800000)
        ),
        "MONITORING_INTERVAL_MILLISECONDS": str(
            positive_integer_environment("MONITORING_INTERVAL_MILLISECONDS", 60000)
        ),
        "MONITORING_SECRET": generated["MONITORING_SECRET"],
    }

    # The worker refuses a half configured alert channel, so the Telegram pair is
    # written only once the operator has chosen an alert chat.
    if alert_chat_id:
        monitoring_environment["ALERT_TELEGRAM_CHAT_ID"] = alert_chat_id
        monitoring_environment["TELEGRAM_BOT_TOKEN"] = telegram_bot_token

    write_application_file(
        SECRETS_DIRECTORY / "monitoring.env",
        render_env_file(monitoring_environment),
        application_uid,
        application_gid,
    )
    # Without SSL files Marzban deliberately binds to loopback, so it listens on
    # a Unix socket and Caddy publishes it on the private Docker network.
    marzban_environment = {
        "DEBUG": "False",
        "DOCS": "False",
        "SQLALCHEMY_DATABASE_URL": "sqlite:////var/lib/marzban/db.sqlite3",
        "UVICORN_UDS": MARZBAN_SOCKET_PATH,
        "XRAY_JSON": f"{CONTAINER_SECRETS_DIRECTORY}/xray_config.json",
        "XRAY_SUBSCRIPTION_PATH": "sub",
        "XRAY_SUBSCRIPTION_URL_PREFIX": f"https://sub.{base_domain}",
    }

    write_private_file(
        SECRETS_DIRECTORY / "marzban.env", render_env_file(marzban_environment)
    )
    # Marzban authenticates admins against its own database and asks for the
    # sudo credentials to be removed once imported, so only the one-shot init
    # service receives them.
    write_private_file(
        SECRETS_DIRECTORY / "marzban-init.env",
        render_env_file(
            {
                **marzban_environment,
                "MARZBAN_HOST_ADDRESS": vpn_host,
                "MARZBAN_HOST_PORT": str(vless_port),
                "MARZBAN_HOST_REMARK": MARZBAN_HOST_REMARK,
                "MARZBAN_VLESS_INBOUND_TAG": inbound_tag,
                "SUDO_PASSWORD": generated["MARZBAN_PASSWORD"],
                "SUDO_USERNAME": marzban_username,
            }
        ),
    )

    print(
        json.dumps(
            {
                "level": "info",
                "message": "Deployment secrets are ready",
                "realityInboundTag": inbound_tag,
                "realityServerNames": reality_server_names,
                "secretsDirectory": str(SECRETS_DIRECTORY),
                "subscriptionHost": f"sub.{base_domain}",
                "vlessPort": vless_port,
                "vpnHost": vpn_host,
            }
        )
    )

    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except ConfigurationError as error:
        print(f"bootstrap: {error}", file=sys.stderr)
        sys.exit(1)
