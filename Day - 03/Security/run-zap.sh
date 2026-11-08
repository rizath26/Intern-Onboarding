#!/usr/bin/env bash
# OWASP ZAP baseline scan against the BookSwap Prism mock.
# Start the mock first, e.g.:  prism mock openapi.yaml --port 4010 --host 0.0.0.0
# (--host 0.0.0.0 so the ZAP container can reach the mock.)
# (--add-host makes host.docker.internal work on Linux too, not just Docker Desktop.)
# Then run this script from the security/ folder. Output: zap-baseline-report.html
set -euo pipefail

docker run --rm -t \
  --add-host=host.docker.internal:host-gateway \
  -v "$PWD:/zap/wrk" \
  ghcr.io/zaproxy/zaproxy:stable \
  zap-baseline.py -t http://host.docker.internal:4010 \
                  -r zap-baseline-report.html || true
# zap-baseline.py exits non-zero when it finds warnings, which is expected,
# so "|| true" keeps the script from looking like it crashed.

echo "Report written to $PWD/zap-baseline-report.html"
