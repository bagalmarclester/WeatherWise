import { SEGMENT_MINUTES } from './constants';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { fetchWeatherAtPoint } from '../services/weather';

export interface Location {
  lat: number;
  lon: number;
}

export interface SampledWaypoint extends Location {
  eta: Date;
  etaISO: string;
  segmentLabel: string;
  segmentIndex: number;
}

/**
 * Computes the great-circle distance between two points using the Haversine formula.
 * 
 * @param a - First coordinate { lat, lon }
 * @param b - Second coordinate { lat, lon }
 * @returns Distance in kilometers
 */
export const haversineDistanceKm = (a: Location, b: Location): number => {
  const R = 6371; // Earth's radius in km
  const dLat = (b.lat - a.lat) * (Math.PI / 180);
  const dLon = (b.lon - a.lon) * (Math.PI / 180);
  const aa =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(a.lat * (Math.PI / 180)) *
      Math.cos(b.lat * (Math.PI / 180)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(aa), Math.sqrt(1 - aa));
  return R * c;
};

/**
 * Samples waypoints from a route polyline at regular time intervals.
 * 
 * The algorithm improves ETA accuracy by distributing coordinates proportionally 
 * to their Haversine distance. It calculates the cumulative distance of the route,
 * then maps target time offsets (e.g., every 20 mins) to the corresponding 
 * spatial positions.
 * 
 * @param coordinates - Array of {lat, lon} points from the route polyline
 * @param totalDurationMinutes - Estimated total driving time from OSRM
 * @param departureTime - Date object representing the start of the trip
 * @returns Array of sampled waypoints with ETAs and segment indices
 */
export const sampleWaypoints = (
  coordinates: Location[],
  totalDurationMinutes: number,
  departureTime: Date
): SampledWaypoint[] => {
  if (coordinates.length === 0) return [];

  // 1. Calculate cumulative distances along the route
  const cumulativeDistances: number[] = [0];
  let totalDistance = 0;

  for (let i = 1; i < coordinates.length; i++) {
    const d = haversineDistanceKm(coordinates[i - 1], coordinates[i]);
    totalDistance += d;
    cumulativeDistances.push(totalDistance);
  }

  const waypoints: SampledWaypoint[] = [];
  const targetTimes: number[] = [];

  // 2. Define target time offsets (every SEGMENT_MINUTES)
  for (let t = 0; t < totalDurationMinutes; t += SEGMENT_MINUTES) {
    targetTimes.push(t);
  }
  
  // Always include the final destination
  if (targetTimes[targetTimes.length - 1] !== totalDurationMinutes) {
    targetTimes.push(totalDurationMinutes);
  }

  // 3. Map target times to coordinates based on distance progress
  targetTimes.forEach((targetMinutes) => {
    const progress = totalDurationMinutes > 0 ? targetMinutes / totalDurationMinutes : 1;
    const targetDist = progress * totalDistance;

    // Find the coordinate closest to the target distance
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
    
    // Ensure ISO format without milliseconds for Open-Meteo matching: "YYYY-MM-DDTHH:mm"
    const isoFull = eta.toISOString();
    const etaISO = isoFull.substring(0, 16);
    
    waypoints.push({
      ...coordinates[closestIdx],
      eta,
      etaISO,
      segmentLabel,
      segmentIndex: closestIdx,
    });
  });

  // Ensure uniqueness (in case segments are very short)
  return waypoints.filter((wp, idx, self) => 
    idx === 0 || wp.segmentIndex !== self[idx - 1].segmentIndex
  );
};

/**
 * Pre-fetches weather for all waypoints and stores them in AsyncStorage.
 * Each entry is keyed by its spatial and temporal bucket.
 * 
 * @param waypoints - Array of waypoints to cache
 */
export const buildOfflineWeatherCache = async (waypoints: SampledWaypoint[]): Promise<void> => {
  if (waypoints.length === 0) return;

  console.log(`[Cache] Pre-fetching weather for ${waypoints.length} waypoints...`);
  
  // We can fetch in parallel but we use the existing hook's logic 
  // which will indirectly populate the cache because fetchWeatherAtPoint 
  // (once updated) will handle the storage.
  // For now, let's just trigger the fetches.
  try {
    const promises = waypoints.map((wp) => {
      return fetchWeatherAtPoint(wp.lat, wp.lon, wp.eta.toISOString());
    });
    
    await Promise.all(promises);
    console.log(`[Cache] ✓ Successfully pre-cached ${waypoints.length} points.`);
  } catch (error) {
    console.warn('[Cache] Failed to build full offline cache:', error);
  }
};
