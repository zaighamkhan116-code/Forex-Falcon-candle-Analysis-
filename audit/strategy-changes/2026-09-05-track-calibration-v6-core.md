# V6 pair×timeframe reaction calibration — core deployment

Core commits:
- `eb3aff1be278f47f327fc26fe533aaeb3730e53b` — add pair/timeframe calibration module
- `9b5bf4f56626eecdeeecc96363fa8b75ab7e2236` — apply V6 calibration to cadence-preserving direction/confidence scoring
- `d0e66fb3fc976a1223226ed4e913f6adc98608f2` — add regression coverage

## Evidence basis
Clean exact-boundary forward batches after the global 57% epoch show that remaining errors are track/state specific rather than a single-threshold problem.

- GBPUSD 1M: repeated weak-reaction / wick-heavy / poor-VSA confidence-direction failures, including the 13.3% clean batch.
- GBPUSD 2M: large state swings, so bad-state discrimination is preferable to a blanket direction or confidence rule.
- EURUSD 3M/5M: recurring mature-displacement / exhaustion pattern where larger range/body and Bollinger expansion can precede failed next-candle continuation.
- EURJPY 2M/3M: strongest separation when transition risk, actual progress and structural confirmation are respected.
- USDJPY: recent 3M recovery argues against a broad intervention; only demonstrated compound weak-state conflict is targeted.
- AUDUSD: profitable late/mature reactions disprove a blanket late-entry veto; healthy reaction quality is explicitly preserved.

## Core change
`lib/trackCalibration.js` independently evaluates each pair×timeframe using only pre-boundary features: VSA effort/result, candle body/wicks, sequence pressure, progress, directional evidence, MTF agreement/opposition, dynamic S/R location, extension, transition state, FVG state, VWAP/ATR displacement, move quality and efficiency.

It produces small bounded direction-ranking and confidence adjustments. It does not pool calibration between markets.

`lib/frequencyScoring.js` V6 consumes those adjustments while preserving one signal at every boundary and retaining the global 57% minimum. Track calibration can lower the rerank hurdle slightly only when the current direction has weak reaction quality AND the opposite direction has healthy reaction quality; the normal evidence/confirmation requirements still apply.

## Pair policies
- EURUSD: 3M/5M continuation-exhaustion discrimination; mild short-horizon transition-conflict penalty.
- GBPUSD: 1M reaction-quality arbitration; 2M bad-state discrimination; conservative mature-move caution on 3M/5M.
- EURJPY: 2M/3M transition-without-progress penalty and clean-structure credit; mild 1M MTF and 5M extension handling.
- USDJPY: preserve healthy 3M recovery; target weak 5M transition/progress state and short-horizon compound MTF conflict.
- AUDUSD: preserve healthy/resolved-FVG reactions, including mature 5M reactions; penalize only compound weak-reaction + MTF + failed-progress states.
- 15M: all adjustments capped because the forward sample is smaller.

## Safety / methodology
- Global qualifying floor stays 57%.
- No new hard signal veto is introduced by V6 frequency scoring.
- No boundary cadence is removed.
- No settlement logic is changed.
- No target-candle information is used.
- Shadow remains research-only and does not vote directly into the live signal.
- Future validation must remain independent by exact pair×timeframe.

## Expected effect
Reduce false high-confidence labeling and wrong-direction persistence during weak reactions / exhausted continuations while retaining profitable lower-confidence and mature-reaction entries. The expected improvement is raw directional calibration, not a reduction in trade frequency.

## Validation
Treat `9b5bf4f56626eecdeeecc96363fa8b75ab7e2236` as the V6 core forward-validation epoch. Future 20-result batches must compare V6 against clean V5 baselines per track, including 57.0–61.9 vs >=62, direction, regime, transition, MTF, S/R, FVG, VSA, sequence pressure, EMA/Bollinger context, reaction-quality tags, reranks and streaks. Retune/revert only on repeated independent forward evidence.
