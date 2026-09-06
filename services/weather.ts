import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { parseISO, differenceInMinutes } from 'date-fns';
import { RAIN_THRESHOLD } from '../utils/constants';
import { getProxyBaseUrl } from '../utils/proxyUrl';

export interface WeatherPointResponse {
  precipitationProbability: number;
  precipitationMm: number;
  weatherCode: number;
  windspeedKph: number;
  temperatureC: number;
  matchedTime: string;
  isHazardous: boolean;
  severity: 'clear' | 'moderate' | 'high';
  label: string;
}

const WEATHER_BASE = `${getProxyBaseUrl()}/weather`;

/**
 * Converts Open-Meteo WMO weather codes to human-readable labels.
 */
export const weatherCodeToLabel = (code: number): string => {
  if (code === 0) return 'Clear Sky';
  if ([1, 2, 3].includes(code)) return 'Partly Cloudy';
  if ([45, 48].includes(code)) return 'Foggy';
  if ([51, 53, 55].includes(code)) return 'Drizzle';
  if ([61, 63, 65].includes(code)) return 'Rain';
  if ([71, 73, 75].includes(code)) return 'Snow';
  if ([80, 81, 82].includes(code)) return 'Rain Showers';
  if (code === 95) return 'Thunderstorm';
  if ([96, 99].includes(code)) return 'Thunderstorm with Hail';
  return 'Cloudy';
};

export const fetchWeatherAtPoint = async (
  lat: number,
  lon: number,
  etaISO: string
): Promise<WeatherPointResponse | null> => {
  const arrivalTime = parseISO(etaISO);
  const hour = arrivalTime.getHours();
  const day = arrivalTime.getDate();
  const cacheKey = `weather_cache_${lat.toFixed(3)}_${lon.toFixed(3)}_${day}_${hour}`;

  // 1. Check Cache
  try {
    const cached = await AsyncStorage.getItem(cacheKey);
    if (cached) {
      console.log(`[Weather] Using cached data for ${cacheKey}`);
      return JSON.parse(cached);
    }
  } catch (e) {
    console.warn('Cache read error:', e);
  }

  // 2. Fetch directly from proxy
  const url = `${WEATHER_BASE}?latitude=${lat}&longitude=${lon}&hourly=precipitation_probability,precipitation,weathercode,windspeed_10m,temperature_2m&timezone=auto&forecast_days=2`;

  try {
    let data: any;
    try {
      const res = await axios.get(url, { timeout: 10000 });
      data = res.data;
    } catch (proxyErr) {
      console.warn(`[Weather] Proxy failed, fetching direct from Open-Meteo for (${lat}, ${lon})`);
      const directUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=precipitation_probability,precipitation,weathercode,windspeed_10m,temperature_2m&timezone=auto&forecast_days=2`;
      try {
        const fetchRes = await fetch(directUrl, {
          headers: { Accept: 'application/json' },
        });
        if (!fetchRes.ok) throw new Error(`HTTP ${fetchRes.status}`);
        data = await fetchRes.json();
      } catch (directFetchErr) {
        const res = await axios.get(directUrl, { timeout: 10000 });
        data = res.data;
      }
    }

    const hourly = data?.hourly;
    if (!hourly || !Array.isArray(hourly.time)) {
      throw new Error('No hourly data found in response');
    }

    let closestIndex = -1;
    let minDiff = Infinity;

    for (let i = 0; i < hourly.time.length; i++) {
      const forecastTime = parseISO(hourly.time[i]);
      const diff = Math.abs(differenceInMinutes(arrivalTime, forecastTime));
      if (diff < minDiff) {
        minDiff = diff;
        closestIndex = i;
      }
    }

    if (closestIndex === -1 || minDiff > 30) {
      console.warn(`[Weather] No suitable forecast found within 30 min of ${etaISO} at ${lat}, ${lon}`);
      return null;
    }

    const prob = hourly.precipitation_probability?.[closestIndex] ?? 0;
    const precip = hourly.precipitation?.[closestIndex] ?? 0;
    const code = hourly.weathercode?.[closestIndex] ?? 0;
    const wind = hourly.windspeed_10m?.[closestIndex] ?? 10;
    const temp = hourly.temperature_2m?.[closestIndex] ?? 28;

    const isHazardous = prob > 60;
    
    let severity: 'clear' | 'moderate' | 'high' = 'clear';
    if (isHazardous) severity = 'high';
    else if (prob >= 20) severity = 'moderate';

    const result: WeatherPointResponse = {
      precipitationProbability: prob,
      precipitationMm: precip,
      weatherCode: code,
      windspeedKph: wind,
      temperatureC: temp,
      matchedTime: hourly.time[closestIndex],
      isHazardous,
      severity,
      label: weatherCodeToLabel(code),
    };

    // 3. Save to cache
    AsyncStorage.setItem(cacheKey, JSON.stringify(result)).catch(e => console.warn('Cache write error:', e));

    return result;

  } catch (error: any) {
    console.warn(`[Weather] Unable to fetch live weather for (${lat}, ${lon}): ${error.message}. Using safe offline default.`);
    // Return a safe neutral fallback so route comparison & navigation can still proceed
    return {
      precipitationProbability: 0,
      precipitationMm: 0,
      weatherCode: 0,
      windspeedKph: 12,
      temperatureC: 28,
      matchedTime: etaISO,
      isHazardous: false,
      severity: 'clear',
      label: 'Clear Sky (Offline)',
    };
  }
};
