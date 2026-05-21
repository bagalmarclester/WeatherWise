import { useState, useCallback } from 'react';
import { fetchRoute, Location, RouteResponse } from '../services/osrm';

export const useRoute = () => {
  const [route, setRoute] = useState<RouteResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const getRoute = useCallback(async (origin: Location, destination: Location) => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchRoute(origin, destination);
      setRoute(data);
      return data;
    } catch (err: any) {
      const msg = err.message || 'Failed to fetch route';
      setError(msg);
      throw new Error(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  const clearRoute = useCallback(() => {
    setRoute(null);
    setError(null);
  }, []);

  return { route, loading, error, getRoute, clearRoute };
};
