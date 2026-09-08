# V3.5 targeted compound-loss shadow validation

## Purpose

The all-loss audit found repeated weak-progress, compression, transition and multi-family direction conflicts on EURJPY 1M/2M, GBPUSD 1M, EURUSD 5M, USDJPY 5M and AUDUSD 2M. These signatures must be tested per track without reducing scheduled signal frequency or adding recovery trades.

## Runtime change

- The boundary research path now applies the same locked forward track calibration as the interactive path after frequency scoring.
- Newly identified V3.5 signatures are shadow candidates only. They record the proposed opposite direction but do not change the live direction.
- Existing validated/locked reranks, including AUDUSD 1M, remain unchanged.
- Every signal remains qualified and scheduled; candidate frequency impact is `NONE`.

## Audit change

Canonical capture now persists direct tick direction, pressure, reliability, multi-window pressure, persistence, reversal, density, continuity, freshness, spread health, efficiency, acceleration and agreement. It also persists active rerank and V3.5 shadow-candidate evidence.

## Historical diagnostic warning

The initial full-history replay is diagnostic and not deployment evidence. Several broad loss-derived signatures also captured winning trades:

| Shadow track | Samples | Existing-direction accuracy | Counterfactual flip |
|---|---:|---:|---:|
| EURJPY 1M | 18 | 55.56% | 44.44% |
| EURJPY 2M | 21 | 23.81% | 76.19% |
| GBPUSD 1M | 26 | 71.43% | 28.57% |
| AUDUSD 2M | 5 | 60.00% | 40.00% |
| USDJPY 5M | 1 | 100.00% | 0.00% |

This is why V3.5 remains shadow-only. EURJPY 2M is promising but must still exceed 52% on multiple unseen chronological windows and reduce loss streaks before promotion.

## Promotion gate

Promote a track independently only after multiple unseen forward windows exceed 52% raw accuracy excluding ties, loss streaks improve, and all scheduled signals remain present. Do not infer a global rule from one track.
