#!/usr/bin/env bash
# create-self-signed-cert.sh
#
# Creates a self-signed HTTPS certificate (.pfx) for the dev server,
# src/serve.mjs, when you want the simulator and the sample agent on HTTPS.
#
# Requires: openssl
#
# Output: certs/lab-agent-sdk.pfx (alongside this script)

set -euo pipefail

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
OUT_DIR="${OUT_DIR:-$SCRIPT_DIR}"
PASSWORD="${PASSWORD:-changeit}"
DAYS="${DAYS:-365}"
SUBJECT="${SUBJECT:-/CN=lab-agent-sdk.localhost}"

mkdir -p "$OUT_DIR"

echo "Creating self-signed cert..."
openssl req -x509 -nodes -days "$DAYS" -newkey rsa:2048 \
  -keyout "$OUT_DIR/lab-agent-sdk.key" \
  -out    "$OUT_DIR/lab-agent-sdk.crt" \
  -subj   "$SUBJECT" \
  -addext "subjectAltName=DNS:localhost,DNS:lab-agent-sdk.localhost" \
  -addext "extendedKeyUsage=serverAuth"

echo "Exporting PFX..."
openssl pkcs12 -export \
  -out      "$OUT_DIR/lab-agent-sdk.pfx" \
  -inkey    "$OUT_DIR/lab-agent-sdk.key" \
  -in       "$OUT_DIR/lab-agent-sdk.crt" \
  -passout  "pass:$PASSWORD"

echo "Wrote $OUT_DIR/lab-agent-sdk.pfx"
echo "Password: $PASSWORD"
echo
echo "Next steps:"
echo "  node src/serve.mjs --pfx $OUT_DIR/lab-agent-sdk.pfx --passphrase $PASSWORD"
