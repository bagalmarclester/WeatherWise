export interface NavLocation {
  lat: number;
  lon: number;
}

export interface NavWeatherAlert {
  lat: number;
  lon: number;
  severity: 'clear' | 'moderate' | 'high';
  label: string;
  precipitationProbability: number;
}

const EARTH_RADIUS_METERS = 6371000;

const toRadians = (degrees: number): number => degrees * (Math.PI / 180);
const toDegrees = (radians: number): number => radians * (180 / Math.PI);

/**
 * Calculates straight-line distance in meters between two coordinates.
 */
export const haversineDistanceMeters = (a: NavLocation, b: NavLocation): number => {
  const dLat = toRadians(b.lat - a.lat);
  const dLon = toRadians(b.lon - a.lon);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;

  return 2 * EARTH_RADIUS_METERS * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
};

/**
 * Calculates compass heading in degrees (0° - 360°) from point A to point B.
 */
export const calculateBearing = (from: NavLocation, to: NavLocation): number => {
  const lat1 = toRadians(from.lat);
  const lat2 = toRadians(to.lat);
  const dLon = toRadians(to.lon - from.lon);

  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);

  const bearing = (toDegrees(Math.atan2(y, x)) + 360) % 360;
  return Math.round(bearing);
};

/**
 * Formats distance in meters into readable string ("350 m" or "4.2 km").
 */
export const formatDistance = (meters: number): string => {
  if (meters < 1000) {
    return `${Math.max(10, Math.round(meters / 10) * 10)} m`;
  }
  return `${(meters / 1000).toFixed(1)} km`;
};

/**
 * Formats duration in minutes into a friendly string ("45 min" or "1 hr 15 min").
 */
export const formatDuration = (minutes: number): string => {
  const totalMins = Math.max(1, Math.round(minutes));
  if (totalMins < 60) {
    return `${totalMins} min`;
  }
  const hours = Math.floor(totalMins / 60);
  const mins = totalMins % 60;
  return mins > 0 ? `${hours} hr ${mins} min` : `${hours} hr`;
};

/**
 * Returns a suitable MaterialCommunityIcons icon name for an OSRM maneuver.
 */
export const getManeuverIcon = (type?: string, modifier?: string): string => {
  const mod = (modifier || '').toLowerCase();
  const t = (type || '').toLowerCase();

  if (t === 'arrive') return 'flag-checkered';
  if (t === 'depart') return 'navigation';
  if (t === 'roundabout' || t === 'rotary') return 'rotate-right';
  if (mod.includes('uturn')) return 'u-turn-left';

  if (mod.includes('sharp left')) return 'arrow-bottom-left';
  if (mod.includes('sharp right')) return 'arrow-bottom-right';
  if (mod.includes('slight left')) return 'arrow-top-left';
  if (mod.includes('slight right')) return 'arrow-top-right';
  if (mod.includes('left')) return 'arrow-left-top';
  if (mod.includes('right')) return 'arrow-right-top';

  return 'arrow-up-bold';
};

/**
 * Formats raw OSRM maneuver type and modifier into natural driver turn instructions.
 */
export function formatManeuverInstruction(
  type: string,
  modifier: string | undefined,
  streetName: string
): string {
  const road = streetName && streetName.trim().length > 0 ? streetName.trim() : 'the road';
  const cleanMod = modifier ? modifier.toLowerCase().replace(/_/g, ' ') : '';

  switch (type) {
    case 'depart':
      return `Head out on ${road}`;
    case 'arrive':
      return 'You have arrived at your destination';
    case 'turn':
      return cleanMod ? `Turn ${cleanMod} onto ${road}` : `Turn onto ${road}`;
    case 'new name':
    case 'continue':
      return `Continue on ${road}`;
    case 'merge':
      return cleanMod ? `Merge ${cleanMod} onto ${road}` : `Merge onto ${road}`;
    case 'fork':
      return cleanMod ? `Take the ${cleanMod} fork onto ${road}` : `Take the fork onto ${road}`;
    case 'roundabout':
    case 'rotary':
      return `Enter roundabout and take exit onto ${road}`;
    case 'on ramp':
      return cleanMod ? `Take the ramp ${cleanMod} onto ${road}` : `Take the ramp onto ${road}`;
    case 'off ramp':
      return cleanMod ? `Take the exit ${cleanMod} onto ${road}` : `Take the exit onto ${road}`;
    case 'end of road':
      return cleanMod ? `Turn ${cleanMod} at the end of the road onto ${road}` : `Turn onto ${road}`;
    case 'uturn':
      return `Make a U-turn onto ${road}`;
    default:
      if (cleanMod) {
        return `${cleanMod.charAt(0).toUpperCase() + cleanMod.slice(1)} onto ${road}`;
      }
      return `Continue onto ${road}`;
  }
}

/**
 * Finds the closest upcoming hazardous weather waypoint within a specified distance ahead.
 */
export const findUpcomingHazard = <T extends NavWeatherAlert>(
  currentLocation: NavLocation,
  alerts: T[],
  maxDistanceKm = 25
): { alert: T; distanceKm: number } | null => {
  if (!alerts || alerts.length === 0) return null;

  let closest: { alert: T; distanceKm: number } | null = null;

  for (const alert of alerts) {
    if (alert.severity === 'clear') continue;

    const distanceMeters = haversineDistanceMeters(currentLocation, { lat: alert.lat, lon: alert.lon });
    const distanceKm = distanceMeters / 1000;

    if (distanceKm <= maxDistanceKm) {
      if (!closest || distanceKm < closest.distanceKm) {
        closest = { alert, distanceKm };
      }
    }
  }

  return closest;
};

/**
 * Generates natural spoken speech for approaching weather hazards.
 */
export const formatWeatherWarningSpeech = (
  label: string,
  distanceKm: number,
  severity: 'clear' | 'moderate' | 'high'
): string => {
  const roundedKm = Math.max(1, Math.round(distanceKm));
  if (severity === 'high') {
    return `Caution. Severe weather alert: ${label} ahead in approximately ${roundedKm} kilometers. Please reduce speed and increase following distance.`;
  }
  return `Weather advisory: ${label} ahead in approximately ${roundedKm} kilometers. Drive carefully.`;
};

