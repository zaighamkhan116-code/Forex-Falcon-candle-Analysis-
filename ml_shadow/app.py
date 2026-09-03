import os
from pathlib import Path
from typing import Any, Dict, Optional

import joblib
import numpy as np
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

MODEL_PATH = Path(os.environ.get("SHADOW_MODEL_BUNDLE", "ml_shadow/models/model_bundle.joblib"))
MODEL_NAME = "RF+EXTRATREES+HISTGB_SHADOW_V1"

app = FastAPI(title="Forex Falcon Shadow Ensemble", version="1.0")
_bundle: Optional[Dict[str, Any]] = None
_load_error: Optional[str] = None


class PredictRequest(BaseModel):
    pair: str
    horizon: int
    analysisTimeframe: Optional[str] = None
    signalBoundary: int = 0
    falconDirection: Optional[str] = None
    falconConfidence: Optional[float] = None
    regime: Optional[str] = None
    features: Dict[str, float] = Field(default_factory=dict)


def load_bundle() -> Optional[Dict[str, Any]]:
    global _bundle, _load_error
    if _bundle is not None:
        return _bundle
    try:
        if not MODEL_PATH.exists():
            _load_error = f"Model bundle not found at {MODEL_PATH}"
            return None
        x = joblib.load(MODEL_PATH)
        required = {"feature_names", "random_forest", "extra_trees", "hist_gradient_boosting"}
        missing = sorted(required - set(x.keys()))
        if missing:
            raise ValueError(f"Model bundle missing: {', '.join(missing)}")
        _bundle = x
        _load_error = None
        return _bundle
    except Exception as exc:
        _load_error = str(exc)
        return None


def probability(model: Any, row: np.ndarray) -> float:
    if hasattr(model, "predict_proba"):
        p = model.predict_proba(row)
        return float(p[0][1])
    if hasattr(model, "decision_function"):
        z = float(model.decision_function(row)[0])
        return float(1.0 / (1.0 + np.exp(-z)))
    pred = float(model.predict(row)[0])
    return 1.0 if pred > 0 else 0.0


@app.get("/health")
def health() -> Dict[str, Any]:
    bundle = load_bundle()
    return {
        "ok": bundle is not None,
        "model": MODEL_NAME,
        "modelLoaded": bundle is not None,
        "modelPath": str(MODEL_PATH),
        "error": _load_error,
    }


@app.post("/predict")
def predict(req: PredictRequest) -> Dict[str, Any]:
    bundle = load_bundle()
    if bundle is None:
        raise HTTPException(status_code=503, detail=_load_error or "Shadow model unavailable")

    names = list(bundle["feature_names"])
    row = np.array([[float(req.features.get(name, 0.0)) for name in names]], dtype=float)
    rf = probability(bundle["random_forest"], row)
    et = probability(bundle["extra_trees"], row)
    hgb = probability(bundle["hist_gradient_boosting"], row)
    probs = [rf, et, hgb]
    votes = sum(p >= 0.5 for p in probs)
    direction = "BUY" if votes >= 2 else "SELL"
    ensemble_prob = float(np.mean(probs))

    calibrator = bundle.get("calibrator")
    calibrated = ensemble_prob
    if calibrator is not None:
        if hasattr(calibrator, "predict_proba"):
            calibrated = float(calibrator.predict_proba(np.array([[ensemble_prob]]))[0][1])
        else:
            calibrated = float(calibrator.predict(np.array([[ensemble_prob]]))[0])

    directional_confidence = calibrated if direction == "BUY" else 1.0 - calibrated
    return {
        "model": MODEL_NAME,
        "modelVersion": bundle.get("model_version", "unversioned"),
        "direction": direction,
        "confidence": round(directional_confidence * 100.0, 2),
        "calibratedProbability": round(calibrated, 6),
        "memberProbabilities": {
            "randomForestBuy": round(rf, 6),
            "extraTreesBuy": round(et, 6),
            "histGradientBoostingBuy": round(hgb, 6),
        },
        "featureSchema": bundle.get("feature_schema", "falcon-shadow-v1"),
        "influencedLiveSignal": False,
    }
