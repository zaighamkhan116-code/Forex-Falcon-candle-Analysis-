import os
from pathlib import Path
from typing import Any, Dict, List, Optional

import joblib
import numpy as np
import pandas as pd
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
from sklearn.ensemble import ExtraTreesClassifier, HistGradientBoostingClassifier, RandomForestClassifier
from sklearn.linear_model import LogisticRegression

MODEL_PATH = Path(os.environ.get("SHADOW_MODEL_BUNDLE", "ml_shadow/models/model_bundle.joblib"))
MODEL_NAME = "RF+EXTRATREES+HISTGB_SHADOW_V1"
REBUILD_VERSION = "NY_INDEPENDENT_V2_REBUILD_COMPACT_V1"
DATA_DIR = Path(os.environ.get("SHADOW_TRAINING_DATA_DIR", "/tmp/falcon-shadow-training"))

app = FastAPI(title="Forex Falcon Shadow Ensemble", version="1.1")
_bundle: Optional[Dict[str, Any]] = None
_load_error: Optional[str] = None
_training_attempted = False


class Candle(BaseModel):
    time: Optional[float] = None
    open: float
    high: float
    low: float
    close: float
    volume: Optional[float] = 0.0


class PredictRequest(BaseModel):
    pair: str
    horizon: int
    analysisTimeframe: Optional[str] = None
    signalBoundary: int = 0
    falconDirection: Optional[str] = None
    falconConfidence: Optional[float] = None
    regime: Optional[str] = None
    features: Dict[str, float] = Field(default_factory=dict)
    candles: List[Candle] = Field(default_factory=list)


def _rsi(series: pd.Series, period: int = 14) -> pd.Series:
    delta = series.diff()
    up = delta.clip(lower=0).ewm(alpha=1 / period, adjust=False).mean()
    down = (-delta.clip(upper=0)).ewm(alpha=1 / period, adjust=False).mean()
    rs = up / down.replace(0, np.nan)
    return 100 - 100 / (1 + rs)


def make_features(df: pd.DataFrame, include_target: bool = False) -> pd.DataFrame:
    c, o, h, l = df["close"], df["open"], df["high"], df["low"]
    x = pd.DataFrame(index=df.index)
    for n in [1, 2, 3, 5, 8, 13, 21, 34, 55]:
        x[f"r{n}"] = c.pct_change(n)
    for n in [3, 5, 8, 13, 21]:
        x[f"vol{n}"] = c.pct_change().rolling(n).std()
        hi, lo = h.rolling(n).max(), l.rolling(n).min()
        x[f"loc{n}"] = (c - lo) / (hi - lo).replace(0, np.nan)
    rng = (h - l).replace(0, np.nan)
    x["body"] = (c - o) / rng
    x["uw"] = (h - np.maximum(o, c)) / rng
    x["lw"] = (np.minimum(o, c) - l) / rng
    for n in [5, 8, 13, 20, 50]:
        ema = c.ewm(span=n, adjust=False).mean()
        x[f"ema{n}_sep"] = (c - ema) / c
        x[f"ema{n}_slope"] = ema.pct_change(3)
    x["rsi"] = _rsi(c) / 100
    mid, sd = c.rolling(20).mean(), c.rolling(20).std()
    x["bbpos"] = (c - (mid - 2 * sd)) / ((mid + 2 * sd) - (mid - 2 * sd)).replace(0, np.nan)
    x["bbwidth"] = 4 * sd / c
    for n in [5, 10, 20]:
        net = (c - c.shift(n)).abs()
        path = c.diff().abs().rolling(n).sum()
        x[f"eff{n}"] = net / path.replace(0, np.nan)
    x["bull_fvg"] = (l > h.shift(2)).astype(float)
    x["bear_fvg"] = (h < l.shift(2)).astype(float)
    if isinstance(df.index, pd.DatetimeIndex):
        mins = df.index.hour * 60 + df.index.minute
    else:
        mins = pd.Series(np.zeros(len(df)), index=df.index)
    x["todsin"] = np.sin(2 * np.pi * mins / 1440)
    x["todcos"] = np.cos(2 * np.pi * mins / 1440)
    x["hour"] = (df.index.hour / 23) if isinstance(df.index, pd.DatetimeIndex) else 0.0
    if include_target:
        x["y"] = (c.shift(-5) > c).astype(int)
    return x.replace([np.inf, -np.inf], np.nan)


