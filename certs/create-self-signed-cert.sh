#!/usr/bin/env bash
# create-self-signed-cert.sh
#
# Creates a self-signed HTTPS certificate (.pfx) for the sample app.
# Use this when the ASP.NET Core dev cert is not an option -- for example
# on a Linux CI agent or when publishing to a non-developer machine.
#
# Requires: openssl
#
# Output: certs/ai-mentor-integration-sandbox.pfx (alongside this script)

set -euo pipefail

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
OUT_DIR="${OUT_DIR:-$SCRIPT_DIR}"
PASSWORD="${PASSWORD:-changeit}"
DAYS="${DAYS:-365}"
SUBJECT="${SUBJECT:-/CN=ai-mentor-integration-sandbox.localhost}"

mkdir -p "$OUT_DIR"

echo "Creating self-signed cert..."
openssl req -x509 -nodes -days "$DAYS" -newkey rsa:2048 \
  -keyout "$OUT_DIR/ai-mentor-integration-sandbox.key" \
  -out    "$OUT_DIR/ai-mentor-integration-sandbox.crt" \
  -subj   "$SUBJECT" \
  -addext "subjectAltName=DNS:localhost,DNS:ai-mentor-integration-sandbox.localhost" \
  -addext "extendedKeyUsage=serverAuth"

echo "Exporting PFX..."
openssl pkcs12 -export \
  -out      "$OUT_DIR/ai-mentor-integration-sandbox.pfx" \
  -inkey    "$OUT_DIR/ai-mentor-integration-sandbox.key" \
  -in       "$OUT_DIR/ai-mentor-integration-sandbox.crt" \
  -passout  "pass:$PASSWORD"

echo "Wrote $OUT_DIR/ai-mentor-integration-sandbox.pfx"
echo "Password: $PASSWORD"
echo
echo "Next steps:"
echo "  1. Uncomment the Kestrel block in src/appsettings.json"
echo "  2. Verify Certificate.Path and Certificate.Password match this output"
