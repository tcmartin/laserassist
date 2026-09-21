#!/bin/bash
# Compatibility entrypoint for the hosted Intelli package.
set -euo pipefail
cd "$(dirname "$0")"
if [[ ! -x node_modules/.bin/electron-builder ]]; then
    echo "Install the locked dependencies with npm ci before building." >&2
    exit 1
fi
exec node_modules/.bin/electron-builder --publish=never "$@"
