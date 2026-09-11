import { RouteResponse, Location } from './osrm';
import { WeatherAlert } from '../hooks/useWeatherAlerts';

export type TrafficCondition = 'free' | 'moderate' | 'heavy' | 'flooded';

export interface TrafficSegment {
  id: string;
  startIndex: number;
  endIndex: number;
  condition: TrafficCondition;
  coordinates: Location[];
  color: string;
  speedKph: number;
}

export type RoadEventType = 'flood' | 'accident' | 'roadwork' | 'congestion';

export interface RoadEvent {
  id: string;
  type: RoadEventType;
  lat: number;
  lon: number;
  title: string;
  description: string;
  severity: 'moderate' | 'high';
  icon: string;
  iconName: string;
  color: string;
  delayMinutes?: number;
}

export const TRAFFIC_COLORS: Record<TrafficCondition, string> = {
  free: '#10B981',      // Smooth traffic (Green)
  moderate: '#F59E0B',  // Moderate congestion (Amber / Orange)
  heavy: '#EF4444',     // Heavy traffic jam (Red)
  flooded: '#06B6D4',   // Flooded / Water Hazard (Cyan / Aqua)
};

/**
 * Calculates Euclidean / approximate distance between coordinates in km
 */
const distKm = (a: Location, b: Location): number => {
  const dLat = (b.lat - a.lat) * 111;
  const dLon = (b.lon - a.lon) * 111 * Math.cos((a.lat * Math.PI) / 180);
  return Math.sqrt(dLat * dLat + dLon * dLon);
};

/**
 * Analyzes route coordinates, step speeds, and weather hazards to segment
 * the route by road traffic & road hazards (congestion, floods, accidents).
 */
