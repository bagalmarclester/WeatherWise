import AsyncStorage from '@react-native-async-storage/async-storage';
import { fetchWeatherAtPoint, weatherCodeToLabel } from '../services/weather';
import { SampledWaypoint, sampleWaypoints } from '../utils/spatiotemporal';
import { RouteResponse, RouteStep, Location } from '../services/osrm';
import { useWeatherStore } from '../store/useWeatherStore';
import { format } from 'date-fns';


export interface WeatherAlert {
  waypointIndex: number;
  lat: number;
  lon: number;
  eta: Date;
  etaFormatted: string;
  minutesFromNow: number;
  precipitationProbability: number;
  precipitationMm: number;
  weatherCode: number;
  windspeedKph: number;
  temperatureC: number;
  severity: 'clear' | 'moderate' | 'high';
  label: string;
  isHazardous: boolean;
  segmentLabel: string;
  segmentIndex: number;
}

export interface RouteSummary {
  totalWaypoints: number;
  clearWaypoints: number;
  moderateWaypoints: number;
  hazardousWaypoints: number;
  firstHazardMinutes: number | null;
  firstHazardLabel: string | null;
  overallRisk: 'clear' | 'moderate' | 'high';
  analysisTimeMs: number;
}

export interface RouteComparison extends RouteSummary {
  alerts: WeatherAlert[];
  routeIndex: number;
  totalDurationMinutes: number;
  totalDistanceKm: number;
  extraMinutesVsPrimary: number;
  travelMode?: 'driving' | 'flight';
  label: string;
  steps?: RouteStep[];
  coordinates?: Location[];
}

/**
 * Custom hook for analyzing weather along a sampled route.
 * Uses Zustand store for global state sharing.
 */
