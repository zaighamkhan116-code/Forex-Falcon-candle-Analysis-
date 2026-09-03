# Falcon Model Arbitration — Historical Baseline

Date: 2026-09-04
Status: RESEARCH ONLY — no live weighting influence

## Source material
- Forex Falcon EURUSD complete handoff bundle.
- NY locked Core + Independent signal-level records.
- EURUSD M1 HistData May-August 2026.
- Locked NY Core model package confirms the Core is a frozen ExtraTrees directional model plus a separate probability calibrator.
- NY Independent V2 is a separate RF + ExtraTrees + HistGradientBoosting majority-vote engine, top 3 per represented NY hour.

## Saved validation benchmarks
Independent V2:
- June development: 330 signals, 62.12% raw.
- July unseen: 336 signals, 63.39% raw.
- August locked holdout: 51 signals, 64.71% raw.

Locked Core:
- July unseen selected: 78, 75.64% raw.
- August locked holdout selected: 11, 81.82% raw.

## Exact selected-timestamp overlap
The historical router discarded Independent duplicates whenever Core existed, so the saved signal lists provide only a small exact overlap sample.

Across July unseen + August locked holdout:
- Core selected signals: 89.
- Independent selected signals in those validation periods: 387.
- Exact timestamps selected by both: 9.
- Same direction on all 9 overlaps.
- Agreement wins: 7.
- Agreement losses: 2.
- Decided agreement accuracy: 77.78% (7/9).
- Historical selected-signal disagreements at the exact same timestamp: 0 in the preserved output.

This is NOT enough evidence for model weighting. Live shadow mode must retain every simultaneous prediction, including disagreement, rather than reproduce the old duplicate-discard behavior.

## Two preserved shared-loss examples
### 2026-07-12 18:01 dataset time — both BUY, both LOSS
Observed local market-state reconstruction at the signal minute:
- Strong negative short momentum: r3 approximately -0.0386%, r5 approximately -0.0465%.
- Bearish EMA slope.
- RSI approximately 29.3 and BB z approximately -3.01: deeply stretched/oversold.
- Current candle body strongly bearish (approximately -0.86 of range).
- Bearish FVG creation present.
- Range percentile approximately 90% of the recent 60-minute window.
- Independent directional confidence was very high (~0.879) while calibrated win probability remained conservative (~0.619).

Interpretation: both designs appear to have treated an extreme downside stretch as a BUY/reversal opportunity while immediate bearish displacement/FVG creation was still active. Candidate lesson: oversold/stretch evidence must not automatically dominate unresolved displacement/failure-to-stabilize evidence.

### 2026-07-29 18:51 dataset time — both SELL, both LOSS
Observed reconstruction:
- Positive r1/r3/r5/r13 momentum.
- Positive EMA slopes.
- RSI approximately 67.6 and BB z approximately +1.54: elevated/near overbought but not as extreme as the first case.
- Current candle bullish with large lower wick.
- Directional efficiency approximately 0.55 and range percentile approximately 77%.
- Independent directional confidence ~0.762; calibrated win probability ~0.621.

Interpretation: both designs appear to have faded an elevated bullish state with SELL while trend/short momentum was still positive. Candidate lesson: overbought/extension alone should not imply reversal without loss of progress, rejection, or confirmed transition.

## Shared-loss preliminary pattern
The two historical shared losses are opposite-direction examples of the same possible blind spot: **premature mean-reversion against still-active displacement**.

Do NOT hard-code a rule from two observations. Forward arbitration should track whether shared losses cluster when:
- price is extended/overbought/oversold,
- but short momentum and EMA slope still support the existing move,
- there is no failure-to-progress/rejection confirmation,
- or an FVG/displacement state remains active.

## Independent V2 reconstruction status
The handoff does not include the fitted RF/ExtraTrees/HGB model objects or exact original hyperparameters. A clean rebuild candidate was trained with May only and calibrated/selected with June only. Initial result:
- June: 330 signals (exact historical count), ~65.15% raw.
- July unseen: 336 signals (exact historical count), ~63.99% raw.
- Historical July benchmark: 63.39% raw.

### July timestamp/direction parity check
- Saved original July selections: 336.
- Rebuild candidate July selections: 336.
- Exact selected timestamps shared by both: 123 / 336 = 36.61%.
- Direction agreement on those exact shared timestamps: 123 / 123 = 100%.
- On saved July timestamps where the rebuilt feature row was available, rebuilt majority direction agreed with the saved Independent direction about 85.12%.

Conclusion: the candidate has substantial directional similarity and reproduces the historical signal count and aggregate accuracy closely, but it does **not** reproduce the original ranking/selection timestamps closely enough to be called the original NY Independent V2. Keep model version `NY_INDEPENDENT_V2_REBUILD_CANDIDATE_1`; do not promote it or assign it live weight. Continue searching for exact artifacts or improve reproduction only through May/June development evidence while preserving July as validation.

## Arbitration policy
- Shadow model cannot influence live signal yet.
- Record AGREE_BUY, AGREE_SELL, AGREE_WIN, AGREE_LOSS, ties.
- Record DISAGREE_FALCON_WIN and DISAGREE_SHADOW_WIN.
- Diagnose shared losses for common blind spots.
- Diagnose disagreement winners by regime/condition.
- Global weighting remains 50/50 until at least 20 decided live disagreements.
- Regime-specific weighting requires at least 15 observations in the regime and at least 20 decided disagreements; weights are Bayesian-smoothed and capped to 25/75.
- Any calculated weights are research-only until explicitly promoted after forward validation.
