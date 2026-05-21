/**
 * API Proxy Server
 * 
 * Proxies external API requests from the mobile app through the dev machine.
 * This is needed because external APIs (OSRM, Open-Meteo) may be unreachable
 * from certain mobile networks/ISPs.
 * 
 * Endpoints:
 *   GET /route    — Proxies OSRM routing requests
 *   GET /weather  — Proxies Open-Meteo weather requests
 *   GET /health   — Health check
 * 
 * Usage: node server/proxy.js
 * The server runs on port 3001 by default.
 */

const express = require('express');
const cors = require('cors');
const https = require('https');

const app = express();
const PORT = 3001;

// Allow all origins (the mobile app connects from the device's IP)
app.use(cors());

/**
 * Generic HTTPS fetch helper with timeout.
 * Includes a User-Agent header required by Nominatim's usage policy.
 */
const USER_AGENT = 'WeatherWiseApp/1.0 (tester@um.edu.ph)';

const httpsGet = (url, timeoutMs = 30000) => {
  return new Promise((resolve, reject) => {
    https.get(url, { timeout: timeoutMs, headers: { 'User-Agent': USER_AGENT } }, (response) => {
      let body = '';
      response.on('data', (chunk) => { body += chunk; });
      response.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch (e) {
          reject(new Error(`Failed to parse response: ${body.substring(0, 200)}`));
        }
      });
    }).on('error', reject)
      .on('timeout', function () { this.destroy(); reject(new Error('Request timed out')); });
  });
};

/**
 * GET /route
 * Query params: origin (lon,lat) and destination (lon,lat)
 * Example: /route?origin=125.4133,6.8376&destination=125.59644,7.06572
 */
app.get('/route', async (req, res) => {
  const { origin, destination, alternatives } = req.query;

  if (!origin || !destination) {
    return res.status(400).json({ error: 'Missing origin or destination query params' });
  }

  const [lon1, lat1] = String(origin).split(',').map(Number);
  const [lon2, lat2] = String(destination).split(',').map(Number);

  if ([lat1, lon1, lat2, lon2].some(isNaN)) {
    return res.status(400).json({ error: 'Invalid coordinate format. Use lon,lat' });
  }

  const altParam = alternatives === 'true' ? '&alternatives=true' : '';
  const osrmUrl = `https://router.project-osrm.org/route/v1/driving/${lon1},${lat1};${lon2},${lat2}?overview=full&geometries=geojson${altParam}`;
  console.log(`[Proxy/OSRM] Forwarding: ${osrmUrl}`);


  try {
    const data = await httpsGet(osrmUrl);
    console.log(`[Proxy/OSRM] ✓ Success`);
    res.json(data);
  } catch (error) {
    console.error(`[Proxy/OSRM] ✗ Failed:`, error.message);
    res.status(502).json({ error: 'Failed to reach OSRM server', details: error.message });
  }
});

/**
 * GET /weather
 * Query params: lat, lon, datetime (ISO 8601)
 * Example: /weather?lat=6.8376&lon=125.4133&datetime=2026-05-16T01:00:00Z
 * 
 * Returns the full Open-Meteo hourly forecast response.
 */
app.get('/weather', async (req, res) => {
  const { lat, lon } = req.query;

  if (!lat || !lon) {
    return res.status(400).json({ error: 'Missing lat or lon query params' });
  }

  const latitude = Number(lat);
  const longitude = Number(lon);

  if (isNaN(latitude) || isNaN(longitude)) {
    return res.status(400).json({ error: 'Invalid lat/lon values' });
  }

  const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&hourly=precipitation_probability,precipitation,weathercode&timezone=auto&forecast_days=2`;
  console.log(`[Proxy/Weather] Forwarding: lat=${latitude}, lon=${longitude}`);

  try {
    const data = await httpsGet(weatherUrl, 15000);
    console.log(`[Proxy/Weather] ✓ Success`);
    res.json(data);
  } catch (error) {
    console.error(`[Proxy/Weather] ✗ Failed:`, error.message);
    res.status(502).json({ error: 'Failed to reach Open-Meteo', details: error.message });
  }
});

/**
 * GET /geocode/search
 * Query params: q (search text)
 * Example: /geocode/search?q=SM%20Lanang
 * Proxies Nominatim forward-geocoding requests.
 */
app.get('/geocode/search', async (req, res) => {
  const { q } = req.query;

  if (!q) {
    return res.status(400).json({ error: 'Missing q query param' });
  }

  const nominatimUrl = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(String(q))}&format=json&limit=5&countrycodes=ph`;
  console.log(`[Proxy/Geocode] Search: "${q}"`);

  try {
    const data = await httpsGet(nominatimUrl, 10000);
    console.log(`[Proxy/Geocode] ✓ Search returned ${Array.isArray(data) ? data.length : 0} results`);
    res.json(data);
  } catch (error) {
    console.error(`[Proxy/Geocode] ✗ Search failed:`, error.message);
    res.status(502).json({ error: 'Failed to reach Nominatim', details: error.message });
  }
});

/**
 * GET /geocode/reverse
 * Query params: lat, lon
 * Example: /geocode/reverse?lat=7.0718&lon=125.6134
 * Proxies Nominatim reverse-geocoding requests.
 */
app.get('/geocode/reverse', async (req, res) => {
  const { lat, lon } = req.query;

  if (!lat || !lon) {
    return res.status(400).json({ error: 'Missing lat or lon query params' });
  }

  const nominatimUrl = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json`;
  console.log(`[Proxy/Geocode] Reverse: lat=${lat}, lon=${lon}`);

  try {
    const data = await httpsGet(nominatimUrl, 10000);
    console.log(`[Proxy/Geocode] ✓ Reverse: ${data.display_name ? data.display_name.substring(0, 50) + '...' : 'no result'}`);
    res.json(data);
  } catch (error) {
    console.error(`[Proxy/Geocode] ✗ Reverse failed:`, error.message);
    res.status(502).json({ error: 'Failed to reach Nominatim', details: error.message });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.listen(PORT, '0.0.0.0', () => {
  const os = require('os');
  const interfaces = os.networkInterfaces();
  const addresses = [];
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        addresses.push(iface.address);
      }
    }
  }

  console.log(`\n🚀 API Proxy Server running on port ${PORT}`);
  console.log(`   Endpoints:`);
  console.log(`     GET /route           — OSRM routing proxy`);
  console.log(`     GET /weather         — Open-Meteo weather proxy`);
  console.log(`     GET /geocode/search  — Nominatim search proxy`);
  console.log(`     GET /geocode/reverse — Nominatim reverse geocode proxy`);
  console.log(`     GET /health          — Health check`);
  console.log(`\n   Local:   http://localhost:${PORT}/health`);
  addresses.forEach(ip => {
    console.log(`   Network: http://${ip}:${PORT}/health`);
  });
  console.log(`\n   The mobile app will auto-detect this proxy via Expo.\n`);
});
