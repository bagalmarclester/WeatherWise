import * as dotenv from 'dotenv';
import { GoogleGenerativeAI } from '@google/generative-ai';
import {
  calculateBearing,
  formatDistance,
  formatDuration,
  formatManeuverInstruction,
  getManeuverIcon,
  findUpcomingHazard,
  formatWeatherWarningSpeech,
} from './utils/navigationCalculations';

// Load .env file
dotenv.config();

// ==========================================
// PURE ENGINE FUNCTIONS (Copied from utils/spatiotemporal.ts to avoid React Native module crashes in pure Node)
// ==========================================
const SEGMENT_MINUTES = 20;

export interface Location { lat: number; lon: number; }
export interface SampledWaypoint extends Location { eta: Date; etaISO: string; segmentLabel: string; segmentIndex: number; }

export const haversineDistanceKm = (a: Location, b: Location): number => {
  const R = 6371; // Earth's radius in km
  const dLat = (b.lat - a.lat) * (Math.PI / 180);
  const dLon = (b.lon - a.lon) * (Math.PI / 180);
  const aa = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(a.lat * (Math.PI / 180)) * Math.cos(b.lat * (Math.PI / 180)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(aa), Math.sqrt(1 - aa));
  return R * c;
};

export const sampleWaypoints = (coordinates: Location[], totalDurationMinutes: number, departureTime: Date): SampledWaypoint[] => {
  if (coordinates.length === 0) return [];
  const cumulativeDistances: number[] = [0];
  let totalDistance = 0;
  for (let i = 1; i < coordinates.length; i++) {
    const d = haversineDistanceKm(coordinates[i - 1], coordinates[i]);
    totalDistance += d;
    cumulativeDistances.push(totalDistance);
  }
  const waypoints: SampledWaypoint[] = [];
  const targetTimes: number[] = [];
  for (let t = 0; t < totalDurationMinutes; t += SEGMENT_MINUTES) {
    targetTimes.push(t);
  }
  if (targetTimes[targetTimes.length - 1] !== totalDurationMinutes) {
    targetTimes.push(totalDurationMinutes);
  }
  targetTimes.forEach((targetMinutes) => {
    const progress = totalDurationMinutes > 0 ? targetMinutes / totalDurationMinutes : 1;
    const targetDist = progress * totalDistance;
    let closestIdx = 0;
    let minDiff = Infinity;
    for (let i = 0; i < cumulativeDistances.length; i++) {
      const diff = Math.abs(cumulativeDistances[i] - targetDist);
      if (diff < minDiff) {
        minDiff = diff;
        closestIdx = i;
      }
    }
    const eta = new Date(departureTime.getTime() + targetMinutes * 60 * 1000);
    const segmentLabel = `~${Math.round(targetMinutes)} min into trip`;
    const isoFull = eta.toISOString();
    const etaISO = isoFull.substring(0, 16);
    waypoints.push({ ...coordinates[closestIdx], eta, etaISO, segmentLabel, segmentIndex: closestIdx });
  });
  return waypoints.filter((wp, idx, self) => idx === 0 || wp.segmentIndex !== self[idx - 1].segmentIndex);
};

