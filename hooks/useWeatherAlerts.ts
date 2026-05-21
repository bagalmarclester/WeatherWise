import { useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { fetchWeatherAtPoint, weatherCodeToLabel } from '../services/weather';
import { SampledWaypoint, sampleWaypoints } from '../utils/spatiotemporal';
import { RouteResponse } from '../services/osrm';
import { useWeather } from '../context/WeatherContext';


export interface WeatherAlert {
  waypointIndex: number;
  lat: number;
  lon: number;
  eta: Date;
  precipitationProbability: number;
  precipitationMm: number;
  weatherCode: number;
  label: string;
  severity: 'low' | 'medium' | 'high';
}

export interface RouteSummary {
  totalWaypoints: number;
  riskyWaypoints: number;
  firstAlertMinutes: number | null;
  overallRisk: 'clear' | 'moderate' | 'high';
}

export interface RouteComparison extends RouteSummary {
  alerts: WeatherAlert[];
  routeIndex: number;
  totalDurationMinutes: number;
  totalDistanceKm: number;
  extraMinutesVsPrimary: number;
  label: string;
}

/**
 * Custom hook for analyzing weather along a sampled route.
 * Consume WeatherContext for global state sharing.
 */
export const useWeatherAlerts = () => {
  const { 
    alerts, setAlerts, 
    summary, setSummary, 
    isAnalyzing, setIsAnalyzing,
    comparisons, setComparisons,
    setSelectedRouteIndex
  } = useWeather();

  /**
   * Helper to determine severity based on precipitation probability.
   */
  const getSeverity = (prob: number): 'low' | 'medium' | 'high' => {
    if (prob < 40) return 'low';
    if (prob <= 60) return 'medium';
    return 'high';
  };

  /**
   * Internal analyzer for a single set of waypoints.
   */
  const analyzeSingleRoute = async (waypoints: SampledWaypoint[]): Promise<{ alerts: WeatherAlert[], summary: RouteSummary }> => {
    const results = await Promise.all(
      waypoints.map((wp, idx) => fetchWithCache(wp, idx))
    );

    const activeAlerts = results.filter(r => r.severity !== 'low' || r.precipitationMm > 0);
    const risky = results.filter(r => r.severity === 'high');
    const now = new Date();
    
    let firstAlertMinutes: number | null = null;
    if (risky.length > 0) {
      const firstHigh = risky[0];
      firstAlertMinutes = Math.round((firstHigh.eta.getTime() - now.getTime()) / (1000 * 60));
    }

    let overallRisk: 'clear' | 'moderate' | 'high' = 'clear';
    if (risky.length > 0) {
      overallRisk = 'high';
    } else if (activeAlerts.some(a => a.severity === 'medium')) {
      overallRisk = 'moderate';
    }

    return {
      alerts: activeAlerts,
      summary: {
        totalWaypoints: waypoints.length,
        riskyWaypoints: risky.length,
        firstAlertMinutes,
        overallRisk,
      }
    };
  };

  /**
   * Compares multiple routes and ranks them by risk.
   */
  const compareRoutes = useCallback(async (routes: RouteResponse[]): Promise<RouteComparison[]> => {
    if (routes.length === 0) return [];
    
    setIsAnalyzing(true);
    const departureTime = new Date();

    try {
      const results = await Promise.all(routes.map(async (route, index) => {
        const waypoints = sampleWaypoints(route.coordinates, route.totalDurationMinutes, departureTime);
        const { alerts, summary } = await analyzeSingleRoute(waypoints);
        
        return {
          ...summary,
          alerts,
          routeIndex: index,
          totalDurationMinutes: route.totalDurationMinutes,
          totalDistanceKm: route.totalDistanceKm,
          extraMinutesVsPrimary: Math.max(0, route.totalDurationMinutes - routes[0].totalDurationMinutes),
          label: index === 0 ? 'Primary' : `Alternative ${index}`,
        };
      }));

      // Sort by risk level: Clear -> Moderate -> High
      const riskScore = { 'clear': 0, 'moderate': 1, 'high': 2 };
      const sortedComparisons = results.sort((a, b) => {
        if (riskScore[a.overallRisk] !== riskScore[b.overallRisk]) {
          return riskScore[a.overallRisk] - riskScore[b.overallRisk];
        }
        return a.totalDurationMinutes - b.totalDurationMinutes;
      });

      // Update Context
      setComparisons(sortedComparisons);
      
      // Automatically set the safest/best route as active
      const best = sortedComparisons[0];
      setAlerts(best.alerts);
      setSummary({
        totalWaypoints: best.totalWaypoints,
        riskyWaypoints: best.riskyWaypoints,
        firstAlertMinutes: best.firstAlertMinutes,
        overallRisk: best.overallRisk,
      });
      setSelectedRouteIndex(best.routeIndex);

      return sortedComparisons;

    } finally {
      setIsAnalyzing(false);
    }
  }, [setIsAnalyzing, setComparisons, setAlerts, setSummary, setSelectedRouteIndex]);

  /**
   * Fetches weather for a waypoint with AsyncStorage caching.
   * Cache key format: weather_cache_{lat}_{lon}_{hour}
   */
  const fetchWithCache = async (wp: SampledWaypoint, index: number): Promise<WeatherAlert> => {
    const lat = wp.lat.toFixed(3);
    const lon = wp.lon.toFixed(3);
    const hour = wp.eta.getHours();
    const day = wp.eta.getDate();
    const cacheKey = `weather_cache_${lat}_${lon}_${day}_${hour}`;

    try {
      const cached = await AsyncStorage.getItem(cacheKey);
      if (cached) {
        const data = JSON.parse(cached);
        return {
          ...data,
          waypointIndex: index,
          eta: wp.eta, // Use the fresh ETA from waypoint
        };
      }
    } catch (e) {
      console.warn('Cache read error:', e);
    }

    // Fetch fresh data
    const weather = await fetchWeatherAtPoint(wp.lat, wp.lon, wp.eta.toISOString());
    const severity = getSeverity(weather.precipitationProbability);
    
    const alert: WeatherAlert = {
      waypointIndex: index,
      lat: wp.lat,
      lon: wp.lon,
      eta: wp.eta,
      precipitationProbability: weather.precipitationProbability,
      precipitationMm: weather.precipitationMm,
      weatherCode: weather.weatherCode,
      label: weatherCodeToLabel(weather.weatherCode),
      severity,
    };

    // Save to cache (async)
    AsyncStorage.setItem(cacheKey, JSON.stringify(alert)).catch(e => console.warn('Cache write error:', e));

    return alert;
  };

  /**
   * Switches the active route analysis in the global context.
   */
  const selectRoute = useCallback((index: number) => {
    const route = comparisons.find(c => c.routeIndex === index);
    if (route) {
      setAlerts(route.alerts);
      setSummary({
        totalWaypoints: route.totalWaypoints,
        riskyWaypoints: route.riskyWaypoints,
        firstAlertMinutes: route.firstAlertMinutes,
        overallRisk: route.overallRisk,
      });
      setSelectedRouteIndex(index);
    }
  }, [comparisons, setAlerts, setSummary, setSelectedRouteIndex]);

  return { compareRoutes, selectRoute, alerts, isAnalyzing, summary };
};
