import React, { useState, useEffect, useRef } from 'react';
import { StyleSheet, View, TouchableOpacity, ActivityIndicator, Alert, ScrollView } from 'react-native';
import MapView, { Polyline, Marker } from 'react-native-maps';
import * as Location from 'expo-location';
import { BlurView } from 'expo-blur';
import { Text, Divider } from 'react-native-paper';
import { fetchAlternativeRoutes, RouteStep } from '../../services/osrm';
import { useWeatherAlerts } from '../../hooks/useWeatherAlerts';
import { LocationSearchInput } from '../../components/LocationSearchInput';
import { useWeatherStore } from '../../store/useWeatherStore';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getProxyBaseUrl } from '../../utils/proxyUrl';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { NavigationHUD } from '../../components/NavigationHUD';
import {
  calculateBearing,
  haversineDistanceMeters,
  findUpcomingHazard,
  speakGuidance,
  formatWeatherWarningSpeech,
} from '../../services/navigation';

const LAST_KNOWN_LOCATION_KEY = 'last_known_location';

const DEFAULT_REGION = {
  latitude: 14.5995,
  longitude: 120.9842,
  latitudeDelta: 0.08,
  longitudeDelta: 0.08,
};

const COLORS = {
  navy: '#0F172A',
  electricBlue: '#3B82F6',
  white: '#FFFFFF',
  gray: '#64748B',
  red: '#EF4444',
  green: '#10B981',
  yellow: '#F59E0B',
};

const NOMINATIM_BASE = `${getProxyBaseUrl()}/nominatim`;

const mapStyle = [
  { "elementType": "geometry", "stylers": [{ "color": "#242f3e" }] },
  { "elementType": "labels.text.fill", "stylers": [{ "color": "#746855" }] },
  { "elementType": "labels.text.stroke", "stylers": [{ "color": "#242f3e" }] },
  { "featureType": "administrative.locality", "elementType": "labels.text.fill", "stylers": [{ "color": "#d59563" }] },
  { "featureType": "poi", "elementType": "labels.text.fill", "stylers": [{ "color": "#d59563" }] },
  { "featureType": "poi.park", "elementType": "geometry", "stylers": [{ "color": "#263c3f" }] },
  { "featureType": "poi.park", "elementType": "labels.text.fill", "stylers": [{ "color": "#6b9a76" }] },
  { "featureType": "road", "elementType": "geometry", "stylers": [{ "color": "#38414e" }] },
  { "featureType": "road", "elementType": "geometry.stroke", "stylers": [{ "color": "#212a37" }] },
  { "featureType": "road", "elementType": "labels.text.fill", "stylers": [{ "color": "#9ca5b3" }] },
  { "featureType": "road.highway", "elementType": "geometry", "stylers": [{ "color": "#746855" }] },
  { "featureType": "road.highway", "elementType": "geometry.stroke", "stylers": [{ "color": "#1f2835" }] },
  { "featureType": "road.highway", "elementType": "labels.text.fill", "stylers": [{ "color": "#f3d19c" }] },
  { "featureType": "water", "elementType": "geometry", "stylers": [{ "color": "#17263c" }] },
  { "featureType": "water", "elementType": "labels.text.fill", "stylers": [{ "color": "#515c6d" }] },
  { "featureType": "water", "elementType": "labels.text.stroke", "stylers": [{ "color": "#17263c" }] }
];

/**
 * Returns an emoji based on the WMO weather code.
 */
const getWeatherEmoji = (code: number): string => {
  if (code === 0) return '☀️';
  if (code >= 1 && code <= 3) return '⛅';
  if (code === 45 || code === 48) return '🌫️';
  if (code >= 51 && code <= 55) return '🌦️';
  if (code >= 61 && code <= 65) return '🌧️';
  if (code >= 66 && code <= 67) return '❄️';
  if (code >= 71 && code <= 75) return '🌨️';
  if (code === 77) return '🌨️';
  if (code >= 80 && code <= 82) return '🚿';
  if (code >= 85 && code <= 86) return '❄️';
  if (code >= 95) return '⛈️';
  return '❓';
};

interface Point {
  lat: number;
  lon: number;
  label: string;
}

