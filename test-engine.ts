import { fetchRoute } from './services/osrm';
import { fetchWeatherAtPoint, weatherCodeToLabel } from './services/weather';
import { sampleWaypointsFromCoords } from './utils/spatiotemporal';

async function runTest() {
  console.log('🚀 Starting WeatherWise Engine Test...');

  // Davao City to General Santos City (Sample route)
  const origin = { lat: 7.1907, lon: 125.4553 };
  const destination = { lat: 6.1135, lon: 125.1719 };

  try {
    // 1. Test Routing
    console.log('\n1. Fetching route from OSRM...');
    const route = await fetchRoute(origin, destination);
    console.log(`✅ Route found!`);
    console.log(`   Distance: ${route.totalDistanceKm.toFixed(2)} km`);
    console.log(`   Duration: ${route.totalDurationMinutes.toFixed(2)} mins`);
    console.log(`   Points: ${route.coordinates.length}`);

    // 2. Test Sampling
    console.log('\n2. Sampling waypoints (every 20 mins)...');
    const waypoints = sampleWaypointsFromCoords(
      route.coordinates,
      route.totalDurationMinutes,
      Date.now()
    );
    console.log(`✅ Generated ${waypoints.length} waypoints.`);
    waypoints.forEach((wp, i) => {
      console.log(`   [WP ${i}] ETA: ${new Date(wp.timestamp).toLocaleTimeString()} at ${wp.lat.toFixed(4)}, ${wp.lon.toFixed(4)}`);
    });

    // 3. Test Weather at a Waypoint
    console.log('\n3. Fetching weather for first waypoint...');
    const wp = waypoints[0];
    const weather = await fetchWeatherAtPoint(wp.lat, wp.lon, new Date(wp.timestamp).toISOString());
    console.log(`✅ Weather received!`);
    console.log(`   Condition: ${weatherCodeToLabel(weather.weatherCode)}`);
    console.log(`   Rain Prob: ${weather.precipitationProbability}%`);
    console.log(`   Is Rainy (>60%): ${weather.isRainy}`);

    console.log('\n✨ All core services verified successfully!');
  } catch (error: any) {
    console.error('\n❌ Test failed:', error.message);
  }
}

runTest();
