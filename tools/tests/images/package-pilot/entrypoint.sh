#!/bin/sh
set -eu
if [ -n "${PILOT_CA_FILE:-}" ]; then
    trust=$(mktemp -d)
    cat /etc/ssl/certs/ca-certificates.crt "$PILOT_CA_FILE" > "$trust/ca.pem"
    printf 'openssl.cafile=%s\ncurl.cainfo=%s\n' "$trust/ca.pem" "$trust/ca.pem" > "$trust/pilot-ca.ini"
    export PHP_INI_SCAN_DIR="${PHP_INI_SCAN_DIR:-/usr/local/etc/php/conf.d}:$trust"
    export COMPOSER_CAFILE="$trust/ca.pem" CURL_CA_BUNDLE="$trust/ca.pem" SSL_CERT_FILE="$trust/ca.pem"
    export NODE_EXTRA_CA_CERTS="$PILOT_CA_FILE"
fi
exec "$@"
