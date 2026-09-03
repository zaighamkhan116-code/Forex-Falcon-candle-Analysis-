# V2.10 track-specific forward calibration

Evidence source: clean exact-boundary post-baseline forward results after the 57% threshold epoch.

- EURUSD 1M, 40 results: 57.0–61.9% = 4W/10L (28.6%); >=62% = 15W/10L/1T (60.0%). Action: restore 62% floor only for EURUSD 1M.
- GBPUSD 1M, 40 results: 57.0–61.9% = 8W/15L (34.8%); >=62% = 9W/7L/1T (56.2%). Action: restore 62% floor only for GBPUSD 1M.
- USDJPY 1M was not changed: 57.0–61.9% = 5W/3L (62.5%), so evidence does not support a global rollback.
- GBPUSD 2M, 32 results: SELL = 1W/10L (9.1%), while BUY = 10W/11L (47.6%); both confidence buckets were poor, so threshold was not the main issue. Action: require accepted fresh breakout for GBPUSD 2M SELL signals; do not globally suppress the track.

Methodology: changes are exact pair×timeframe/condition scoped, reversible, use only information available at signal time, and preserve transition/FVG/continuation safeguards. No calibration is transferred between markets.
