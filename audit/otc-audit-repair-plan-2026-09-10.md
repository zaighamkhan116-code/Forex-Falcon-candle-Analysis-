# OTC hourly audit repair

- Source branch: `feature/quotex-otc-readonly-feed`
- App display baseline: 500 ms simulated execution results
- Current Railway auditor `quotex-otc-audit-1000ms` crashes because `/data/quotex-otc` is not mounted in that service.
- Repair target: consume the same canonical OTC settlement/result source exposed by the running bridge/collector rather than assuming a local filesystem mount.
- Hourly output must include pair × expiry totals, WR, max losing streak, every streak >=3, and cause-context fields (confidence, direction, momentum/velocity/acceleration, rejection, sequence pressure, volatility/compression, trend/chop, breakout/failure, timing and lag outcome flip).
- Do not alter live thresholds solely as part of the audit repair.
- Execution-stop diagnosis must emit `execution_block_reason` for every rejected order attempt so silent stops become observable.