export const analyzeRouteRoadConditions = (
  route: RouteResponse,
  weatherAlerts: WeatherAlert[] = []
): {
  segments: TrafficSegment[];
  roadEvents: RoadEvent[];
  trafficStats: { freePct: number; moderatePct: number; heavyPct: number; floodedPct: number };
} => {
  const coords = route.coordinates || [];
  if (coords.length === 0) {
    return {
      segments: [],
      roadEvents: [],
      trafficStats: { freePct: 100, moderatePct: 0, heavyPct: 0, floodedPct: 0 },
    };
  }

  // If travel mode is flight, treat entire path as free-flowing clear airway
  if (route.travelMode === 'flight') {
    return {
      segments: [
        {
          id: 'flight-airway',
          startIndex: 0,
          endIndex: coords.length - 1,
          condition: 'free',
          coordinates: coords,
          color: '#38BDF8',
          speedKph: 850,
        },
      ],
      roadEvents: [],
      trafficStats: { freePct: 100, moderatePct: 0, heavyPct: 0, floodedPct: 0 },
    };
  }

  const steps = route.steps || [];
  const roadEvents: RoadEvent[] = [];

  // Identify flood-prone segments from high precipitation weather alerts
  const floodPoints: Location[] = [];
  weatherAlerts.forEach((alert, idx) => {
    if (
      alert.severity === 'high' ||
      alert.precipitationProbability >= 65 ||
      alert.precipitationMm >= 4 ||
      [65, 82, 95, 96, 99].includes(alert.weatherCode)
    ) {
      floodPoints.push({ lat: alert.lat, lon: alert.lon });
      roadEvents.push({
        id: `flood-${idx}`,
        type: 'flood',
        lat: alert.lat,
        lon: alert.lon,
        title: 'Flooded / Waterlogged Road',
        description: `Heavy rain accumulation (${alert.precipitationProbability}% rain). Reduce speed & avoid deep water.`,
        severity: 'high',
        icon: '🌊',
        iconName: 'water-alert',
        color: TRAFFIC_COLORS.flooded,
      });
    }
  });

  // Divide route into chunks for realistic road traffic simulation & OSRM speed mapping
  const CHUNK_SIZE = Math.max(3, Math.floor(coords.length / 10));
  const rawSegments: { startIndex: number; endIndex: number; condition: TrafficCondition; speedKph: number }[] = [];

  for (let i = 0; i < coords.length; i += CHUNK_SIZE) {
    const start = i;
    const end = Math.min(coords.length - 1, i + CHUNK_SIZE);
    const midPoint = coords[Math.floor((start + end) / 2)];

    // 1. Check if near a flood zone (< 3.5 km)
    const isNearFlood = floodPoints.some((fp) => distKm(fp, midPoint) < 3.5);

    if (isNearFlood) {
      rawSegments.push({ startIndex: start, endIndex: end, condition: 'flooded', speedKph: 15 });
      continue;
    }

    // 2. Check OSRM step speeds in this range if available
    let avgSpeed = 48; // default moderate-fast speed
    if (steps.length > 0) {
      const stepIdx = Math.min(steps.length - 1, Math.floor((i / coords.length) * steps.length));
      const step = steps[stepIdx];
      if (step.distanceMeters > 0 && step.durationSeconds > 0) {
        avgSpeed = (step.distanceMeters / step.durationSeconds) * 3.6;
      }
    }

    // Realistic variation based on position (city centers near start/end often slower)
    const progress = i / coords.length;
    const isUrbanTerminal = progress < 0.15 || progress > 0.85;
    if (isUrbanTerminal) {
      avgSpeed = Math.min(avgSpeed, 30);
    }

    if (avgSpeed < 20) {
      rawSegments.push({ startIndex: start, endIndex: end, condition: 'heavy', speedKph: avgSpeed });
    } else if (avgSpeed < 42) {
      rawSegments.push({ startIndex: start, endIndex: end, condition: 'moderate', speedKph: avgSpeed });
    } else {
      rawSegments.push({ startIndex: start, endIndex: end, condition: 'free', speedKph: avgSpeed });
    }
  }

  // Merge consecutive segments with the same condition
  const mergedSegments: TrafficSegment[] = [];
  let currentGroup = rawSegments[0];

  for (let j = 1; j < rawSegments.length; j++) {
    const next = rawSegments[j];
    if (next.condition === currentGroup.condition) {
      currentGroup = {
        startIndex: currentGroup.startIndex,
        endIndex: next.endIndex,
        condition: currentGroup.condition,
        speedKph: (currentGroup.speedKph + next.speedKph) / 2,
      };
    } else {
      mergedSegments.push({
        id: `seg-${mergedSegments.length}`,
        startIndex: currentGroup.startIndex,
        endIndex: currentGroup.endIndex,
        condition: currentGroup.condition,
        coordinates: coords.slice(currentGroup.startIndex, currentGroup.endIndex + 1),
        color: TRAFFIC_COLORS[currentGroup.condition],
        speedKph: currentGroup.speedKph,
      });
      currentGroup = next;
    }
  }

  if (currentGroup) {
    mergedSegments.push({
      id: `seg-${mergedSegments.length}`,
      startIndex: currentGroup.startIndex,
      endIndex: currentGroup.endIndex,
      condition: currentGroup.condition,
      coordinates: coords.slice(currentGroup.startIndex, currentGroup.endIndex + 1),
      color: TRAFFIC_COLORS[currentGroup.condition],
      speedKph: currentGroup.speedKph,
    });
  }

  // Add incident events if heavy congestion is detected
  const heavySegs = mergedSegments.filter((s) => s.condition === 'heavy');
  if (heavySegs.length > 0) {
    const midCoord = heavySegs[0].coordinates[Math.floor(heavySegs[0].coordinates.length / 2)];
    if (midCoord) {
      roadEvents.push({
        id: 'incident-congestion',
        type: 'congestion',
        lat: midCoord.lat,
        lon: midCoord.lon,
        title: 'Heavy Traffic Congestion',
        description: 'Stop-and-go congestion. Expect 5–12 min travel delay.',
        severity: 'high',
        icon: '🛑',
        iconName: 'traffic-light',
        color: TRAFFIC_COLORS.heavy,
        delayMinutes: 8,
      });
    }
  }

  // Calculate percentages
  const totalPoints = coords.length || 1;
  let freeCount = 0;
  let moderateCount = 0;
  let heavyCount = 0;
  let floodedCount = 0;

  mergedSegments.forEach((s) => {
    const count = s.endIndex - s.startIndex + 1;
    if (s.condition === 'free') freeCount += count;
    else if (s.condition === 'moderate') moderateCount += count;
    else if (s.condition === 'heavy') heavyCount += count;
    else if (s.condition === 'flooded') floodedCount += count;
  });

  return {
    segments: mergedSegments,
    roadEvents,
    trafficStats: {
      freePct: Math.round((freeCount / totalPoints) * 100),
      moderatePct: Math.round((moderateCount / totalPoints) * 100),
      heavyPct: Math.round((heavyCount / totalPoints) * 100),
      floodedPct: Math.round((floodedCount / totalPoints) * 100),
    },
  };
};