export default function MapScreen() {
  const [origin, setOrigin] = useState<Point | null>(null);
  const [destination, setDestination] = useState<Point | null>(null);
  const [loadingState, setLoadingState] = useState('');
  const [allRoutes, setAllRoutes] = useState<any[]>([]);
  const [userLocation, setUserLocation] = useState<Location.LocationObject | null>(null);
  
  const comparisons = useWeatherStore((s) => s.comparisons);
  const selectedRouteIndex = useWeatherStore((s) => s.selectedRouteIndex);
  const clearStoreState = useWeatherStore((s) => s.clearRouteState);
  const setRouteLabels = useWeatherStore((s) => s.setRouteLabels);
  const { isAnalyzing, compareRoutes, selectRoute, summary } = useWeatherAlerts();
  const mapRef = useRef<MapView>(null);

  // Navigation Mode States
  const [isNavigating, setIsNavigating] = useState(false);
  const [isSimulating, setIsSimulating] = useState(false);
  const [simulationSpeed, setSimulationSpeed] = useState(1);
  const [driverCoord, setDriverCoord] = useState<{ lat: number; lon: number } | null>(null);
  const [driverHeading, setDriverHeading] = useState(0);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [simulatedCoordIndex, setSimulatedCoordIndex] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const [currentSpeedKph, setCurrentSpeedKph] = useState(45);

  const simulationIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const locationSubscriptionRef = useRef<Location.LocationSubscription | null>(null);
  const lastWarnedHazardKeyRef = useRef<string>('');

  const animateMapToDriver = (coord: { lat: number; lon: number }, heading: number, duration = 600) => {
    if (mapRef.current) {
      if (typeof (mapRef.current as any).animateCamera === 'function') {
        (mapRef.current as any).animateCamera(
          {
            center: { latitude: coord.lat, longitude: coord.lon },
            pitch: 50,
            heading,
            zoom: 18,
          },
          { duration }
        );
      } else {
        mapRef.current.animateToRegion({
          latitude: coord.lat,
          longitude: coord.lon,
          latitudeDelta: 0.008,
          longitudeDelta: 0.008,
        });
      }
    }
  };

  const handleStartNavigation = () => {
    const activeRoute = allRoutes[selectedRouteIndex];
    if (!activeRoute || !activeRoute.coordinates || activeRoute.coordinates.length === 0) {
      Alert.alert('No Route', 'Please calculate routes before starting navigation.');
      return;
    }

    const startCoord = activeRoute.coordinates[0];
    const initialHeading = activeRoute.coordinates.length > 1
      ? calculateBearing(startCoord, activeRoute.coordinates[1])
      : 0;

    lastWarnedHazardKeyRef.current = '';
    setIsNavigating(true);
    setIsSimulating(false);
    setDriverCoord(startCoord);
    setDriverHeading(initialHeading);
    setCurrentStepIndex(0);
    setSimulatedCoordIndex(0);
    setCurrentSpeedKph(activeRoute.travelMode === 'flight' ? 850 : 45);

    animateMapToDriver(startCoord, initialHeading, 1000);

    const firstStep = activeRoute.steps && activeRoute.steps.length > 0 ? activeRoute.steps[0] : null;
    if (firstStep) {
      speakGuidance(firstStep.instruction, isMuted);
    }
  };

  const handleExitNavigation = () => {
    lastWarnedHazardKeyRef.current = '';
    setIsNavigating(false);
    setIsSimulating(false);
    if (simulationIntervalRef.current) {
      clearInterval(simulationIntervalRef.current);
      simulationIntervalRef.current = null;
    }
    if (locationSubscriptionRef.current) {
      locationSubscriptionRef.current.remove();
      locationSubscriptionRef.current = null;
    }

    if (allRoutes[selectedRouteIndex]) {
      const points = allRoutes[selectedRouteIndex].coordinates.map((p: any) => ({
        latitude: p.lat,
        longitude: p.lon,
      }));
      if (typeof (mapRef.current as any)?.animateCamera === 'function') {
        (mapRef.current as any).animateCamera({ pitch: 0, heading: 0 });
      }
      mapRef.current?.fitToCoordinates(points, {
        edgePadding: { top: 100, right: 100, bottom: 300, left: 100 },
        animated: true,
      });
    }
  };

  const handleRecenterCamera = () => {
    if (!driverCoord) return;
    animateMapToDriver(driverCoord, driverHeading, 600);
  };

  const clearRouteState = () => {
    if (isNavigating) {
      handleExitNavigation();
    }
    setAllRoutes([]);
    clearStoreState();
    setLoadingState('');
  };

  // Smoothly focus on the route whenever the selection changes (only when not navigating)
  useEffect(() => {
    if (isNavigating) return;
    if (allRoutes.length > 0 && allRoutes[selectedRouteIndex]) {
      const points = allRoutes[selectedRouteIndex].coordinates.map((p: any) => ({ 
        latitude: p.lat, 
        longitude: p.lon 
      }));
      
      mapRef.current?.fitToCoordinates(points, {
        edgePadding: { top: 100, right: 100, bottom: 300, left: 100 },
        animated: true,
      });
    }
  }, [selectedRouteIndex, allRoutes, isNavigating]);

  // Simulation Loop
  useEffect(() => {
    if (!isNavigating || !isSimulating) {
      if (simulationIntervalRef.current) {
        clearInterval(simulationIntervalRef.current);
        simulationIntervalRef.current = null;
      }
      return;
    }

    const activeRoute = allRoutes[selectedRouteIndex];
    if (!activeRoute || !activeRoute.coordinates || activeRoute.coordinates.length === 0) return;

    const coords = activeRoute.coordinates;
    const steps: RouteStep[] = activeRoute.steps || [];
    const intervalMs = Math.max(150, Math.round(700 / simulationSpeed));

    simulationIntervalRef.current = setInterval(() => {
      setSimulatedCoordIndex((prevIndex) => {
        const nextIndex = prevIndex + 1;
        if (nextIndex >= coords.length) {
          speakGuidance('You have reached your destination.', isMuted);
          setIsSimulating(false);
          return prevIndex;
        }

        const currentPt = coords[nextIndex];
        const nextPt = nextIndex + 1 < coords.length ? coords[nextIndex + 1] : currentPt;
        const heading = calculateBearing(currentPt, nextPt);

        setDriverCoord(currentPt);
        setDriverHeading(heading);
        animateMapToDriver(currentPt, heading, intervalMs);

        // Advance step if close to next maneuver
        setCurrentStepIndex((stepIdx) => {
          if (stepIdx < steps.length) {
            const maneuverLoc = steps[stepIdx].maneuver?.location;
            if (maneuverLoc) {
              const dist = haversineDistanceMeters(currentPt, { lat: maneuverLoc[1], lon: maneuverLoc[0] });
              if (dist < 50 && stepIdx + 1 < steps.length) {
                const nextManeuver = steps[stepIdx + 1];
                speakGuidance(nextManeuver.instruction, isMuted);
                return stepIdx + 1;
              }
            }
          }
          return stepIdx;
        });

        return nextIndex;
      });
    }, intervalMs);

    return () => {
      if (simulationIntervalRef.current) {
        clearInterval(simulationIntervalRef.current);
      }
    };
  }, [isNavigating, isSimulating, simulationSpeed, selectedRouteIndex, allRoutes, isMuted]);

  // Live GPS tracking when not simulating
  useEffect(() => {
    if (!isNavigating || isSimulating) {
      if (locationSubscriptionRef.current) {
        locationSubscriptionRef.current.remove();
        locationSubscriptionRef.current = null;
      }
      return;
    }

    const activeRoute = allRoutes[selectedRouteIndex];
    if (!activeRoute) return;
    const steps: RouteStep[] = activeRoute.steps || [];

    let isMounted = true;
    (async () => {
      try {
        const sub = await Location.watchPositionAsync(
          {
            accuracy: Location.Accuracy.High,
            timeInterval: 1000,
            distanceInterval: 5,
          },
          (loc) => {
            if (!isMounted) return;
            const newCoord = { lat: loc.coords.latitude, lon: loc.coords.longitude };
            const heading = loc.coords.heading ?? driverHeading;

            setDriverCoord(newCoord);
            if (loc.coords.heading !== null && loc.coords.heading !== undefined) {
              setDriverHeading(loc.coords.heading);
            }
            if (loc.coords.speed !== null && loc.coords.speed !== undefined && loc.coords.speed > 0) {
              setCurrentSpeedKph(loc.coords.speed * 3.6);
            }

            animateMapToDriver(newCoord, heading, 600);

            setCurrentStepIndex((stepIdx) => {
              if (stepIdx < steps.length) {
                const maneuverLoc = steps[stepIdx].maneuver?.location;
                if (maneuverLoc) {
                  const dist = haversineDistanceMeters(newCoord, { lat: maneuverLoc[1], lon: maneuverLoc[0] });
                  if (dist < 40 && stepIdx + 1 < steps.length) {
                    const nextManeuver = steps[stepIdx + 1];
                    speakGuidance(nextManeuver.instruction, isMuted);
                    return stepIdx + 1;
                  }
                }
              }
              return stepIdx;
            });
          }
        );
        locationSubscriptionRef.current = sub;
      } catch (e) {
        console.warn('Live location watch failed:', e);
      }
    })();

    return () => {
      isMounted = false;
      if (locationSubscriptionRef.current) {
        locationSubscriptionRef.current.remove();
        locationSubscriptionRef.current = null;
      }
    };
  }, [isNavigating, isSimulating, selectedRouteIndex, allRoutes, isMuted]);

  // Clean up timers on unmount
  useEffect(() => {
    return () => {
      if (simulationIntervalRef.current) clearInterval(simulationIntervalRef.current);
      if (locationSubscriptionRef.current) locationSubscriptionRef.current.remove();
    };
  }, []);

  // Periodic weather refresh during active driving (every 10 minutes)
  useEffect(() => {
    if (!isNavigating || allRoutes.length === 0) return;

    const refreshInterval = setInterval(async () => {
      console.log('[Navigation] Running periodic 10-minute weather update for route...');
      try {
        await compareRoutes(allRoutes);
      } catch (err: any) {
        console.warn('[Navigation] Periodic weather refresh failed:', err.message);
      }
    }, 10 * 60 * 1000);

    return () => clearInterval(refreshInterval);
  }, [isNavigating, allRoutes]);

  const getFallbackLocation = async () => {
    try {
      const saved = await AsyncStorage.getItem(LAST_KNOWN_LOCATION_KEY);
      if (saved) {
        console.log('Using dynamic fallback from AsyncStorage');
        return JSON.parse(saved);
      }
    } catch (e) {
      console.warn('AsyncStorage read error:', e);
    }
    console.log('Using default fallback location');
    return { latitude: DEFAULT_REGION.latitude, longitude: DEFAULT_REGION.longitude };
  };

  const saveLocationToStorage = async (latitude: number, longitude: number) => {
    try {
      await AsyncStorage.setItem(LAST_KNOWN_LOCATION_KEY, JSON.stringify({ latitude, longitude }));
    } catch (e) {
      console.warn('AsyncStorage write error:', e);
    }
  };

  useEffect(() => {
    (async () => {
      try {
        let { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') return;

        // 1. Try to get last known position for instant load
        const lastKnown = await Location.getLastKnownPositionAsync({});
        if (lastKnown) {
          setUserLocation(lastKnown);
          saveLocationToStorage(lastKnown.coords.latitude, lastKnown.coords.longitude);
          mapRef.current?.animateToRegion({
            latitude: lastKnown.coords.latitude,
            longitude: lastKnown.coords.longitude,
            latitudeDelta: 0.05,
            longitudeDelta: 0.05,
          });
        }

        // 2. Fetch fresh position with Balanced accuracy and 5s timeout
        const location = await Promise.race([
          Location.getCurrentPositionAsync({ 
            accuracy: Location.Accuracy.Balanced 
          }),
          new Promise<null>((_, reject) => 
            setTimeout(() => reject(new Error('Timeout')), 5000)
          )
        ]) as Location.LocationObject;

        if (location) {
          setUserLocation(location);
          saveLocationToStorage(location.coords.latitude, location.coords.longitude);
          mapRef.current?.animateToRegion({
            latitude: location.coords.latitude,
            longitude: location.coords.longitude,
            latitudeDelta: 0.05,
            longitudeDelta: 0.05,
          });
        }
      } catch (error) {
        console.log('Location fetch optimized/timed out, using fallback');
        if (!userLocation) {
          const fallback = await getFallbackLocation();
          mapRef.current?.animateToRegion({
            ...fallback,
            latitudeDelta: 0.05,
            longitudeDelta: 0.05,
          });
        }
      }
    })();
  }, []);

  const handleUseCurrentLocation = async () => {
    // 1. Check permissions first (this is near-instant if already granted)
    let { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission Denied', 'Location access is required.');
      return;
    }

    clearRouteState();

    // 2. Grab the fastest available coordinates (cache-first)
    let latitude: number;
    let longitude: number;
    let usedCachedCoords = false;

    const lastKnown = await Location.getLastKnownPositionAsync({});
    if (lastKnown) {
      latitude = lastKnown.coords.latitude;
      longitude = lastKnown.coords.longitude;
      usedCachedCoords = true;
    } else {
      // Fall back to AsyncStorage / Davao default
      const fallback = await getFallbackLocation();
      latitude = fallback.latitude;
      longitude = fallback.longitude;
      usedCachedCoords = true;
    }

    // 3. INSTANT UI FEEDBACK — set origin immediately with cached coords
    //    No loading spinner, no blocking. The user sees "Current Location" right away.
    setOrigin({ lat: latitude, lon: longitude, label: 'Current Location' });

    // 4. BACKGROUND REFINEMENT — improve coords + resolve address asynchronously
    //    Both have a strict 3-second timeout so the app never hangs.
    (async () => {
      let refinedLat = latitude;
      let refinedLon = longitude;
      let coordsRefined = false;

      // 4a. Try to get a fresh high-accuracy GPS fix (3s hard timeout)
      try {
        const freshLocation = await Promise.race([
          Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.Balanced,
          }),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('GPS timeout')), 3000)
          ),
        ]) as Location.LocationObject;

        if (freshLocation) {
          refinedLat = freshLocation.coords.latitude;
          refinedLon = freshLocation.coords.longitude;
          coordsRefined = true;
          saveLocationToStorage(refinedLat, refinedLon);
        }
      } catch {
        console.log('[Location] Fresh GPS timed out after 3s, keeping cached position');
        // Persist the cached coords if we haven't already
        if (usedCachedCoords) {
          saveLocationToStorage(latitude, longitude);
        }
      }

      // 4b. Reverse-geocode the best available coords into an address
      let resolvedLabel = 'Current Location';
      try {
        let response: Response;
        try {
          response = await fetch(
            `${NOMINATIM_BASE}/reverse?lat=${refinedLat}&lon=${refinedLon}&format=json`
          );
          if (!response.ok) throw new Error('Proxy reverse failed');
        } catch {
          const directUrl = `https://nominatim.openstreetmap.org/reverse?lat=${refinedLat}&lon=${refinedLon}&format=json`;
          response = await fetch(directUrl, {
            headers: { 'User-Agent': 'WeatherWiseApp/1.0' },
          });
        }

        const data = await response.json();
        if (data.display_name) {
          resolvedLabel = data.display_name;
        }
      } catch {
        console.log('[Location] Reverse geocode failed, keeping "Current Location" label');
      }

      // 4c. Silently update origin with refined coords + resolved address
      setOrigin({ lat: refinedLat, lon: refinedLon, label: resolvedLabel });
    })();
  };

  const handleGetRoute = async () => {
    if (!origin || !destination) {
      Alert.alert('Missing Info', 'Please select both origin and destination.');
      return;
    }

    setLoadingState('🗺 Calculating route...');
    try {
      const fetchedRoutes = await fetchAlternativeRoutes(
        { lat: origin.lat, lon: origin.lon },
        { lat: destination.lat, lon: destination.lon }
      );

      // Sort by duration (fastest first) and limit to 3 total
      const sortedRoutes = fetchedRoutes
        .sort((a, b) => a.totalDurationMinutes - b.totalDurationMinutes)
        .slice(0, 3);
      
      setAllRoutes(sortedRoutes);
      setRouteLabels(origin.label, destination.label);
      
      setLoadingState('🌦 Checking weather along your route...');
      const comparisonResults = await compareRoutes(sortedRoutes);
      
      setLoadingState('✅ Done — checking results');
      setTimeout(() => setLoadingState(''), 1500);

      // Select the safest/best route by default (top of comparison)
      const safest = comparisonResults[0];

      const points = sortedRoutes[safest.routeIndex].coordinates.map((p: any) => ({ latitude: p.lat, longitude: p.lon }));
      
      // Provide generous padding so the route isn't hidden behind UI elements
      mapRef.current?.fitToCoordinates(points, {
        edgePadding: { top: 100, right: 100, bottom: 300, left: 100 },
        animated: true,
      });

    } catch (error: any) {
      Alert.alert('Error', error.message || 'Could not fetch routes.');
      setLoadingState('');
    }
  };

  const currentRoute = allRoutes[selectedRouteIndex];
  const currentComparison = comparisons.find(c => c.routeIndex === selectedRouteIndex);

  const currentStep = currentRoute?.steps && currentRoute.steps[currentStepIndex]
    ? currentRoute.steps[currentStepIndex]
    : null;
  const nextStep = currentRoute?.steps && currentRoute.steps[currentStepIndex + 1]
    ? currentRoute.steps[currentStepIndex + 1]
    : null;

  const distanceToNextStepMeters = driverCoord && currentStep
    ? haversineDistanceMeters(driverCoord, {
        lat: currentStep.maneuver?.location ? currentStep.maneuver.location[1] : driverCoord.lat,
        lon: currentStep.maneuver?.location ? currentStep.maneuver.location[0] : driverCoord.lon,
      })
    : (currentStep?.distanceMeters ?? 0);

  const totalCoords = currentRoute?.coordinates?.length || 1;
  const progressRatio = Math.min(1, simulatedCoordIndex / totalCoords);
  const remainingDistanceKm = Math.max(0, (currentRoute?.totalDistanceKm || 0) * (1 - progressRatio));
  const remainingDurationMinutes = Math.max(0, (currentRoute?.totalDurationMinutes || 0) * (1 - progressRatio));

  const upcomingHazard = driverCoord
    ? findUpcomingHazard(driverCoord, currentComparison?.alerts || [])
    : null;

  // Spoken voice warning alert when approaching a weather hazard
  useEffect(() => {
    if (!isNavigating || !upcomingHazard || isMuted) return;

    const hazardAlert = upcomingHazard.alert;
    const hazardKey = `${hazardAlert.segmentIndex ?? hazardAlert.waypointIndex ?? hazardAlert.label}_${hazardAlert.severity}`;

    if (upcomingHazard.distanceKm <= 20 && lastWarnedHazardKeyRef.current !== hazardKey) {
      lastWarnedHazardKeyRef.current = hazardKey;
      const warningSpeech = formatWeatherWarningSpeech(
        hazardAlert.label,
        upcomingHazard.distanceKm,
        hazardAlert.severity
      );
      speakGuidance(warningSpeech, isMuted);
    }
  }, [isNavigating, upcomingHazard, isMuted]);

  return (
    <View style={styles.container}>
      <MapView
        ref={mapRef}
        style={styles.map}
        initialRegion={DEFAULT_REGION}
        showsUserLocation={!isNavigating}
        showsMyLocationButton={!isNavigating}
        customMapStyle={mapStyle}
      >
        {allRoutes.map((route, index) => {
          const isSelected = selectedRouteIndex === index;
          const comparison = comparisons.find(c => c.routeIndex === index);
          
          if (!isSelected) {
            // Unselected routes are gray and dashed
            return (
              <Polyline
                key={`route-${index}`}
                coordinates={route.coordinates.map((p: any) => ({ latitude: p.lat, longitude: p.lon }))}
                strokeWidth={4}
                strokeColor="rgba(100, 116, 139, 0.4)"
                lineDashPattern={[5, 5]}
                zIndex={index}
                tappable={true}
                onPress={() => selectRoute(index)}
              />
            );
          }

          // Selected route: segmented and colored by weather severity
          if (!comparison || !comparison.alerts || comparison.alerts.length === 0) {
            return (
              <Polyline
                key={`route-${index}`}
                coordinates={route.coordinates.map((p: any) => ({ latitude: p.lat, longitude: p.lon }))}
                strokeWidth={6}
                strokeColor={COLORS.electricBlue}
                zIndex={10}
              />
            );
          }

          const polylines = [];
          const coords = route.coordinates;
          const alerts = comparison.alerts;

          let startIndex = 0;
          for (let i = 0; i < alerts.length; i++) {
            const alert = alerts[i];
            const nextAlert = alerts[i + 1];
            
            // Assign coords to the nearest waypoint segment
            const endIndex = nextAlert 
              ? Math.floor((alert.segmentIndex + nextAlert.segmentIndex) / 2) 
              : coords.length - 1;
            
            // Fallback safety if indexes are weird
            const start = Math.max(0, Math.min(startIndex, coords.length - 1));
            const end = Math.max(0, Math.min(endIndex, coords.length - 1));
            
            const segmentCoords = coords.slice(start, end + 1).map((p: any) => ({ latitude: p.lat, longitude: p.lon }));
            
            const color = alert.severity === 'high' ? COLORS.red : alert.severity === 'moderate' ? COLORS.yellow : COLORS.green;
            
            polylines.push(
              <Polyline
                key={`route-seg-${i}`}
                coordinates={segmentCoords}
                strokeWidth={6}
                strokeColor={color}
                zIndex={10}
              />
            );
            
            startIndex = end; // start next segment where this one ended
          }
          return polylines;
        })}
        
        {currentComparison?.alerts?.map((alert, index) => {
          const emoji = getWeatherEmoji(alert.weatherCode);
          const markerColor = alert.severity === 'high' ? COLORS.red : alert.severity === 'moderate' ? COLORS.yellow : COLORS.green;
          return (
            <Marker
              key={`alert-${index}`}
              coordinate={{ latitude: alert.lat, longitude: alert.lon }}
              title={alert.label}
              description={`${alert.precipitationProbability}% rain · in ${alert.minutesFromNow} min`}
            >
              <View style={[styles.alertMarker, { borderColor: markerColor, borderWidth: 2, borderRadius: 20, backgroundColor: 'rgba(15,23,42,0.85)', padding: 4 }]}>
                <Text style={{ fontSize: 20 }}>{emoji}</Text>
              </View>
            </Marker>
          );
        })}

        {/* User Location Marker when not navigating */}
        {!isNavigating && userLocation && (
          <Marker
            coordinate={{ latitude: userLocation.coords.latitude, longitude: userLocation.coords.longitude }}
            title="You"
            pinColor={COLORS.electricBlue}
          />
        )}

        {/* Active Driver Navigation Marker */}
        {isNavigating && driverCoord && (
          <Marker
            coordinate={{ latitude: driverCoord.lat, longitude: driverCoord.lon }}
            anchor={{ x: 0.5, y: 0.5 }}
            flat
            rotation={driverHeading}
            zIndex={999}
          >
            <View style={styles.navVehicleContainer}>
              <View style={styles.navVehiclePulse} />
              <View style={styles.navVehicleIcon}>
                <MaterialCommunityIcons name="navigation" size={22} color={COLORS.white} />
              </View>
            </View>
          </Marker>
        )}
      </MapView>

      {/* INPUT SEARCH PANEL (Hidden during Navigation) */}
      {!isNavigating && (
        <View style={styles.inputWrapper}>
          <BlurView intensity={80} tint="dark" style={styles.blurContainer}>
            <View style={styles.inputContainer}>
              <LocationSearchInput
                label="Origin"
                placeholder="Search start location..."
                value={origin?.label || ''}
                onSelect={(lat, lon, label) => {
                  clearRouteState();
                  setOrigin({ lat, lon, label });
                }}
                onClear={() => {
                  clearRouteState();
                  setOrigin(null);
                }}
                showCurrentLocationButton={true}
                onCurrentLocationPress={handleUseCurrentLocation}
              />
              <Divider style={styles.divider} />
              <LocationSearchInput
                label="Destination"
                placeholder="Search destination..."
                value={destination?.label || ''}
                onSelect={(lat, lon, label) => {
                  clearRouteState();
                  setDestination({ lat, lon, label });
                }}
                onClear={() => {
                  clearRouteState();
                  setDestination(null);
                }}
              />
              <TouchableOpacity style={styles.button} onPress={handleGetRoute} disabled={!!loadingState || isAnalyzing}>
                {loadingState || isAnalyzing ? (
                  <Text style={styles.buttonText}>{loadingState || 'Analyzing...'}</Text>
                ) : (
                  <Text style={styles.buttonText}>Compare Routes</Text>
                )}
              </TouchableOpacity>
            </View>
          </BlurView>
          
          {/* Dynamic Summary Banner */}
          {summary && (
            <TouchableOpacity 
              style={[
                styles.summaryBanner,
                { backgroundColor: summary.overallRisk === 'high' ? COLORS.red : summary.overallRisk === 'moderate' ? COLORS.yellow : COLORS.green }
              ]}
              onPress={handleStartNavigation}
              activeOpacity={0.8}
            >
              {summary.overallRisk === 'clear' && (
                <Text style={styles.summaryText}>✅ Route clear · Tap to Start Drive</Text>
              )}
              {summary.overallRisk === 'moderate' && (
                <Text style={styles.summaryText}>⚠ Rain possible · Tap to Start Drive</Text>
              )}
              {summary.overallRisk === 'high' && (
                <Text style={styles.summaryText}>
                  ⛈ {summary.firstHazardLabel} in {summary.firstHazardMinutes} min · Tap to Start Drive
                </Text>
              )}
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* ROUTE COMPARISON BOTTOM SHEET (Hidden during Navigation) */}
      {!isNavigating && comparisons?.length > 0 && (
        <View style={styles.bottomSheet}>
          <BlurView intensity={95} tint="dark" style={styles.bottomBlur}>
            <View style={styles.sheetHeaderRow}>
              <Text style={styles.sheetTitle}>Choose Safest Route</Text>
              <TouchableOpacity
                style={styles.startNavActionBtn}
                onPress={handleStartNavigation}
                activeOpacity={0.8}
              >
                <MaterialCommunityIcons name="navigation" size={16} color={COLORS.white} />
                <Text style={styles.startNavActionText}>Start Drive</Text>
              </TouchableOpacity>
            </View>
            <ScrollView 
              horizontal 
              showsHorizontalScrollIndicator={false} 
              contentContainerStyle={styles.comparisonScroll}
              keyboardShouldPersistTaps="handled"
            >
              {(comparisons ?? []).map((comp) => {
                const isSelected = selectedRouteIndex === comp.routeIndex;
                const riskColor = comp.overallRisk === 'high' ? COLORS.red : 
                                 comp.overallRisk === 'moderate' ? COLORS.yellow : COLORS.green;
                
                return (
                  <TouchableOpacity 
                    key={comp.routeIndex} 
                    onPress={() => selectRoute(comp.routeIndex)}
                    activeOpacity={0.7}
                    style={[
                      styles.comparisonCard,
                      isSelected && styles.activeCard,
                      { borderColor: riskColor }
                    ]}
                  >
                    <View style={styles.cardHeader}>
                      <Text style={styles.cardLabel}>{comp.label}</Text>
                      <View style={[styles.riskBadge, { backgroundColor: riskColor + '20', borderColor: riskColor, borderWidth: 1 }]}>
                        <Text style={[styles.riskText, { color: riskColor }]}>{comp.overallRisk.toUpperCase()}</Text>
                      </View>
                    </View>
                    
                    <Text style={styles.durationText}>{Math.round(comp.totalDurationMinutes)} min</Text>
                    <Text style={styles.distanceText}>{comp.totalDistanceKm.toFixed(1)} km</Text>
                    
                    {comp.extraMinutesVsPrimary > 0 && (
                      <Text style={styles.extraText}>
                        +{Math.round(comp.extraMinutesVsPrimary)} min {comp.overallRisk === 'clear' ? 'but safe' : ''}
                      </Text>
                    )}
                    {comp.overallRisk === 'clear' && comp.extraMinutesVsPrimary > 0 && (
                      <Text style={styles.recommendation}>✅ Recommended</Text>
                    )}

                    {isSelected && (
                      <TouchableOpacity
                        style={styles.cardStartBtn}
                        onPress={handleStartNavigation}
                        activeOpacity={0.8}
                      >
                        <MaterialCommunityIcons name="navigation" size={13} color={COLORS.white} />
                        <Text style={styles.cardStartBtnText}>Start Drive</Text>
                      </TouchableOpacity>
                    )}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </BlurView>
        </View>
      )}

      {/* ACTIVE NAVIGATION HUD */}
      {isNavigating && (
        <NavigationHUD
          currentStep={currentStep}
          nextStep={nextStep}
          distanceToNextStepMeters={distanceToNextStepMeters}
          remainingDurationMinutes={remainingDurationMinutes}
          remainingDistanceKm={remainingDistanceKm}
          currentSpeedKph={currentSpeedKph}
          upcomingHazard={upcomingHazard}
          isSimulating={isSimulating}
          simulationSpeed={simulationSpeed}
          isMuted={isMuted}
          travelMode={currentRoute?.travelMode}
          onToggleSimulate={() => setIsSimulating(!isSimulating)}
          onChangeSimSpeed={(spd) => setSimulationSpeed(spd)}
          onToggleMute={() => setIsMuted(!isMuted)}
          onRecenter={handleRecenterCamera}
          onExitNavigation={handleExitNavigation}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.navy },
  map: { width: '100%', height: '100%' },
  inputWrapper: { position: 'absolute', top: 50, left: 16, right: 16, zIndex: 100 },
  blurContainer: { borderRadius: 20, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)' },
  inputContainer: { padding: 16 },
  divider: { backgroundColor: 'rgba(255,255,255,0.1)', marginVertical: 8 },
  button: { backgroundColor: COLORS.electricBlue, height: 50, borderRadius: 12, justifyContent: 'center', alignItems: 'center', marginTop: 16 },
  buttonText: { color: COLORS.white, fontSize: 16, fontWeight: '700' },
  bottomSheet: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 260 },
  bottomBlur: { flex: 1, padding: 20, borderTopLeftRadius: 24, borderTopRightRadius: 24, overflow: 'hidden' },
  sheetHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  sheetTitle: { color: '#fff', fontSize: 18, fontWeight: '800' },
  startNavActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.electricBlue,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 20,
    shadowColor: COLORS.electricBlue,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.4,
    shadowRadius: 4,
    elevation: 3,
  },
  startNavActionText: { color: COLORS.white, fontWeight: '800', fontSize: 13, marginLeft: 4 },
  comparisonScroll: { paddingRight: 20 },
  comparisonCard: { backgroundColor: 'rgba(255,255,255,0.05)', width: 160, borderRadius: 16, padding: 15, marginRight: 12, borderWidth: 1 },
  activeCard: { backgroundColor: 'rgba(59, 130, 246, 0.1)', borderWidth: 2 },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  cardLabel: { color: '#fff', fontSize: 12, fontWeight: '600', opacity: 0.7 },
  riskBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  riskText: { color: '#fff', fontSize: 8, fontWeight: '900' },
  durationText: { color: '#fff', fontSize: 24, fontWeight: '800' },
  distanceText: { color: COLORS.gray, fontSize: 13, marginBottom: 8 },
  extraText: { color: COLORS.yellow, fontSize: 11, fontWeight: '600' },
  recommendation: { color: COLORS.green, fontSize: 11, fontWeight: '700', marginTop: 4 },
  cardStartBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.electricBlue,
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 8,
    marginTop: 6,
    alignSelf: 'flex-start',
  },
  cardStartBtnText: { color: COLORS.white, fontSize: 11, fontWeight: '800', marginLeft: 4 },
  alertMarker: { alignItems: 'center' },
  summaryBanner: { marginTop: 8, padding: 12, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  summaryText: { color: COLORS.navy, fontWeight: '800', fontSize: 14 },
  navVehicleContainer: { width: 48, height: 48, justifyContent: 'center', alignItems: 'center' },
  navVehiclePulse: { position: 'absolute', width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(59, 130, 246, 0.3)' },
  navVehicleIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: COLORS.electricBlue,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: COLORS.white,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 5,
  },
});
