import numpy as np
import pandas as pd

from ml_shadow.app import Candle, PredictRequest, make_features, request_row


def _candles(count=80, milliseconds=False):
    base = 1788732000
    scale = 1000 if milliseconds else 1
    rows = []
    for i in range(count):
        close = 1.1600 + i * 0.00001
        rows.append(Candle(
            time=(base + i * 60) * scale,
            open=close - 0.00002,
            high=close + 0.00004,
            low=close - 0.00004,
            close=close,
            volume=100 + i,
        ))
    return rows


def test_request_row_accepts_epoch_seconds_and_builds_datetime_features():
    req = PredictRequest(pair="EURUSD", horizon=5, candles=_candles())
    names = list(make_features(pd.DataFrame({
        "open": np.linspace(1.0, 1.1, 80),
        "high": np.linspace(1.01, 1.11, 80),
        "low": np.linspace(0.99, 1.09, 80),
        "close": np.linspace(1.0, 1.1, 80),
        "volume": np.arange(80) + 1,
    }, index=pd.date_range("2026-09-01", periods=80, freq="min"))).columns)
    row = request_row(req, names)
    assert row.shape == (1, len(names))
    assert np.isfinite(row).all()


def test_request_row_accepts_epoch_milliseconds():
    req = PredictRequest(pair="EURUSD", horizon=5, candles=_candles(milliseconds=True))
    names = ["r1", "todsin", "todcos", "hour"]
    row = request_row(req, names)
    assert row.shape == (1, 4)
    assert np.isfinite(row).all()
