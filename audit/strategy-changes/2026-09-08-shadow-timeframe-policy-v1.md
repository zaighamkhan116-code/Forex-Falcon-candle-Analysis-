# Shadow timeframe forward policy V1

## Settled comparison evidence

The first 542 usable EURUSD Shadow predictions were evaluated against the same exact-boundary settlements as Falcon. Ties were excluded from raw accuracy.

| Horizon | Settled | Shadow raw accuracy | Decision |
|---|---:|---:|---|
| 1M | 140 | 46.34% | Retain unchanged; unstable chronological windows |
| 2M | 139 | 55.30% | Retain the existing direction |
| 3M | 119 | 49.56% | Retain unchanged; near neutral |
| 5M | 105 | 52.08% | Retain unchanged; unstable chronological windows |
| 15M | 39 | 35.90% | Apply research-only direction inversion |

## 15M correction

The inverse 15M direction produced 25 wins and 14 losses across two chronological sections:

- Section 1: 65.00%
- Section 2: 63.16%
- Combined: 64.10%
- Maximum loss streak: 5 to 3
- Streaks of five or more losses: 1 to 0
- Frequency impact: none

The correction changes only the Shadow output. Falcon remains untouched. Shadow remains research-only and cannot influence a live signal.

Confidence is anchored to a Bayesian-smoothed 15M forward rate and retains a smaller signal-level contribution from the original model. The response records the original model direction, adjusted direction, original calibrated probability, policy version and complete horizon-policy evidence.

## Safety

The 1M, 3M and 5M directions are not flipped because their chronological behavior is inconsistent. The 2M direction is retained because it is the only existing horizon with an overall forward edge above 52%. Further changes require new settled chronological windows.
