# Frequency Score V5 stabilization

Strategy commit: `a0e58ed284c7658ced4a8ef0fda3e9ec9dbf9423`

## Evidence
Repeated exact-boundary forward batches showed materially poor performance concentrated in late/structurally conflicted signals: adverse support/resistance, failure to progress, transition risk, MTF conflict, unresolved FVG and extension. Several >=62% groups also underperformed, showing that raising the global threshold alone would not solve the failure mode.

## Change
Frequency scoring remains cadence-preserving and does not add a hard veto. V5 applies a compound structural-risk penalty to stale/conflicted entries and allows confidence to be earned back by fresh direction-aligned evidence: renewed progress, consensus, accepted breakout progress, resolved/rejected FVG, VSA support, sequence pressure and move quality.

## Expected effect
Reduce false high-confidence labeling of mature/stalling continuation setups while preserving early/reaction signals and one boundary signal per track. The 57% global threshold remains unchanged.

## Validation
Do not attribute mixed pre/post deployment batches to V5. Evaluate V5 only after each pair×timeframe accumulates clean post-commit exact-boundary samples, independently. Compare 57.0–61.9% vs >=62%, direction, regime, S/R, MTF conflict, transition risk, progress, FVG, ATR/VWAP/VSA, EMA/Bollinger and loss streaks. Revert or retune only if clean forward evidence shows deterioration.
