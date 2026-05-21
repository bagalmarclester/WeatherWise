import axios from 'axios';
import { Platform } from 'react-native';

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

// Route through localhost proxy on web (dev only), direct to OSRM on mobile
const OSRM_BASE_URL =
  Platform.OS === 'web'
    ? 'http://localhost:3000/osrm'
    : 'https://router.project-osrm.org';

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

  const url = `${OSRM_BASE_URL}/route/v1/driving/${lon1},${lat1};${lon2},${lat2}?overview=full&geometries=geojson&alternatives=true`;

  try {
    console.log('[OSRM] Fetching:', url);
    const { data } = await axios.get(url, { timeout: 30000 });

    console.log(`[OSRM] Received ${data.routes?.length || 0} routes`);
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
    if (axios.isCancel(error) || error.code === 'ECONNABORTED') {
      console.warn('[OSRM] Route request timed out');
      throw new Error('Routing request timed out. Please check your connection.');
    }
    console.error('[OSRM] Failed to fetch alternative routes:', error.message);
    throw error;
  }
};
