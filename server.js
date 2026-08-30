import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const app = express();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'Forex Falcon', mode: 'UI prototype', timestamp: new Date().toISOString() });
});

app.get('/api/config', (_req, res) => {
  res.json({
    title: 'Next Candle Intelligence',
    pairs: ['EURUSD','EURJPY','GBPUSD','CADCHF','USDJPY','NZDCHF','USDPKR','USDINR','BTCUSD','XAUUSD'],
    horizons: [1,2,3,5,15],
    minimumProbability: 60
  });
});

app.get('*', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => console.log(`Forex Falcon running on port ${PORT}`));
