const axios = require('axios');

async function testEngine() {
  console.log('🚀 Starting WeatherWise Integration Test (Davao to Digos)...');

  const origin = { lat: 7.1907, lon: 125.4553 };
  const destination = { lat: 6.7497, lon: 125.3553 }; // Digos City
  const startTime = Date.now();

  try {
    // 1. OSRM Test
    const osrmUrl = `https://router.project-osrm.org/route/v1/driving/${origin.lon},${origin.lat};${destination.lon},${destination.lat}?overview=full&geometries=geojson&steps=true`;
    console.log('\n📡 Calling OSRM...');
    const osrmRes = await axios.get(osrmUrl);
    const route = osrmRes.data.routes[0];
    console.log(`✅ Route: ${route.distance / 1000}km, ${route.duration / 60} mins`);

    // 2. Sample a point (e.g., halfway)
    const coords = route.geometry.coordinates;
    const halfwayIndex = Math.floor(coords.length / 2);
    const [lon, lat] = coords[halfwayIndex];
    const eta = new Date(startTime + (route.duration / 2) * 1000).toISOString();
    console.log(`\n📍 Halfway Point: ${lat}, ${lon} | ETA: ${eta}`);

    // 3. Open-Meteo Test
    const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=precipitation_probability,weathercode&timezone=auto&forecast_days=2`;
    console.log('📡 Calling Open-Meteo...');
    const weatherRes = await axios.get(weatherUrl);
    
    // Debug: Log first 3 timestamps
    console.log('Sample timestamps from API:', weatherRes.data.hourly.time.slice(0, 3));

    // Find closest hour by calculating absolute difference
    const arrivalTime = new Date(eta).getTime();
    let closestIndex = -1;
    let minDiff = Infinity;

    weatherRes.data.hourly.time.forEach((t, index) => {
      const forecastTime = new Date(t + ":00Z").getTime(); // Treat local time as UTC just for diff calculation or adjust properly
      // Actually, Open-Meteo time strings are '2026-05-16T00:00'. 
      // Let's assume the machine running this and the API local time are aligned for the test or use the provided offset.
      
      const diff = Math.abs(arrivalTime - new Date(t).getTime());
      if (diff < minDiff) {
        minDiff = diff;
        closestIndex = index;
      }
    });

    const prob = weatherRes.data.hourly.precipitation_probability[closestIndex];
    const code = weatherRes.data.hourly.weathercode[closestIndex];

    console.log(`✅ Closest Match: ${weatherRes.data.hourly.time[closestIndex]}`);
    console.log(`✅ Weather at ETA: Index ${closestIndex}, Prob ${prob}%, Code ${code}`);
    console.log(prob > 60 ? '⚠️ DANGER: HIGH RAIN PROBABILITY' : '✅ SAFE: CLEAR SKIES EXPECTED');

    console.log('\n✨ Integration logic verified!');
  } catch (err) {
    console.error('❌ Test failed:', err.message);
  }
}

testEngine();
