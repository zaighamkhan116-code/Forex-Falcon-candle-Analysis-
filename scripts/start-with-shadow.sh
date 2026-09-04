#!/usr/bin/env bash
set -euo pipefail

export SHADOW_MODEL_URL="${SHADOW_MODEL_URL:-http://127.0.0.1:8001}"
export SHADOW_MODEL_TIMEOUT_MS="${SHADOW_MODEL_TIMEOUT_MS:-5000}"

python -m uvicorn ml_shadow.app:app --host 127.0.0.1 --port 8001 &
SHADOW_PID=$!

QUOTEX_PID=""
if [[ "${QUOTEX_MOBILE_ENABLED:-false}" == "true" ]]; then
  node quotex_mobile/worker.js &
  QUOTEX_PID=$!
fi

cleanup() {
  kill "$SHADOW_PID" 2>/dev/null || true
  if [[ -n "$QUOTEX_PID" ]]; then kill "$QUOTEX_PID" 2>/dev/null || true; fi
}
trap cleanup EXIT INT TERM

# Warm the model in the background. Node starts immediately, so live Falcon never waits
# for the research-only model to download/train.
(
  for _ in $(seq 1 30); do
    python - <<'PY' && exit 0 || true
import json, urllib.request
try:
    with urllib.request.urlopen('http://127.0.0.1:8001/health', timeout=30) as r:
        x=json.load(r)
        if x.get('ok'):
            print('shadow-ready', x.get('modelVersion'))
            raise SystemExit(0)
except Exception as e:
    print('shadow-warmup', str(e))
raise SystemExit(1)
PY
    sleep 10
  done
  echo "shadow warmup did not reach READY" >&2
) &

exec node server.js
