import axios from 'axios';
import { getProxyBaseUrl } from '../utils/proxyUrl';

export interface Location {
  lat: number;
  lon: number;
}

export interface RouteLeg {
  distanceKm: number;
  durationMinutes: number;
}

export interface RouteResponse {
  coordinates: Location[];
  totalDistanceKm: number;
  totalDurationMinutes: number;
  legs: RouteLeg[];
  travelMode?: 'driving' | 'flight';
}

const OSRM_BASE = `${getProxyBaseUrl()}/osrm`;
const EARTH_RADIUS_KM = 6371;
const FLIGHT_SPEED_KPH = 850;
const FLIGHT_PATH_POINTS = 36;

const toRadians = (degrees: number): number => degrees * (Math.PI / 180);
const toDegrees = (radians: number): number => radians * (180 / Math.PI);

const haversineDistanceKm = (a: Location, b: Location): number => {
  const dLat = toRadians(b.lat - a.lat);
  const dLon = toRadians(b.lon - a.lon);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;

  return 2 * EARTH_RADIUS_KM * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
};

const interpolateGreatCircle = (origin: Location, destination: Location, fraction: number): Location => {
  const lat1 = toRadians(origin.lat);
  const lon1 = toRadians(origin.lon);
  const lat2 = toRadians(destination.lat);
  const lon2 = toRadians(destination.lon);

  const distance = 2 * Math.asin(Math.sqrt(
    Math.sin((lat2 - lat1) / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin((lon2 - lon1) / 2) ** 2
  ));

  if (distance === 0) return origin;

  const a = Math.sin((1 - fraction) * distance) / Math.sin(distance);
  const b = Math.sin(fraction * distance) / Math.sin(distance);

  const x = a * Math.cos(lat1) * Math.cos(lon1) + b * Math.cos(lat2) * Math.cos(lon2);
  const y = a * Math.cos(lat1) * Math.sin(lon1) + b * Math.cos(lat2) * Math.sin(lon2);
  const z = a * Math.sin(lat1) + b * Math.sin(lat2);

  return {
    lat: toDegrees(Math.atan2(z, Math.sqrt(x ** 2 + y ** 2))),
    lon: toDegrees(Math.atan2(y, x)),
  };
};

const createFlightRoute = (origin: Location, destination: Location): RouteResponse => {
  const totalDistanceKm = haversineDistanceKm(origin, destination);
  const totalDurationMinutes = (totalDistanceKm / FLIGHT_SPEED_KPH) * 60;
  const coordinates = Array.from({ length: FLIGHT_PATH_POINTS }, (_, index) => {
    const fraction = index / (FLIGHT_PATH_POINTS - 1);
    return interpolateGreatCircle(origin, destination, fraction);
  });

  return {
    coordinates,
    totalDistanceKm,
    totalDurationMinutes,
    legs: [{ distanceKm: totalDistanceKm, durationMinutes: totalDurationMinutes }],
    travelMode: 'flight',
  };
};

const canFallbackToFlight = (error: any): boolean => {
  const status = error?.response?.status;
  const code = error?.response?.data?.code;
  return status === 400 || code === 'NoRoute' || code === 'TooBig';
};

/**
 * Fetches alternative driving routes directly from the OSRM public API.
 *
 * @param origin - Starting coordinates { lat, lon }
 * @param destination - Ending coordinates { lat, lon }
 * @returns Array of parsed alternative route data
 */
export const fetchAlternativeRoutes = async (
  origin: Location,
  destination: Location
): Promise<RouteResponse[]> => {
  const lon1 = Number(origin.lon);
  const lat1 = Number(origin.lat);
  const lon2 = Number(destination.lon);
  const lat2 = Number(destination.lat);

  const url = `${OSRM_BASE}/route/v1/driving/${lon1},${lat1};${lon2},${lat2}?overview=full&geometries=geojson&alternatives=true`;

  try {
    console.log('[OSRM] Fetching:', url);
    const { data } = await axios.get(url, { timeout: 30000 });

    console.log(`[OSRM] Received ${data.routes?.length || 0} routes`);
    if (data.code !== 'Ok' || !data.routes) throw new Error('No routes found');

    return data.routes.map((route: any) => ({
      coordinates: route.geometry.coordinates.map(([lon, lat]: [number, number]) => ({ lat, lon })),
      totalDistanceKm: route.distance / 1000,
      totalDurationMinutes: route.duration / 60,
      travelMode: 'driving',
      legs: route.legs.map((leg: any) => ({
        distanceKm: leg.distance / 1000,
        durationMinutes: leg.duration / 60,
      })),
    }));
  } catch (error: any) {
    if (axios.isCancel(error) || error.code === 'ECONNABORTED') {
      console.warn('[OSRM] Route request timed out');
      throw new Error('Routing request timed out. Please check your connection.');
    }
    console.warn('[OSRM] Failed to fetch alternative routes:', error.message);
    if (canFallbackToFlight(error)) {
      console.warn('[OSRM] Falling back to estimated flight route.');
      return [createFlightRoute(origin, destination)];
    }
    throw error;
  }
};

/**
 * Fetches the primary driving route directly from the OSRM public API.
 *
 * @param origin - Starting coordinates { lat, lon }
 * @param destination - Ending coordinates { lat, lon }
 * @returns Primary route response
 */
export const fetchRoute = async (
  origin: Location,
  destination: Location
): Promise<RouteResponse> => {
  const routes = await fetchAlternativeRoutes(origin, destination);
  if (!routes || routes.length === 0) {
    throw new Error('No routes found');
  }
  return routes[0];
};
