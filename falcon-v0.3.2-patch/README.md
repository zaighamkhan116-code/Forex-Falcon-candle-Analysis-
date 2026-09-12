# Forex Falcon v0.3.2 Targeted Gates

This patch intentionally backs away from the broad v0.3.1 entry-gate scoring that reduced live accuracy/frequency.

## Accuracy policy
- Keep the stable v0.3.0 signal engine.
- Keep the global minimum confidence at 65%.
- Do not globally tighten 1m/2m/5m.
- Veto only the repeatedly observed failure conditions:
  - 10s/15s insufficient live micro coverage.
  - late micro reversal / multi-window opposition on 10s/15s/30s.
  - BUY at upper Bollinger exhaustion or SELL at lower Bollinger exhaustion unless breakout acceptance is confirmed.
  - EMA opposition only when market structure independently opposes the trade too.
  - continuation entries during a known FALSE_BREAK.
  - unconfirmed TRANSITION setups on short expiries.

## Execution / Recovery
- Short-expiry command preparation is widened for 10s and 15s, while click freshness remains limited.
- Recovery MTG steps are no longer forced back to 4 at bridge startup.
- Desktop recoveryMtgSteps syncs into the bridge.
- Once Main MTG is exhausted, Recovery evaluates the next qualifying automatic-pair signal without being locked to the completed Main cycle, preventing the previous post-MTG stall.
- One active broker trade at a time remains mandatory.

## Files
- `server-targeted-gates.js`: replacement `commandDeadlineMs()` + `entryQuality()` for the stable Desktop v0.3.0 server.
- `execution-background-recovery.patch.txt`: exact Bridge v1.7 -> v1.8 recovery/short-expiry background changes.

The final packaged ZIP should be built from stable Desktop v0.3.0 + Bridge v1.7 with these targeted changes, not from the low-accuracy v0.3.1 broad-gate build.