def _read_histdata_zip(path: str) -> pd.DataFrame:
    import zipfile
    with zipfile.ZipFile(path) as zf:
        name = next(n for n in zf.namelist() if n.lower().endswith(".csv"))
        with zf.open(name) as fh:
            df = pd.read_csv(fh, sep=";", header=None, names=["date", "open", "high", "low", "close", "volume"])
    df["dt"] = pd.to_datetime(df["date"].astype(str), format="%Y%m%d %H%M%S")
    return df.set_index("dt")[["open", "high", "low", "close", "volume"]].astype(float)


def _download_month(year: str, month: str) -> str:
    from histdata import download_hist_data
    from histdata.api import Platform, TimeFrame
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    return str(download_hist_data(year=year, month=month, pair="eurusd", platform=Platform.GENERIC_ASCII,
                                  time_frame=TimeFrame.ONE_MINUTE, output_directory=str(DATA_DIR), verbose=False))


def train_rebuild_bundle() -> Dict[str, Any]:
    may_path = _download_month("2026", "5")
    june_path = _download_month("2026", "6")
    may, june = _read_histdata_zip(may_path), _read_histdata_zip(june_path)
    fm, fj = make_features(may, True).dropna(), make_features(june, True).dropna()
    train = fm[(fm.index.hour >= 15) & (fm.index.hour < 20)]
    dev = fj[(fj.index.hour >= 15) & (fj.index.hour < 20)]
    names = [c for c in train.columns if c != "y"]

    rf = RandomForestClassifier(n_estimators=30, max_depth=7, min_samples_leaf=12, max_features="sqrt",
                                random_state=42, n_jobs=-1, class_weight="balanced")
    et = ExtraTreesClassifier(n_estimators=30, max_depth=8, min_samples_leaf=10, max_features="sqrt",
                              random_state=43, n_jobs=-1, class_weight="balanced")
    hgb = HistGradientBoostingClassifier(max_iter=50, learning_rate=0.06, max_leaf_nodes=15,
                                         l2_regularization=2.0, random_state=44)
    for model in (rf, et, hgb):
        model.fit(train[names], train["y"])

    probs = np.vstack([rf.predict_proba(dev[names])[:, 1], et.predict_proba(dev[names])[:, 1], hgb.predict_proba(dev[names])[:, 1]])
    votes = (probs >= 0.5).sum(axis=0)
    direction = (votes >= 2).astype(int)
    mean_buy = probs.mean(axis=0)
    dir_conf = np.where(direction == 1, mean_buy, 1 - mean_buy)
    scored = pd.DataFrame({"conf": dir_conf, "win": (direction == dev["y"].to_numpy()).astype(int)}, index=dev.index)
    scored["hourkey"] = scored.index.floor("h")
    selected = scored.sort_values(["hourkey", "conf"]).groupby("hourkey").tail(3)
    calibrator = LogisticRegression().fit(selected[["conf"]], selected["win"])

    bundle = {
        "feature_names": names,
        "random_forest": rf,
        "extra_trees": et,
        "hist_gradient_boosting": hgb,
        "calibrator": calibrator,
        "model_version": REBUILD_VERSION,
        "feature_schema": "eurusd-m1-raw-v1",
        "validation": {
            "training_split": "May 2026 fit; June 2026 selection/calibration",
            "june_selected": int(len(selected)),
            "june_raw_accuracy": float(selected["win"].mean()),
            "original_v2_june_benchmark": 0.6212121212,
            "original_v2_july_unseen_benchmark": 0.6339285714,
            "promotion_allowed": False,
            "reason": "research rebuild; original fitted Independent V2 objects were not supplied"
        },
    }
    MODEL_PATH.parent.mkdir(parents=True, exist_ok=True)
    try:
        joblib.dump(bundle, MODEL_PATH, compress=3)
    except Exception:
        pass
    return bundle