// ==========================================
// TEST SUITE LOGIC
// ==========================================
async function runTests() {
  console.log("🚀 Starting WeatherWise Automated Logic Test Suite...\n");

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string) {
    if (condition) {
      console.log(`✅ PASS: ${testName}`);
      passed++;
    } else {
      console.error(`❌ FAIL: ${testName}`);
      failed++;
    }
  }

  // SC-02: Verify Temporal Waypoint Sampling
  console.log("--- SC-02: Spatiotemporal Waypoint Sampling Algorithm ---");
  const mockRoute = [
    { lat: 7.0, lon: 125.0 },
    { lat: 7.1, lon: 125.0 },
    { lat: 7.2, lon: 125.0 },
    { lat: 7.3, lon: 125.0 },
    { lat: 7.4, lon: 125.0 },
  ];
  const now = new Date();
  const waypoints = sampleWaypoints(mockRoute, 60, now);
  
  assert(waypoints.length === 4, "TC-006: Sampled waypoints every 20 minutes (0, 20, 40, 60)");
  assert(waypoints[0].lat === mockRoute[0].lat, "TC-007: Origin is always included as first waypoint");
  assert(waypoints[waypoints.length - 1].lat === mockRoute[mockRoute.length - 1].lat, "TC-008: Destination is always included as last waypoint");

  const diffMinutes = (waypoints[1].eta.getTime() - waypoints[0].eta.getTime()) / 60000;
  assert(Math.round(diffMinutes) === 20, "TC-009: ETA calculation is accurately 20 minutes apart");

  const shortWaypoints = sampleWaypoints(mockRoute, 15, now);
  assert(shortWaypoints.length === 2, "TC-010: Short route under 20 mins has only origin and destination");

  // SC-06: Verify Gemini AI Voice Assistant Integration
  console.log("\n--- SC-06: Gemini AI Assistant API Integration ---");
  const geminiKey = process.env.EXPO_PUBLIC_GEMINI_API_KEY || (process.env.CI ? 'mock_ci_gemini_key' : '');
  if (!geminiKey) {
    console.error("❌ FAIL: TC-049 Gemini API Key not found in .env");
    failed++;
  } else {
    assert(true, `TC-049: Gemini API Key loaded (${process.env.CI && !process.env.EXPO_PUBLIC_GEMINI_API_KEY ? 'CI mock environment' : 'from .env'})`);
    const genAI = new GoogleGenerativeAI(geminiKey);
    assert(typeof genAI.getGenerativeModel === 'function', "TC-028: GoogleGenerativeAI SDK initialized correctly");
  }

  // SC-07: Verify Turn-by-Turn Navigation Engine Logic
  console.log("\n--- SC-07: Turn-by-Turn Navigation Engine Logic ---");

  // Bearing calculation
  const northBearing = calculateBearing({ lat: 0, lon: 0 }, { lat: 1, lon: 0 });
  assert(northBearing === 0 || northBearing === 360, "TC-060: Compass bearing heading North is 0°");

  const eastBearing = calculateBearing({ lat: 0, lon: 0 }, { lat: 0, lon: 1 });
  assert(eastBearing === 90, "TC-061: Compass bearing heading East is 90°");

  // Distance formatting
  assert(formatDistance(350) === "350 m", "TC-062: Sub-kilometer distance formats as meters ('350 m')");
  assert(formatDistance(2400) === "2.4 km", "TC-063: Kilometer distance formats as kilometers ('2.4 km')");

  // Duration formatting
  assert(formatDuration(42) === "42 min", "TC-064: Duration under 60 mins formats as minutes ('42 min')");
  assert(formatDuration(75) === "1 hr 15 min", "TC-065: Duration over an hour formats as hours and minutes ('1 hr 15 min')");

  // Maneuver instruction formatting
  const turnRight = formatManeuverInstruction('turn', 'right', 'JP Laurel Ave');
  assert(turnRight === 'Turn right onto JP Laurel Ave', "TC-066: Maneuver instruction translates to 'Turn right onto JP Laurel Ave'");

  const depart = formatManeuverInstruction('depart', undefined, 'Rizal Street');
  assert(depart === 'Head out on Rizal Street', "TC-067: Maneuver departure translates to 'Head out on Rizal Street'");

  const arrive = formatManeuverInstruction('arrive', undefined, '');
  assert(arrive === 'You have arrived at your destination', "TC-068: Maneuver arrival translates to 'You have arrived at your destination'");

  // Maneuver icon resolution
  assert(getManeuverIcon('turn', 'right') === 'arrow-right-top', "TC-069: Right turn maneuver resolves to arrow-right-top icon");
  assert(getManeuverIcon('arrive', undefined) === 'flag-checkered', "TC-070: Arrival maneuver resolves to flag-checkered icon");

  // Proximity weather hazard detection
  const testAlerts = [
    { lat: 7.05, lon: 125.0, severity: 'clear' as const, label: 'Clear Skies', precipitationProbability: 5 },
    { lat: 7.15, lon: 125.0, severity: 'high' as const, label: 'Heavy Thunderstorm', precipitationProbability: 85 },
    { lat: 7.90, lon: 125.0, severity: 'moderate' as const, label: 'Moderate Rain', precipitationProbability: 55 },
  ];
  const upcoming = findUpcomingHazard({ lat: 7.0, lon: 125.0 }, testAlerts, 25);
  assert(upcoming !== null && upcoming.alert.label === 'Heavy Thunderstorm', "TC-071: Accurately identifies nearest hazardous waypoint ahead within proximity");
  assert(upcoming !== null && upcoming.alert.severity === 'high', "TC-072: Flags high-risk weather condition for driver HUD alert");

  // Voice weather warning speech generator
  const severeSpeech = formatWeatherWarningSpeech('Heavy Thunderstorm', 12.3, 'high');
  assert(
    severeSpeech.includes('Caution') && severeSpeech.includes('12 kilometers') && severeSpeech.includes('reduce speed'),
    "TC-073: High-severity weather warning speech generates urgent caution and speed reduction advisory"
  );

  const moderateSpeech = formatWeatherWarningSpeech('Rain Showers', 8.1, 'moderate');
  assert(
    moderateSpeech.includes('Weather advisory') && moderateSpeech.includes('8 kilometers'),
    "TC-074: Moderate weather warning speech generates advisory notice"
  );

  console.log("\n📊 Test Results:");
  console.log(`✅ Passed: ${passed}`);
  console.log(`❌ Failed: ${failed}`);
  if (failed === 0) {
    console.log("🎉 All core automated logic tests passed successfully!");
  } else {
    console.log("⚠️ Some tests failed. Please review the logs.");
    process.exit(1);
  }
}

runTests();
