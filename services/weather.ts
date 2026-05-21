import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { parseISO, differenceInMinutes } from 'date-fns';
import { Platform } from 'react-native';
import { RAIN_THRESHOLD } from '../utils/constants';

export interface WeatherPointResponse {
  precipitationProbability: number;
  precipitationMm: number;
  weatherCode: number;
  matchedTime: string;
  isRainy: boolean;
}

// Route through localhost proxy on web (dev only), direct to Open-Meteo on mobile
const OPEN_METEO_BASE_URL =
  Platform.OS === 'web'
    ? 'http://localhost:3000/weather'
    : 'https://api.open-meteo.com/v1/forecast';

/**
 * Converts Open-Meteo WMO weather codes to human-readable labels.
 */
export const weatherCodeToLabel = (code: number): string => {
  if (code === 0) return 'Clear sky';
  if (code >= 1 && code <= 3) return 'Partly cloudy';
  if (code === 45 || code === 48) return 'Fog';
  if (code >= 51 && code <= 55) return 'Drizzle';
  if (code >= 61 && code <= 65) return 'Rain';
  if (code >= 66 && code <= 67) return 'Freezing Rain';
  if (code >= 71 && code <= 75) return 'Snow fall';
  if (code === 77) return 'Snow grains';
  if (code >= 80 && code <= 82) return 'Rain showers';
  if (code >= 85 && code <= 86) return 'Snow showers';
  if (code >= 95) return 'Thunderstorm';
  return 'Unknown';
};

/**
 * Fetches weather forecast for a specific coordinate directly from Open-Meteo.
 * Includes AsyncStorage caching with a 1-hour temporal bucket.
 */
export const fetchWeatherAtPoint = async (
  lat: number,
  lon: number,
  isoDatetime: string
): Promise<WeatherPointResponse> => {
  const arrivalTime = parseISO(isoDatetime);
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

  // 2. Fetch directly from Open-Meteo
  const url = `${OPEN_METEO_BASE_URL}?latitude=${lat}&longitude=${lon}&hourly=precipitation_probability,precipitation,weathercode&timezone=auto&forecast_days=2`;

  try {
    const { data } = await axios.get(url, { timeout: 15000 });

    const hourly = data.hourly;
    if (!hourly) throw new Error('No hourly data found in response');

    let closestIndex = 0;
    let minDiff = Infinity;

    for (let i = 0; i < hourly.time.length; i++) {
      const forecastTime = parseISO(hourly.time[i]);
      const diff = Math.abs(differenceInMinutes(arrivalTime, forecastTime));
      if (diff < minDiff) {
        minDiff = diff;
        closestIndex = i;
      }
    }

    const prob = hourly.precipitation_probability[closestIndex];
    const precip = hourly.precipitation[closestIndex];
    const code = hourly.weathercode[closestIndex];

    const result: WeatherPointResponse = {
      precipitationProbability: prob,
      precipitationMm: precip,
      weatherCode: code,
      matchedTime: hourly.time[closestIndex],
      isRainy: prob > (RAIN_THRESHOLD * 100),
    };

    // 3. Save to cache
    AsyncStorage.setItem(cacheKey, JSON.stringify(result)).catch(e => console.warn('Cache write error:', e));

    return result;

  } catch (error: any) {
    if (axios.isCancel(error) || error.code === 'ECONNABORTED') {
      console.warn(`[Weather] Request timed out for point (${lat}, ${lon})`);
      throw new Error('Weather request timed out. Please check your connection.');
    }
    console.error(`[Weather] Failed to fetch weather for ${lat},${lon}:`, error.message);
    throw error;
  }
};