def load_bundle() -> Optional[Dict[str, Any]]:
    global _bundle, _load_error, _training_attempted
    if _bundle is not None:
        return _bundle
    try:
        if MODEL_PATH.exists():
            x = joblib.load(MODEL_PATH)
        else:
            if _training_attempted:
                return None
            _training_attempted = True
            x = train_rebuild_bundle()
        required = {"feature_names", "random_forest", "extra_trees", "hist_gradient_boosting"}
        missing = sorted(required - set(x.keys()))
        if missing:
            raise ValueError(f"Model bundle missing: {', '.join(missing)}")
        _bundle, _load_error = x, None
        return _bundle
    except Exception as exc:
        _load_error = str(exc)
        return None


def probability(model: Any, row: np.ndarray) -> float:
    if hasattr(model, "predict_proba"):
        return float(model.predict_proba(row)[0][1])
    if hasattr(model, "decision_function"):
        z = float(model.decision_function(row)[0])
        return float(1.0 / (1.0 + np.exp(-z)))
    return 1.0 if float(model.predict(row)[0]) > 0 else 0.0


def request_row(req: PredictRequest, names: List[str]) -> np.ndarray:
    if len(req.candles) < 60:
        raise HTTPException(status_code=422, detail=f"Need at least 60 M1 candles; received {len(req.candles)}")
    rows = [c.model_dump() for c in req.candles]
    df = pd.DataFrame(rows)
    if df["time"].notna().all():
        # Node timestamps are milliseconds; tolerate seconds as well.
        unit = "ms" if float(df["time"].abs().max()) > 10_000_000_000 else "s"
        df.index = pd.to_datetime(df["time"], unit=unit, utc=True).tz_convert(None)
    features = make_features(df[["open", "high", "low", "close", "volume"]], False)
    last = features.iloc[-1]
    if last[names].isna().any():
        missing = list(last[names][last[names].isna()].index)
        raise HTTPException(status_code=422, detail=f"Insufficient candle history for features: {missing[:8]}")
    return last[names].to_numpy(dtype=float).reshape(1, -1)


@app.get("/health")
def health() -> Dict[str, Any]:
    bundle = load_bundle()
    return {
        "ok": bundle is not None,
        "model": MODEL_NAME,
        "modelLoaded": bundle is not None,
        "modelVersion": bundle.get("model_version") if bundle else None,
        "modelPath": str(MODEL_PATH),
        "validation": bundle.get("validation") if bundle else None,
        "researchOnly": True,
        "influencesLiveSignal": False,
        "error": _load_error,
    }


@app.post("/predict")
def predict(req: PredictRequest) -> Dict[str, Any]:
    bundle = load_bundle()
    if bundle is None:
        raise HTTPException(status_code=503, detail=_load_error or "Shadow model unavailable")
    if req.pair.upper() != "EURUSD":
        raise HTTPException(status_code=422, detail="Current validated rebuild is EURUSD-only")
    if int(req.horizon) != 5:
        raise HTTPException(status_code=422, detail="Current Independent-V2 rebuild predicts 5-minute direction only")

    names = list(bundle["feature_names"])
    row = request_row(req, names)
    rf = probability(bundle["random_forest"], row)
    et = probability(bundle["extra_trees"], row)
    hgb = probability(bundle["hist_gradient_boosting"], row)
    probs = [rf, et, hgb]
    votes = sum(p >= 0.5 for p in probs)
    direction = "BUY" if votes >= 2 else "SELL"
    ensemble_buy = float(np.mean(probs))
    directional_raw = ensemble_buy if direction == "BUY" else 1.0 - ensemble_buy

    calibrator = bundle.get("calibrator")
    calibrated_win = directional_raw
    if calibrator is not None:
        calibrated_win = float(calibrator.predict_proba(np.array([[directional_raw]]))[0][1])

    return {
        "model": MODEL_NAME,
        "modelVersion": bundle.get("model_version", "unversioned"),
        "direction": direction,
        "confidence": round(calibrated_win * 100.0, 2),
        "calibratedProbability": round(calibrated_win, 6),
        "rawDirectionalConfidence": round(directional_raw, 6),
        "memberProbabilities": {
            "randomForestBuy": round(rf, 6),
            "extraTreesBuy": round(et, 6),
            "histGradientBoostingBuy": round(hgb, 6),
        },
        "featureSchema": bundle.get("feature_schema", "eurusd-m1-raw-v1"),
        "validation": bundle.get("validation"),
        "researchOnly": True,
        "influencedLiveSignal": False,
    }
