# 57% Threshold Forward-Validation Epoch

Date: 2026-09-02
Scope: EURUSD, GBPUSD, EURJPY, USDJPY, AUDUSD × 1M, 2M, 3M, 5M, 15M.

## Hypothesis
The previous >=62% qualifying threshold may allow some signals only after directional evidence has strengthened enough that the candle sequence is already extended. The user observed that very high confidence, especially near 80%, can sometimes occur late in the move. This experiment lowers the qualifying BUY/SELL threshold to >=57% to test whether earlier, lower-confidence entries improve next-candle timing before exhaustion/reversion develops.

## Controlled change
- Baseline threshold: >=62%.
- Test threshold: >=57%.
- Decision-fusion architecture remains V2.5.
- Transition-risk, late counter-trend continuation, support/resistance, MTF-conflict, quality, and breakout safeguards remain active.
- Exact candle-boundary settlement remains authoritative.
- No lookahead or future settlement information is used for signal generation.
- Pair×timeframe calibration remains independent.

Server threshold change commit: `f68d3e177da03bfcbf0add98ad3d23c818efab75`.
UI threshold-alignment commits: `31b4dae03b80317991bbdd49a2b7a71517a74e26`, `408664df2215383ffb7d7f85a2d402f0d0f3b577`.

## Required validation
For every new 20-result batch, compare the 57.0–61.9% bucket with >=62% trades within the same pair×timeframe. Track win/loss/tie rate, direction, regime, entry timing, extension/exhaustion, adverse S/R, MTF conflict, FVG state, transition-risk state, MA/Bollinger confirmation, and calibration.

Do not infer that lower confidence is better merely because it enters earlier. Retain 57% only if forward evidence shows acceptable or improved raw directional performance and/or demonstrably better entry timing without materially worsening calibration or loss clustering. Revert or revise when sufficiently supported post-change evidence shows deterioration.
