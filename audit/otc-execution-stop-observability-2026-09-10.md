# OTC execution-stop observability requirement

Every signal considered for automated Quotex execution must end in one of two explicit states:

1. `execution_submitted=true` with pair, expiry, direction, signalId and timestamp, or
2. `execution_submitted=false` with a machine-readable `execution_block_reason`.

Required block reasons include: `feed_stale`, `signal_expired`, `pair_not_selected`, `pair_switch_in_progress`, `expiry_mismatch`, `cooldown_active`, `loss_sleep_active`, `duplicate_signal`, `recovery_disabled`, `order_in_flight`, `dom_selector_missing`, `quotex_not_authenticated`, `trade_button_disabled`, and `unknown_execution_error`.

The bot must never silently ignore a valid fresh signal. This diagnostic requirement does not weaken live signal quality rules.
