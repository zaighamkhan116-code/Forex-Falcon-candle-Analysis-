## Current root cause checkpoint

Railway confirms the live OTC collector and bridge are deployed from `feature/quotex-otc-readonly-feed`. They are data/analysis services, not a server-side trade executor. The dedicated OTC audit service is separately crashed because it assumes `/data/quotex-otc` exists locally. Therefore a healthy OTC signal feed does not imply orders will be placed. Automated Quotex order placement must occur in the browser/extension execution layer (or a separate authenticated executor), and that layer needs explicit execution-state telemetry.
