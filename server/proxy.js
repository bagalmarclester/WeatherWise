/**
 * Web-only Proxy Server for CORS-restricted APIs
 *
 * This server is used ONLY for Expo Web (browser testing) development.
 * Mobile (Android/iOS) clients bypass this and call APIs directly with no CORS restrictions.
 *
 * Usage:
 *   node server/proxy.js
 *
 * Web client routes:
 *   - http://localhost:3000/osrm/* → https://router.project-osrm.org/*
 *   - http://localhost:3000/weather/* → https://api.open-meteo.com/v1/forecast/*
 *
 * Mobile clients call APIs directly:
 *   - https://router.project-osrm.org/...
 *   - https://api.open-meteo.com/v1/forecast/...
 */

const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');

const app = express();
const PORT = process.env.PORT || 3000;

console.log('Starting CORS proxy for Expo Web development...');
console.log('Note: Mobile clients (Android/iOS) do NOT use this proxy.\n');

// Proxy OSRM requests
app.use(
  '/osrm',
  createProxyMiddleware({
    target: 'https://router.project-osrm.org',
    changeOrigin: true,
    pathRewrite: { '^/osrm': '' },
    onProxyReq: (proxyReq, req, res) => {
      console.log(`[OSRM Proxy] ${req.method} ${req.url} → https://router.project-osrm.org${req.url.replace('/osrm', '')}`);
    },
    onError: (err, req, res) => {
      console.error('[OSRM Proxy Error]', err.message);
      res.status(502).json({ error: 'OSRM proxy failed', details: err.message });
    },
  })
);

// Proxy Open-Meteo requests
app.use(
  '/weather',
  createProxyMiddleware({
    target: 'https://api.open-meteo.com/v1/forecast',
    changeOrigin: true,
    pathRewrite: { '^/weather': '' },
    onProxyReq: (proxyReq, req, res) => {
      console.log(`[Weather Proxy] ${req.method} ${req.url} → https://api.open-meteo.com/v1/forecast${req.url.replace('/weather', '')}`);
    },
    onError: (err, req, res) => {
      console.error('[Weather Proxy Error]', err.message);
      res.status(502).json({ error: 'Weather proxy failed', details: err.message });
    },
  })
);

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', message: 'Web-only CORS proxy is running' });
});

app.listen(PORT, () => {
  console.log(`✓ Proxy server listening on http://localhost:${PORT}`);
  console.log(`✓ OSRM: http://localhost:${PORT}/osrm/route/v1/driving/...`);
  console.log(`✓ Weather: http://localhost:${PORT}/weather?latitude=...`);
  console.log(`\nFor mobile testing (Android/iOS):`;
  console.log(`  - Services use direct API URLs (no proxy)`);
  console.log(`  - This proxy is only for 'expo start --web' development`);
});
