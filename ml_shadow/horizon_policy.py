import json
import os
from pathlib import Path
from typing import Any, Dict


POLICY_VERSION = "SHADOW_TIMEFRAME_FORWARD_POLICY_V1"
POLICY_PATH = Path(os.environ.get(
    "SHADOW_HORIZON_POLICY",
    str(Path(__file__).with_name("forward_horizon_policies.json")),
))


def load_horizon_policies() -> Dict[str, Dict[str, Any]]:
    try:
        raw = json.loads(POLICY_PATH.read_text())
        return raw.get("horizons", {}) if raw.get("policyVersion") == POLICY_VERSION else {}
    except Exception:
        return {}


def apply_horizon_policy(horizon: int, direction: str, calibrated_win: float) -> Dict[str, Any]:
    policy = load_horizon_policies().get(str(int(horizon)), {})
    transform = str(policy.get("directionTransform", "RETAIN")).upper()
    adjusted_direction = direction
    adjusted_probability = float(calibrated_win)
    if transform == "INVERT":
        adjusted_direction = "SELL" if direction == "BUY" else "BUY"
        empirical = float(policy.get("bayesianAccuracy", 0.5))
        # Keep some signal-level discrimination while anchoring confidence to
        # settled forward evidence. This remains research-only.
        adjusted_probability = 0.75 * empirical + 0.25 * (1.0 - float(calibrated_win))
        adjusted_probability = max(0.5, min(0.75, adjusted_probability))
    return {
        "direction": adjusted_direction,
        "probability": adjusted_probability,
        "transform": transform,
        "policy": policy,
    }
