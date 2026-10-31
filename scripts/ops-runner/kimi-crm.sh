#!/bin/sh
# Installed at /usr/local/bin/kimi; vendor upgrades keep /root/.local/bin/kimi.
# CRM sets this marker in executeKimiCli. Preserve unrelated Node options.
if [ "${KIMI_CRM_MANAGED:-}" = "1" ]; then
    export NODE_OPTIONS="${NODE_OPTIONS:+$NODE_OPTIONS }--network-family-autoselection-attempt-timeout=2000"
fi
exec /root/.local/bin/kimi "$@"
