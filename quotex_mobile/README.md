# Quotex Mobile / Railway Executor

This directory contains the server-side Quotex worker so Falcon can keep running when the MacBook is off and the iPhone is locked.

## Architecture

1. iPhone/PWA controls Falcon.
2. Railway hosts the Falcon server and the optional Quotex browser worker.
3. The worker maintains an authenticated Quotex browser session using Railway secrets.
4. It reads qualified signals from `/api/execution/signals`.
5. Every execution is tied to the Falcon signal ID and the newly observed Quotex trade ID.
6. Settlement checks the closed trade plus the pre/post account balance so WIN/LOSS and realized P/L are not guessed from configured payout.
7. The existing Chrome extension remains a backup executor.

## Railway variables

Add these in Railway -> service -> Variables. Never commit their values to GitHub.

```text
QUOTEX_MOBILE_ENABLED=true
QUOTEX_LIVE_EXECUTION=false
QUOTEX_EMAIL=your Quotex email
QUOTEX_PASSWORD=your Quotex password
QUOTEX_STAKE=1
QUOTEX_MIN_PAYOUT=80
QUOTEX_ALLOW_OTC=false
QUOTEX_PROFILE_DIR=/data/quotex-profile
```

Optional tuning:

```text
FALCON_BASE_URL=http://127.0.0.1:3000
QUOTEX_SIGNAL_POLL_MS=500
QUOTEX_TARGET_OFFSET_MS=300
QUOTEX_HARD_CUTOFF_MS=3000
QUOTEX_URL=https://qxbroker.com/en/sign-in/modal/
```

## Read-only OTC collector

The first 15s/30s milestone is a separate read-only collector. It does not click Up/Down and it does not use `QUOTEX_LIVE_EXECUTION`.

Run:

```text
npm run quotex:otc
```

Required Railway variables:

```text
QUOTEX_OTC_COLLECTOR_ENABLED=true
QUOTEX_EMAIL=your Quotex email
QUOTEX_PASSWORD=your Quotex password
QUOTEX_PROFILE_DIR=/data/quotex-profile
QUOTEX_OTC_SYMBOL=EURUSD
```

Optional collector tuning:

```text
QUOTEX_OTC_POLL_MS=50
QUOTEX_OTC_DATA_DIR=/data/quotex-otc
QUOTEX_OTC_DIAGNOSTIC_MS=30000
```

Expected logs are `login-ok`, then `collector-ready`, followed by changing `tick` records. Tick data is written as JSONL under `/data/quotex-otc/` with the exact server timestamp and observed Quotex OTC price. If the current Quotex DOM build uses a different price element, the collector emits `quote-not-found` diagnostics with visible numeric candidates so the selector can be corrected without enabling trading.

Keep this collector observational until its recorded price is verified against the same Quotex OTC chart on-screen.

## First mobile test

Keep `QUOTEX_LIVE_EXECUTION=false`. Redeploy and inspect Railway logs. Expected sequence:

- `login-ok` or `session-ready`
- `observe-signal` whenever Falcon publishes a qualified execution signal

If the log says that login requires verification/CAPTCHA, leave live execution off. Complete/re-establish the account session before arming execution.

Only after the Railway session remains stable and the observed pair/balance/history match the real Quotex account should `QUOTEX_LIVE_EXECUTION` be changed to `true`.

## Persistent session

Attach a Railway volume at `/data` if you want Chromium's remembered Quotex session to survive redeploys/restarts. Without a volume the worker can still attempt email/password login again, but Quotex may request verification.

## Security

Do **not** commit Quotex passwords, cookies, SSIDs, session tokens, or other credentials to GitHub. Store them only in Railway environment variables/secrets.
