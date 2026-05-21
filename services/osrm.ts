import Constants from 'expo-constants';
import { fetchWithTimeout } from '../utils/fetch';

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
}

const PROXY_PORT = 3001;

/**
 * Gets the proxy server URL by extracting the dev machine's IP
 * from Expo's hostUri (which the phone already uses to connect to Metro).
 */
const getProxyBaseUrl = (): string => {
  const hostUri = Constants.expoConfig?.hostUri ?? Constants.manifest?.debuggerHost;
  if (hostUri) {
    const host = hostUri.split(':')[0]; // Extract IP, drop Metro port
    return `http://${host}:${PROXY_PORT}`;
  }
  // Fallback for development — unlikely to be needed
  return `http://localhost:${PROXY_PORT}`;
};

/**
 * Fetches alternative driving routes via the local proxy server.
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

  const proxyBase = getProxyBaseUrl();
  const url = `${proxyBase}/route?origin=${lon1},${lat1}&destination=${lon2},${lat2}&alternatives=true`;

  try {
    console.log("OSRM Fetching URL:", url);
    // 30 second timeout for routing
    const response = await fetchWithTimeout(url, 30000);
    
    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Proxy HTTP Error ${response.status}: ${errorBody}`);
    }
    
    const data = await response.json();
    console.log(`[OSRM] Received ${data.routes?.length || 0} routes from proxy`);
    if (data.code !== 'Ok' || !data.routes) throw new Error('No routes found');

    return data.routes.map((route: any) => ({
      coordinates: route.geometry.coordinates.map(([lon, lat]: [number, number]) => ({ lat, lon })),
      totalDistanceKm: route.distance / 1000,
      totalDurationMinutes: route.duration / 60,
      legs: route.legs.map((leg: any) => ({
        distanceKm: leg.distance / 1000,
        durationMinutes: leg.duration / 60,
      })),
    }));
  } catch (error: any) {
    if (error.name === 'AbortError') {
      console.warn('[OSRM] Route request timed out');
      throw new Error('Routing request timed out. Please check your connection.');
    }
    console.error('Failed to fetch alternative routes:', error);
    throw error;
  }
};
