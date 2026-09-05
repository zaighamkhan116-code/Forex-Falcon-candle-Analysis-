# V6.1 track-local streak-state learning

## Scope
All 25 independent tracks: EURUSD, GBPUSD, EURJPY, USDJPY, AUDUSD × 1M, 2M, 3M, 5M, 15M.

## Purpose
Reduce repeated wrong-state persistence without stopping trades, reducing cadence, pooling markets, or using post-settlement information in a live decision.

## Design
- Maintain independent recent outcome memory per exact pair×timeframe.
- Do not react to a single loss.
- After 2+ consecutive losses, compare the current pre-boundary structural signature against features repeatedly present in that same track's recent losses versus wins.
- Penalize repeated loss-associated combinations such as no progress, MTF conflict, transition risk, extension, unresolved FVG, poor VSA, weak body, hostile wick, low efficiency, and sequence conflict.
- After 2+ consecutive wins, allow modest confidence credit when the current signature matches features repeatedly associated with wins on that exact track.
- Confidence adjustment is soft and capped: -4 to +2 points.
- Minimum live confidence remains 57 and one signal per boundary is preserved.
- Shadow remains research-only.

## No-lookahead
The streak memory contains settled historical outcomes, but the current decision uses only features available before the new target candle. No target-candle or future information enters the current feature signature.

## Validation
Treat V6.1 as a new forward-validation epoch once wired into both background and interactive runtime paths. Compare loss-streak frequency/length, win-streak length, raw WR, 57–61.9 vs >=62 calibration, direction, regime, MTF, S/R, VSA, sequence pressure, FVG, EMA/Bollinger and reaction quality independently for every track.
