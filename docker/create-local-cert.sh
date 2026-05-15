#!/usr/bin/env bash
set -euo pipefail

CERT_DIR="${1:-certs}"
COMMON_NAME="${2:-localhost}"

mkdir -p "$CERT_DIR"

openssl req -x509 -newkey rsa:4096 -sha256 -days 825 -nodes \
  -keyout "$CERT_DIR/sman-local.key" \
  -out "$CERT_DIR/sman-local.crt" \
  -subj "/CN=$COMMON_NAME" \
  -addext "subjectAltName=DNS:$COMMON_NAME,DNS:localhost,IP:127.0.0.1"

chmod 600 "$CERT_DIR/sman-local.key"
chmod 644 "$CERT_DIR/sman-local.crt"

printf 'Created %s/sman-local.crt and %s/sman-local.key\n' "$CERT_DIR" "$CERT_DIR"
