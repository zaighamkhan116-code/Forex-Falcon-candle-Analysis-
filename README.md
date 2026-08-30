# Forex Falcon — Next Candle Intelligence

Mobile-first fixed-horizon market analysis dashboard.

## Locked UI rules
- Pairs: EURUSD, EURJPY, GBPUSD, CADCHF, USDJPY, NZDCHF, USDPKR, USDINR, BTCUSD, XAUUSD
- Prediction horizons: 1m, 2m, 3m, 5m, 15m
- Central circle displays only BUY or SELL and probability
- Only probability >= 60% is surfaced as a signal
- Latest 11 qualifying signals are displayed
- Current unresolved signal remains PENDING until expiry
- Last 10 resolved results produce the displayed win rate

## Current stage
The dashboard and server shell are implemented. No fake market predictions are generated. The next stage is live market-data ingestion and the server-side horizon-specific analysis engine.

## Run
```bash
npm install
npm start
```

Railway can deploy this repository as a Node service. It uses `PORT` automatically.

## Security
Market-data API keys must be stored as Railway environment variables and must never be shipped in browser JavaScript.
