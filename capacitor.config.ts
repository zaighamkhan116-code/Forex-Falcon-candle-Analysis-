import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.forexfalcon.nextcandle',
  appName: 'Next Candle Intelligence',
  webDir: 'public',
  server: {
    url: process.env.CAPACITOR_SERVER_URL || 'https://falcon-server-production-db6a.up.railway.app',
    cleartext: false,
    allowNavigation: [
      'falcon-server-production-db6a.up.railway.app',
      '*.tradingview.com',
      '*.tradingview-widget.com'
    ]
  },
  ios: {
    contentInset: 'automatic',
    scrollEnabled: true,
    backgroundColor: '#07030f'
  }
};

export default config;
