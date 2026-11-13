#!/usr/bin/env bash
# Production deploy. Needs CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID in env and
# secrets already set with `wrangler secret put` (SESSION_SECRET, VAPID_*).
set -euo pipefail
cd "$(dirname "$0")/.."
# Wrangler rebuilds assets immediately before upload, stamping the current HEAD.
WRANGLER_SEND_METRICS=false npx wrangler deploy --var APP_ORIGIN:https://incord.jesklabs.com "$@"
