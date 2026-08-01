#!/bin/sh
# Apply Marzban migrations, make sure the sudo admin matches the generated
# credentials, and point the proxy host at the REALITY endpoint of this
# deployment. The sync scripts own the update paths, because
# `marzban-cli admin import-from-env` can only create an admin on v0.8.4 and
# the host address is otherwise guessed from an outbound IP lookup.
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

python3 /run/astra/bootstrap/marzban_host_sync.py
