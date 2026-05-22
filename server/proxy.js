/**
 * Proxy Server for CORS-restricted APIs and Network Bypass
 *
 * This server is used for Expo Web (browser testing) development,
 * AND for physical devices on restrictive networks that block external APIs.
 *
 * Usage:
 *   node server/proxy.js
 */

const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');

const app = express();
const PORT = process.env.PORT || 3000;

console.log('Starting API proxy server...');

// Proxy OSRM requests
app.use(
  '/osrm',
  createProxyMiddleware({
    target: 'https://router.project-osrm.org',
    changeOrigin: true,
    pathRewrite: { '^/osrm': '' },
    proxyTimeout: 8000,
    timeout: 8000,
    on: {
      proxyReq: (proxyReq, req, res) => {
        console.log(`[OSRM Proxy] ${req.method} ${req.url} → https://router.project-osrm.org${req.url.replace('/osrm', '')}`);
      },
      error: (err, req, res) => {
        console.error('[OSRM Proxy Error]', err.message);
        res.status(502).json({ error: 'OSRM proxy failed', details: err.message });
      },
    }
  })
);

// Proxy Open-Meteo requests
app.use(
  '/weather',
  createProxyMiddleware({
    target: 'https://api.open-meteo.com/v1/forecast',
    changeOrigin: true,
    pathRewrite: { '^/weather': '' },
    proxyTimeout: 8000,
    timeout: 8000,
    on: {
      proxyReq: (proxyReq, req, res) => {
        console.log(`[Weather Proxy] ${req.method} ${req.url} → https://api.open-meteo.com/v1/forecast${req.url.replace('/weather', '')}`);
      },
      error: (err, req, res) => {
        console.error('[Weather Proxy Error]', err.message);
        res.status(502).json({ error: 'Weather proxy failed', details: err.message });
      },
    }
  })
);

// Proxy Nominatim requests
app.use(
  '/nominatim',
  createProxyMiddleware({
    target: 'https://nominatim.openstreetmap.org',
    changeOrigin: true,
    pathRewrite: { '^/nominatim': '' },
    proxyTimeout: 8000,
    timeout: 8000,
    on: {
      proxyReq: (proxyReq, req, res) => {
        // Nominatim requires a User-Agent
        proxyReq.setHeader('User-Agent', 'WeatherWiseApp/1.0');
        console.log(`[Nominatim Proxy] ${req.method} ${req.url} → https://nominatim.openstreetmap.org${req.url.replace('/nominatim', '')}`);
      },
      error: (err, req, res) => {
        console.error('[Nominatim Proxy Error]', err.message);
        res.status(502).json({ error: 'Nominatim proxy failed', details: err.message });
      },
    }
  })
);

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', message: 'Proxy is running' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`✓ Proxy server listening on http://0.0.0.0:${PORT}`);
  console.log(`✓ OSRM: http://localhost:${PORT}/osrm/route/v1/driving/...`);
  console.log(`✓ Weather: http://localhost:${PORT}/weather?latitude=...`);
  console.log(`✓ Nominatim: http://localhost:${PORT}/nominatim/search?q=...`);
  console.log(`\nFor mobile testing (Android/iOS):`);
  console.log(`  - Ensure laptop and phone are on the same WiFi`);
  console.log(`  - The app will automatically detect and use the proxy IP`);
});
