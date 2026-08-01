#!/bin/sh
# Apply Marzban migrations and make sure the sudo admin matches the generated
# credentials. The sync script owns the update path, because
# `marzban-cli admin import-from-env` can only create an admin on v0.8.4.
set -eu

alembic upgrade head

python3 /run/astra/bootstrap/marzban_admin_sync.py && status=0 || status=$?

case "$status" in
0) ;;
1)
  echo "marzban-init: sudo admin is missing, importing it from the environment"
  marzban-cli admin import-from-env -y
  ;;
*)
  echo "marzban-init: refusing to start with an unusable admin state" >&2
  exit 1
  ;;
esac
