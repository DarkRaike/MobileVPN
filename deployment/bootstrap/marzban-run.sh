#!/bin/sh
# Start Marzban on its Unix socket, clearing a socket left behind by an unclean
# shutdown so uvicorn can bind again.
set -eu

rm -f "${UVICORN_UDS:-/run/marzban/uvicorn.sock}"

exec python3 main.py
