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
const cors = require('cors');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { GoogleGenerativeAI } = require('@google/generative-ai');

// Load .env manually from root directory
try {
  const envPath = path.join(__dirname, '../.env');
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8');
    envContent.split('\n').forEach(line => {
      const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
      if (match) {
        const key = match[1];
        let value = match[2] || '';
        if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
        if (value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1);
        process.env[key] = value;
      }
    });
  }
} catch (e) {
  console.warn('Failed to load .env file:', e.message);
}

const app = express();
const PORT = process.env.PORT || 3000;

// Enable CORS for all origins (Expo Web, physical devices, local development)
app.use(cors());

// Enable large payload parsing for base64 audio uploads
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

console.log('Starting API proxy server...');

// Proxy OSRM requests (use direct axios with HTTP to prevent socket drops and HTTPS timeouts)
app.use('/osrm', async (req, res) => {
  const targetPath = req.url;
  const targetUrl = `http://router.project-osrm.org${targetPath}`;
  console.log(`[OSRM Proxy] ${req.method} ${req.url} → ${targetUrl}`);

  try {
    const response = await axios({
      method: req.method,
      url: targetUrl,
      timeout: 10000,
      headers: {
        'User-Agent': 'WeatherWiseApp/1.0',
        'Accept': 'application/json',
      },
    });
    return res.status(response.status).json(response.data);
  } catch (err) {
    console.warn('[OSRM Proxy Primary Error]', err.message);

    // If alternatives=true timed out or failed, immediately retry with alternatives=false
    // The public OSRM demo server frequently throttles complex multi-route queries, but primary routes return in < 1s!
    if (targetUrl.includes('alternatives=true')) {
      const fallbackUrl = targetUrl.replace('alternatives=true', 'alternatives=false');
      console.log(`[OSRM Proxy] Retrying without alternatives → ${fallbackUrl}`);
      try {
        const fallbackRes = await axios({
          method: req.method,
          url: fallbackUrl,
          timeout: 10000,
          headers: {
            'User-Agent': 'WeatherWiseApp/1.0',
            'Accept': 'application/json',
          },
        });
        return res.status(fallbackRes.status).json(fallbackRes.data);
      } catch (fallbackErr) {
        console.error('[OSRM Proxy Fallback Error]', fallbackErr.message);
      }
    }

    if (err.response) {
      return res.status(err.response.status).json(err.response.data);
    }
    res.status(502).json({
      error: 'OSRM routing failed',
      code: 'NoRoute',
      message: err.message,
    });
  }
});

// Proxy Open-Meteo requests
app.use('/weather', async (req, res) => {
  const targetUrl = `https://api.open-meteo.com/v1/forecast${req.url}`;
  console.log(`[Weather Proxy] ${req.method} ${req.url} → ${targetUrl}`);

  try {
    const response = await axios({
      method: req.method,
      url: targetUrl,
      timeout: 20000,
      headers: {
        'User-Agent': 'WeatherWiseApp/1.0',
        'Accept': 'application/json',
      },
    });
    res.status(response.status).json(response.data);
  } catch (err) {
    console.error('[Weather Proxy Error]', err.message);
    if (err.response) {
      return res.status(err.response.status).json(err.response.data);
    }
    res.status(502).json({
      error: 'Weather fetch failed',
      message: err.message,
    });
  }
});

// Proxy Nominatim requests
app.use('/nominatim', async (req, res) => {
  const targetUrl = `https://nominatim.openstreetmap.org${req.url}`;
  console.log(`[Nominatim Proxy] ${req.method} ${req.url} → ${targetUrl}`);

  try {
    const response = await axios({
      method: req.method,
      url: targetUrl,
      timeout: 15000,
      headers: {
        'User-Agent': 'WeatherWiseApp/1.0 (contact@weatherwise.local)',
        'Accept': 'application/json',
      },
    });
    res.status(response.status).json(response.data);
  } catch (err) {
    console.error('[Nominatim Proxy Error]', err.message);
    if (err.response) {
      return res.status(err.response.status).json(err.response.data);
    }
    res.status(502).json({
      error: 'Nominatim geocoding failed',
      message: err.message,
    });
  }
});

// AI Assistant Endpoint routed through local laptop
app.post('/api/ai', async (req, res) => {
  const apiKey = process.env.EXPO_PUBLIC_GEMINI_API_KEY || '';
  if (!apiKey) {
    return res.status(500).json({ error: 'Gemini API key is missing on the proxy server.' });
  }

  const { audio, origin, destination, overallRisk, firstHazardLabel, firstHazardMinutes } = req.body;
  if (!audio) {
    return res.status(400).json({ error: 'No audio data provided.' });
  }

  console.log(`[Proxy AI] Processing voice request from mobile (${Math.round(audio.length / 1024)} KB base64)...`);

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash',
      systemInstruction: `You are WeatherWise, a voice assistant built into a weather-aware driving navigation app. Your ONLY expertise is:
      1. Weather conditions along the user's route (rain, storms, fog, temperature, wind).
      2. Route safety — advising whether the current route is safe or if alternatives are better.
      3. Driving advice based on weather (e.g., slow down for rain, visibility tips).
      4. Explaining data shown in the app: the map, weather timeline, route comparisons, and alerts.

      STRICT RULES:
      - If the user asks about ANYTHING outside of weather, routes, maps, or driving safety (e.g., general knowledge, math, coding, recipes, news, entertainment, personal questions), you MUST politely decline and redirect them. Example: "I'm WeatherWise — I only know about weather and your route! Try asking me about road conditions or weather along your trip."
      - NEVER answer off-topic questions, even if you know the answer.
      - Keep responses SHORT: 2-3 plain sentences max. No bullet points, no markdown, no lists.
      - The driver may be behind the wheel, so keep it simple and clear.

      Current route context:
      - From: ${origin || 'Unknown'}
      - To: ${destination || 'Unknown'}
      - Overall risk: ${overallRisk || 'clear'}
      - First hazard: ${firstHazardLabel ?? 'none'} in ${firstHazardMinutes ?? 'N/A'} minutes`,
    });

    const audioPart = {
      inlineData: {
        data: audio,
        mimeType: "audio/mp4",
      }
    };

    const result = await model.generateContent([
      audioPart,
      { text: "Listen to the driver's voice. If their question is about weather, route safety, or driving conditions, answer helpfully and briefly. If it is NOT related to weather, routes, or the app, politely tell them you can only help with weather and driving topics." }
    ]);

    const responseText = result.response.text();
    console.log(`[Proxy AI] Success. Response: "${responseText.substring(0, 100).replace(/\n/g, ' ')}..."`);
    res.json({ response: responseText });
  } catch (error) {
    console.error('[Proxy AI] Error calling Gemini:', error);
    res.status(500).json({ error: error.message || 'Failed to process AI response' });
  }
});

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
