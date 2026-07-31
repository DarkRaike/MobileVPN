#!/bin/sh
# Apply Marzban migrations and make sure the sudo admin exists.
set -eu

alembic upgrade head

if python3 /run/astra/bootstrap/marzban_admin_present.py; then
  echo "marzban-init: sudo admin already present, skipping import"
else
  marzban-cli admin import-from-env -y
fi