export const useWeatherAlerts = () => {
  const alerts = useWeatherStore((s) => s.alerts);
  const summary = useWeatherStore((s) => s.summary);
  const isAnalyzing = useWeatherStore((s) => s.isAnalyzing);
  const comparisons = useWeatherStore((s) => s.comparisons);

  const setAlerts = useWeatherStore((s) => s.setAlerts);
  const setSummary = useWeatherStore((s) => s.setSummary);
  const setIsAnalyzing = useWeatherStore((s) => s.setIsAnalyzing);
  const setComparisons = useWeatherStore((s) => s.setComparisons);
  const setSelectedRouteIndex = useWeatherStore((s) => s.setSelectedRouteIndex);

  /**
   * Internal analyzer for a single set of waypoints.
   */
  const analyzeSingleRoute = async (waypoints: SampledWaypoint[]): Promise<{ alerts: WeatherAlert[], summary: RouteSummary }> => {
    const startTime = Date.now();
    
    // Fetch all waypoints in parallel!
    const results = await Promise.all(
      waypoints.map((wp, idx) => fetchWithCache(wp, idx))
    );

    // Filter out nulls (failed to fetch/match)
    const validAlerts = results.filter((r): r is WeatherAlert => r !== null);

    const clearCount = validAlerts.filter(r => r.severity === 'clear').length;
    const moderateCount = validAlerts.filter(r => r.severity === 'moderate').length;
    const hazardous = validAlerts.filter(r => r.severity === 'high');

    let firstHazardMinutes: number | null = null;
    let firstHazardLabel: string | null = null;
    
    if (hazardous.length > 0) {
      const firstHigh = hazardous[0];
      firstHazardMinutes = firstHigh.minutesFromNow;
      firstHazardLabel = firstHigh.label;
    }

    let overallRisk: 'clear' | 'moderate' | 'high' = 'clear';
    if (hazardous.length > 0) {
      overallRisk = 'high';
    } else if (moderateCount > 0) {
      overallRisk = 'moderate';
    }
    
    const analysisTimeMs = Date.now() - startTime;
    console.log(`WeatherWise: Analyzed ${waypoints.length} waypoints in ${analysisTimeMs}ms — Risk: ${overallRisk}, First hazard: ${firstHazardMinutes} min`);

    return {
      alerts: validAlerts,
      summary: {
        totalWaypoints: waypoints.length,
        clearWaypoints: clearCount,
        moderateWaypoints: moderateCount,
        hazardousWaypoints: hazardous.length,
        firstHazardMinutes,
        firstHazardLabel,
        overallRisk,
        analysisTimeMs,
      }
    };
  };

  /**
   * Compares multiple routes and ranks them by risk.
   */
  const compareRoutes = async (routes: RouteResponse[]): Promise<RouteComparison[]> => {
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
          travelMode: route.travelMode,
          label: route.travelMode === 'flight' ? 'Flight route' : index === 0 ? 'Primary' : `Alternative ${index}`,
          steps: route.steps,
          coordinates: route.coordinates,
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

      // Update store
      setComparisons(sortedComparisons);
      
      // Automatically set the safest/best route as active
      const best = sortedComparisons[0];
      setAlerts(best.alerts);
      setSummary({
        totalWaypoints: best.totalWaypoints,
        clearWaypoints: best.clearWaypoints,
        moderateWaypoints: best.moderateWaypoints,
        hazardousWaypoints: best.hazardousWaypoints,
        firstHazardMinutes: best.firstHazardMinutes,
        firstHazardLabel: best.firstHazardLabel,
        overallRisk: best.overallRisk,
        analysisTimeMs: best.analysisTimeMs,
      });
      setSelectedRouteIndex(best.routeIndex);

      return sortedComparisons;

    } finally {
      setIsAnalyzing(false);
    }
  };

  /**
   * Fetches weather for a waypoint with AsyncStorage caching.
   * Cache key format: weather_cache_{lat}_{lon}_{hour}
   * Uses 60 minute TTL.
   */
  const fetchWithCache = async (wp: SampledWaypoint, index: number): Promise<WeatherAlert | null> => {
    const lat = wp.lat.toFixed(3);
    const lon = wp.lon.toFixed(3);
    const hour = wp.etaISO.substring(0, 13); // e.g. 2026-04-15T14
    const cacheKey = `wx_${lat}_${lon}_${hour}`;

    try {
      const cachedStr = await AsyncStorage.getItem(cacheKey);
      if (cachedStr) {
        const cachedObj = JSON.parse(cachedStr);
        const ageMinutes = (Date.now() - cachedObj.timestamp) / 60000;
        if (ageMinutes < 60) {
          return buildWeatherAlert(wp, index, cachedObj.data);
        }
      }
    } catch (e) {
      console.warn('Cache read error:', e);
    }

    // Fetch fresh data
    try {
      const weather = await fetchWeatherAtPoint(wp.lat, wp.lon, wp.etaISO);
      if (!weather) return null;
      
      // Save to cache (async)
      const cachePayload = { timestamp: Date.now(), data: weather };
      AsyncStorage.setItem(cacheKey, JSON.stringify(cachePayload)).catch(e => console.warn('Cache write error:', e));

      return buildWeatherAlert(wp, index, weather);
    } catch (err: any) {
      console.warn(`[useWeatherAlerts] Error fetching weather for point ${index}:`, err?.message);
      return null;
    }
  };

  const buildWeatherAlert = (wp: SampledWaypoint, index: number, weather: any): WeatherAlert => {
    return {
      waypointIndex: index,
      lat: wp.lat,
      lon: wp.lon,
      eta: wp.eta,
      etaFormatted: format(wp.eta, 'h:mm a'),
      minutesFromNow: Math.max(0, Math.round((wp.eta.getTime() - Date.now()) / 60000)),
      precipitationProbability: weather.precipitationProbability,
      precipitationMm: weather.precipitationMm,
      weatherCode: weather.weatherCode,
      windspeedKph: weather.windspeedKph,
      temperatureC: weather.temperatureC,
      severity: weather.severity,
      label: weather.label,
      isHazardous: weather.isHazardous,
      segmentLabel: wp.segmentLabel,
      segmentIndex: wp.segmentIndex,
    };
  };

  /**
   * Switches the active route analysis in the store.
   */
  const selectRoute = (index: number) => {
    const route = comparisons.find(c => c.routeIndex === index);
    if (route) {
      setAlerts(route.alerts);
      setSummary({
        totalWaypoints: route.totalWaypoints,
        clearWaypoints: route.clearWaypoints,
        moderateWaypoints: route.moderateWaypoints,
        hazardousWaypoints: route.hazardousWaypoints,
        firstHazardMinutes: route.firstHazardMinutes,
        firstHazardLabel: route.firstHazardLabel,
        overallRisk: route.overallRisk,
        analysisTimeMs: route.analysisTimeMs,
      });
      setSelectedRouteIndex(index);
    }
  };

  return { compareRoutes, selectRoute, alerts, isAnalyzing, summary };
};
