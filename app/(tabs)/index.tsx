import { MaterialCommunityIcons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { BlurView } from 'expo-blur';
import * as Location from 'expo-location';
import { useFocusEffect } from 'expo-router';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, BackHandler, KeyboardAvoidingView, LayoutAnimation, Modal, Platform, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';
import { Divider, Text } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LocationSearchInput } from '../../components/LocationSearchInput';
import { NavigationHUD } from '../../components/NavigationHUD';
import MapView, { MapViewRef, Marker, Polyline, UrlTile } from '../../components/OpenStreetMap';
import { useWeatherAlerts } from '../../hooks/useWeatherAlerts';
import {
  calculateBearing,
  findUpcomingHazard,
  formatWeatherWarningSpeech,
  haversineDistanceMeters,
  speakGuidance,
} from '../../services/navigation';
import { fetchAlternativeRoutes, RouteStep } from '../../services/osrm';
import { analyzeRouteRoadConditions, RoadEvent, TRAFFIC_COLORS } from '../../services/roadEvents';
import { useWeatherStore } from '../../store/useWeatherStore';
import { getProxyBaseUrl } from '../../utils/proxyUrl';

const LAST_KNOWN_LOCATION_KEY = 'last_known_location';

const DEFAULT_REGION = {
  latitude: 14.5995,
  longitude: 120.9842,
  latitudeDelta: 0.08,
  longitudeDelta: 0.08,
};

// R-31 Decision: Defined 3-core color palette + semantic functional risk states
// R-21 Decision: In-vehicle navigation palette optimized for reduced glare and high contrast
const COLORS = {
  navy: '#0F172A',           // Primary dark background
  surfaceElevated: '#1E293B', // Card and control container background
  surfaceSubtle: 'rgba(255, 255, 255, 0.08)',
  borderSubtle: 'rgba(255, 255, 255, 0.15)',
  electricBlue: '#3B82F6',   // Primary actionable accent
  white: '#FFFFFF',          // High-contrast primary text (15:1)
  textSecondary: '#CBD5E1',  // High-contrast secondary text (10.7:1 WCAG AA)
  textMuted: '#94A3B8',      // Accessible caption text (7.2:1 WCAG AA)
  red: '#EF4444',            // High risk warning state
  green: '#10B981',          // Safe / clear risk state
  yellow: '#F59E0B',         // Moderate risk warning state
};

// R-11 Decision: Design system token scale for border radii
const RADII = {
  sm: 8,   // Micro badges and tags
  md: 12,  // Interactive buttons and inputs
  lg: 16,  // Cards and floating panels
  xl: 24,  // Modal and bottom sheet tops
};

const NOMINATIM_BASE = `${getProxyBaseUrl()}/nominatim`;


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
  const insets = useSafeAreaInsets();
  const [origin, setOrigin] = useState<Point | null>(null);
  const [destination, setDestination] = useState<Point | null>(null);
  const [loadingState, setLoadingState] = useState('');
  const [routeError, setRouteError] = useState<string | null>(null);
  const [allRoutes, setAllRoutes] = useState<any[]>([]);
  const [userLocation, setUserLocation] = useState<Location.LocationObject | null>(null);
  const [isSearchExpanded, setIsSearchExpanded] = useState(true);
  const [isSheetCollapsed, setIsSheetCollapsed] = useState(false);
  const [isSheetDismissed, setIsSheetDismissed] = useState(false);
  const [isMarkingDestination, setIsMarkingDestination] = useState(false);
  const [isMarkingOrigin, setIsMarkingOrigin] = useState(false);
  const [contextPinCoords, setContextPinCoords] = useState<{ lat: number; lon: number; label: string } | null>(null);
  const [isRerouteModalVisible, setIsRerouteModalVisible] = useState(false);
  const [routeCalculationId, setRouteCalculationId] = useState(0);
  const [routeGeneration, setRouteGeneration] = useState(0);
  const routeGenerationRef = useRef(0);
  const offRouteCountRef = useRef(0);
  const isReroutingRef = useRef(false);
  const lastCalculatedEndpointsRef = useRef<string>('');
  const [mapFocusKey, setMapFocusKey] = useState(0);
  const [mapResetKey, setMapResetKey] = useState(0);
  // Saved camera region to restore after MapView remount
  const savedCameraRegionRef = useRef<{ latitude: number; longitude: number; latitudeDelta: number; longitudeDelta: number } | null>(null);

  useFocusEffect(
    React.useCallback(() => {
      setMapFocusKey((prev) => prev + 1);
    }, [])
  );

  const [tracksViewChanges, setTracksViewChanges] = useState(true);
  // Controls whether origin full input is visible in search mode (default: collapsed to quick-row)
  const [showOriginInput, setShowOriginInput] = useState(false);

  useEffect(() => {
    setTracksViewChanges(true);
    const timer = setTimeout(() => {
      setTracksViewChanges(false);
    }, 2500);
    return () => clearTimeout(timer);
  }, [destination, origin, allRoutes.length]);

  // When choosing another destination or origin, remove previous route lines immediately
  useEffect(() => {
    // Every time destination or origin changes, nuke old routes synchronously
    if (allRoutes.length > 0) {
      routeGenerationRef.current += 1;
      setRouteCalculationId((prev) => prev + 1);
      setRouteGeneration((g) => g + 1);
      setAllRoutes([]);
      clearStoreState();
    }
  }, [destination?.lat, destination?.lon, origin?.lat, origin?.lon]);

  const comparisons = useWeatherStore((s) => s.comparisons);
  const selectedRouteIndex = useWeatherStore((s) => s.selectedRouteIndex);
  const clearStoreState = useWeatherStore((s) => s.clearRouteState);
  const setRouteLabels = useWeatherStore((s) => s.setRouteLabels);
  const { isAnalyzing, compareRoutes, selectRoute, summary } = useWeatherAlerts();
  const mapRef = useRef<MapViewRef>(null);

  // Navigation Mode States
  const [isNavigating, setIsNavigating] = useState(false);
  const [isArrived, setIsArrived] = useState(false);
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
      // 2D UrlTile raster layers require pitch: 0; pitch > 0 causes react-native-maps to drop the tile layer into a blank white canvas
      mapRef.current.animateToRegion(
        {
          latitude: coord.lat,
          longitude: coord.lon,
          latitudeDelta: 0.008,
          longitudeDelta: 0.008,
        },
        duration
      );

      if (typeof (mapRef.current as any).animateCamera === 'function') {
        (mapRef.current as any).animateCamera(
          {
            center: { latitude: coord.lat, longitude: coord.lon },
            pitch: 0,
            heading: isNavigating ? heading : 0,
            zoom: 16,
          },
          { duration }
        );
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
    setIsArrived(false);
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

  const nudgeMapRepaint = () => {
    // Save the current visible region so we can restore it after remount
    if (userLocation) {
      savedCameraRegionRef.current = {
        latitude: userLocation.coords.latitude,
        longitude: userLocation.coords.longitude,
        latitudeDelta: 0.05,
        longitudeDelta: 0.05,
      };
    }
    // Increment mapResetKey to force MapView to fully remount and discard all native polyline overlays
    setMapResetKey((k) => k + 1);
  };

  // Wipes routes, comparisons, and map overlays. No navigation logic here,
  // and it never calls handleExitNavigation — this is the one place state actually gets cleared.
  const resetRouteAndMapState = () => {
    setAllRoutes([]);
    clearStoreState();
    setLoadingState('');
    setRouteGeneration((g) => g + 1);
    nudgeMapRepaint();
  };

  const handleExitNavigation = (shouldClearSession?: boolean | any) => {
    lastWarnedHazardKeyRef.current = '';
    setIsNavigating(false);
    setIsSimulating(false);
    setIsArrived(false);
    if (simulationIntervalRef.current) {
      clearInterval(simulationIntervalRef.current);
      simulationIntervalRef.current = null;
    }
    if (locationSubscriptionRef.current) {
      locationSubscriptionRef.current.remove();
      locationSubscriptionRef.current = null;
    }

    setDriverCoord(null);
    setCurrentStepIndex(0);
    setSimulatedCoordIndex(0);

    resetRouteAndMapState(); // <-- calls the shared helper, not clearRouteState

    // Clear endpoints and reset search UI so the app is fully fresh
    setOrigin(null);
    setDestination(null);
    setIsSearchExpanded(true);
    setIsSheetCollapsed(false);
    setIsSheetDismissed(false);
    lastCalculatedEndpointsRef.current = '';

    if (typeof (mapRef.current as any)?.animateCamera === 'function') {
      (mapRef.current as any).animateCamera({ pitch: 0, heading: 0 });
    }
    if (userLocation) {
      mapRef.current?.animateToRegion({
        latitude: userLocation.coords.latitude,
        longitude: userLocation.coords.longitude,
        latitudeDelta: 0.05,
        longitudeDelta: 0.05,
      });
    }
  };

  const handleRouteOverview = () => {
    if (allRoutes[selectedRouteIndex]) {
      const points = allRoutes[selectedRouteIndex].coordinates.map((p: any) => ({
        latitude: p.lat,
        longitude: p.lon,
      }));
      if (typeof (mapRef.current as any)?.animateCamera === 'function') {
        (mapRef.current as any).animateCamera({ pitch: 0, heading: 0 });
      }
      mapRef.current?.fitToCoordinates(points, {
        edgePadding: { top: 120, right: 80, bottom: 280, left: 80 },
        animated: true,
      });
    }
  };

  const handleExitAndPlanNewRoute = (newDest?: Point) => {
    const startPoint = driverCoord || (userLocation ? { lat: userLocation.coords.latitude, lon: userLocation.coords.longitude } : origin);
    handleExitNavigation(false);
    resetRouteAndMapState();
    if (startPoint) {
      setOrigin({ lat: startPoint.lat, lon: startPoint.lon, label: 'Current Location' });
    }
    if (newDest) {
      setDestination(newDest);
    }
    setIsSearchExpanded(true);
  };

  const handleRecenterCamera = () => {
    if (!driverCoord) return;
    animateMapToDriver(driverCoord, driverHeading, 600);
  };

  const clearRouteState = () => {
    if (isNavigating) {
      handleExitNavigation(); // this will call resetRouteAndMapState() on its own
      return;
    }
    resetRouteAndMapState();
  };

  // Handle Android hardware/system back button during active navigation
  useEffect(() => {
    if (!isNavigating) return;

    const backAction = () => {
      Alert.alert(
        'End Navigation?',
        'Do you want to stop current navigation?',
        [
          { text: 'Keep Driving', style: 'cancel' },
          { text: 'End Trip', style: 'destructive', onPress: () => handleExitNavigation(true) },
        ]
      );
      return true;
    };

    const backHandler = BackHandler.addEventListener('hardwareBackPress', backAction);
    return () => backHandler.remove();
  }, [isNavigating]);

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
          setIsArrived(true);
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

            // Destination arrival detection in live navigation
            if (destination && !isArrived) {
              const distToDest = haversineDistanceMeters(newCoord, { lat: destination.lat, lon: destination.lon });
              if (distToDest < 40) {
                speakGuidance('You have reached your destination.', isMuted);
                setIsArrived(true);
              }
            }

            // Automatic Off-Route Detection (> 75m deviation from planned route)
            if (activeRoute?.coordinates && activeRoute.coordinates.length > 1 && destination && !isReroutingRef.current) {
              let minDistance = Infinity;
              const coords = activeRoute.coordinates;
              const stepInterval = Math.max(1, Math.floor(coords.length / 40));
              for (let i = 0; i < coords.length; i += stepInterval) {
                const d = haversineDistanceMeters(newCoord, coords[i]);
                if (d < minDistance) minDistance = d;
              }

              if (minDistance > 75) {
                offRouteCountRef.current += 1;
                if (offRouteCountRef.current >= 4) {
                  offRouteCountRef.current = 0;
                  isReroutingRef.current = true;
                  speakGuidance('Recalculating route...', isMuted);
                  fetchAlternativeRoutes(newCoord, { lat: destination.lat, lon: destination.lon })
                    .then((newRoutes) => {
                      if (newRoutes && newRoutes.length > 0) {
                        const sorted = [...newRoutes].sort((a, b) => a.totalDurationMinutes - b.totalDurationMinutes);
                        setRouteGeneration((g) => g + 1);
                        setAllRoutes(sorted);
                        setCurrentStepIndex(0);
                        const firstStep = sorted[0]?.steps?.[0];
                        if (firstStep) speakGuidance(firstStep.instruction, isMuted);
                      }
                    })
                    .catch((err) => console.warn('Auto reroute failed:', err))
                    .finally(() => {
                      isReroutingRef.current = false;
                    });
                }
              } else {
                offRouteCountRef.current = 0;
              }
            }
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
          // Auto-populate origin if not already set by the user
          setOrigin((prev) => prev ?? { lat: lastKnown.coords.latitude, lon: lastKnown.coords.longitude, label: 'Current Location' });
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
          // Silently refine origin to fresh GPS coords if it is still the auto-set GPS default
          setOrigin((prev) => {
            if (!prev || prev.label === 'Current Location') {
              return { lat: location.coords.latitude, lon: location.coords.longitude, label: 'Current Location' };
            }
            return prev;
          });
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

    // 3. INSTANT UI FEEDBACK: set origin immediately with cached coords
    //    No loading spinner, no blocking. The user sees "Current Location" right away.
    setOrigin({ lat: latitude, lon: longitude, label: 'Current Location' });

    // 4. BACKGROUND REFINEMENT: improve coords + resolve address asynchronously
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

  /**
   * Drops a destination pin at tapped/selected coordinates on the map,
   * animates camera to that location, and reverse-geocodes to get a human-friendly address.
   */
  const markDestinationAtCoords = async (latitude: number, longitude: number) => {
    setRouteGeneration((g) => g + 1);
    setAllRoutes([]);
    clearStoreState();
    setIsMarkingDestination(false);
    setIsSearchExpanded(true);

    const initialLabel = `Marked Location (${latitude.toFixed(4)}, ${longitude.toFixed(4)})`;
    setDestination({
      lat: latitude,
      lon: longitude,
      label: initialLabel,
    });

    mapRef.current?.animateToRegion(
      {
        latitude,
        longitude,
        latitudeDelta: 0.015,
        longitudeDelta: 0.015,
      },
      500
    );

    try {
      let response: Response;
      try {
        response = await fetch(
          `${NOMINATIM_BASE}/reverse?lat=${latitude}&lon=${longitude}&format=json`
        );
        if (!response.ok) throw new Error('Proxy reverse failed');
      } catch {
        const directUrl = `https://nominatim.openstreetmap.org/reverse?lat=${latitude}&lon=${longitude}&format=json`;
        response = await fetch(directUrl, {
          headers: { 'User-Agent': 'WeatherWiseApp/1.0' },
        });
      }

      const data = await response.json();
      if (data && data.display_name) {
        const segments = data.display_name.split(',').map((s: string) => s.trim());
        const cleanLabel = segments.length > 3
          ? `${segments[0]}, ${segments[segments.length - 1]}`
          : segments.length > 2
            ? `${segments[0]}, ${segments[1]}, ${segments[2]}`
            : data.display_name;

        setDestination({
          lat: latitude,
          lon: longitude,
          label: cleanLabel,
        });
      }
    } catch {
      // Retain coordinate fallback label if network/reverse geocoding fails
    }
  };

  /**
   * Drops an origin pin at tapped/selected coordinates on the map,
   * animates camera to that location, and reverse-geocodes to get a human-friendly address.
   */
  const markOriginAtCoords = async (latitude: number, longitude: number) => {
    setRouteGeneration((g) => g + 1);
    setAllRoutes([]);
    clearStoreState();
    setIsMarkingOrigin(false);
    setIsSearchExpanded(true);

    const initialLabel = `Marked Start (${latitude.toFixed(4)}, ${longitude.toFixed(4)})`;
    setOrigin({
      lat: latitude,
      lon: longitude,
      label: initialLabel,
    });

    mapRef.current?.animateToRegion(
      {
        latitude,
        longitude,
        latitudeDelta: 0.015,
        longitudeDelta: 0.015,
      },
      500
    );

    try {
      let response: Response;
      try {
        response = await fetch(
          `${NOMINATIM_BASE}/reverse?lat=${latitude}&lon=${longitude}&format=json`
        );
        if (!response.ok) throw new Error('Proxy reverse failed');
      } catch {
        const directUrl = `https://nominatim.openstreetmap.org/reverse?lat=${latitude}&lon=${longitude}&format=json`;
        response = await fetch(directUrl, {
          headers: { 'User-Agent': 'WeatherWiseApp/1.0' },
        });
      }

      const data = await response.json();
      if (data && data.display_name) {
        const segments = data.display_name.split(',').map((s: string) => s.trim());
        const cleanLabel = segments.length > 3
          ? `${segments[0]}, ${segments[segments.length - 1]}`
          : segments.length > 2
            ? `${segments[0]}, ${segments[1]}, ${segments[2]}`
            : data.display_name;

        setOrigin({
          lat: latitude,
          lon: longitude,
          label: cleanLabel,
        });
      }
    } catch {
      // Retain coordinate fallback label if network/reverse geocoding fails
    }
  };

  const handleSwapEndpoints = () => {
    if (!origin && !destination) return;
    setRouteCalculationId((prev) => prev + 1);
    setRouteGeneration((g) => g + 1);
    setAllRoutes([]);
    clearStoreState();
    const tempOrigin = origin;
    const tempDest = destination;
    setOrigin(tempDest);
    setDestination(tempOrigin);
  };

  const handleGetRoute = async () => {
    if (!origin || !destination) {
      Alert.alert('Missing Info', 'Please select both origin and destination.');
      setRouteError('Please select both an origin and destination location.');
      return;
    }

    setRouteGeneration((g) => g + 1); // new trip = new generation, drops any leftover views
    // Bump generation so any in-flight previous fetch becomes stale
    const thisGeneration = ++routeGenerationRef.current;

    // Immediately remove all previous route lines, markers, hazard overlays, and comparison data
    setRouteCalculationId((prev) => prev + 1);
    setAllRoutes([]);
    clearStoreState();
    setContextPinCoords(null);
    lastWarnedHazardKeyRef.current = '';

    lastCalculatedEndpointsRef.current = `${origin.lat.toFixed(4)},${origin.lon.toFixed(4)}->${destination.lat.toFixed(4)},${destination.lon.toFixed(4)}`;
    setRouteError(null);
    setLoadingState(' Calculating route...');
    try {
      const fetchedRoutes = await fetchAlternativeRoutes(
        { lat: origin.lat, lon: origin.lon },
        { lat: destination.lat, lon: destination.lon }
      );

      // If a newer calculation was started while we were fetching, discard these results
      if (routeGenerationRef.current !== thisGeneration) return;

      // Sort by duration (fastest first) and limit to 3 total
      const sortedRoutes = fetchedRoutes
        .sort((a, b) => a.totalDurationMinutes - b.totalDurationMinutes)
        .slice(0, 3);

      setAllRoutes(sortedRoutes);
      setRouteLabels(origin.label, destination.label);

      setLoadingState('Checking weather along route...');
      const comparisonResults = await compareRoutes(sortedRoutes);

      // Check again after weather analysis — another calculation may have started
      if (routeGenerationRef.current !== thisGeneration) return;

      setLoadingState('Routes ready');
      setIsSearchExpanded(false);
      setIsSheetCollapsed(false);
      setIsSheetDismissed(false);
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
      if (routeGenerationRef.current !== thisGeneration) return;
      setRouteError(error.message || 'Could not fetch routes. Please check network connection.');
      setLoadingState('');
    }
  };

  // Auto-calculate routes when both origin and destination are set (debounced by 600ms)
  useEffect(() => {
    if (isNavigating || !origin || !destination) return;
    const currentKey = `${origin.lat.toFixed(4)},${origin.lon.toFixed(4)}->${destination.lat.toFixed(4)},${destination.lon.toFixed(4)}`;
    if (lastCalculatedEndpointsRef.current === currentKey) return;

    const timer = setTimeout(() => {
      lastCalculatedEndpointsRef.current = currentKey;
      handleGetRoute();
    }, 600);

    return () => clearTimeout(timer);
  }, [origin?.lat, origin?.lon, destination?.lat, destination?.lon, isNavigating]);

  // In-drive dynamic rerouting (OpenStreetMap navigation style)
  const handleInDriveReroute = async (newDest: { lat: number; lon: number; label: string }) => {
    setIsRerouteModalVisible(false);
    const startPoint = driverCoord || (userLocation ? { lat: userLocation.coords.latitude, lon: userLocation.coords.longitude } : origin);
    if (!startPoint) {
      Alert.alert('Location Error', 'Unable to determine vehicle location for rerouting.');
      return;
    }

    setLoadingState('Rerouting...');
    speakGuidance(`Rerouting to ${newDest.label.split(',')[0]}.`, isMuted);

    try {
      const fetchedRoutes = await fetchAlternativeRoutes(startPoint, { lat: newDest.lat, lon: newDest.lon });
      if (!fetchedRoutes || fetchedRoutes.length === 0) {
        Alert.alert('Route Error', 'Could not find a valid route to the new destination.');
        setLoadingState('');
        return;
      }

      const sortedRoutes = [...fetchedRoutes].sort((a, b) => a.totalDurationMinutes - b.totalDurationMinutes);
      setRouteGeneration((g) => g + 1);
      setAllRoutes(sortedRoutes);
      setDestination(newDest);
      setRouteLabels('Current Position', newDest.label);
      setCurrentStepIndex(0);
      setSimulatedCoordIndex(0);

      compareRoutes(sortedRoutes).catch((err) => console.warn('Reroute weather comparison error:', err));

      const firstStep = sortedRoutes[0]?.steps?.[0];
      if (firstStep) {
        speakGuidance(firstStep.instruction, isMuted);
      }
    } catch (e: any) {
      console.warn('In-drive rerouting error:', e);
      Alert.alert('Reroute Failed', 'Unable to calculate new route. Continuing on current route.');
    } finally {
      setLoadingState('');
    }
  };

  const currentRoute = allRoutes[selectedRouteIndex];
  const currentComparison = comparisons.find(c => c.routeIndex === selectedRouteIndex) || comparisons[0];
  const currentRiskColor = currentComparison?.overallRisk === 'high'
    ? COLORS.red
    : currentComparison?.overallRisk === 'moderate'
      ? COLORS.yellow
      : COLORS.green;

  const riskRank = { clear: 0, moderate: 1, high: 2 } as const;
  const saferAlternative = isNavigating && currentComparison
    ? comparisons.find(
      (c) => c.routeIndex !== selectedRouteIndex && riskRank[c.overallRisk] < riskRank[currentComparison.overallRisk]
    )
    : undefined;

  const handleAcceptSaferRoute = () => {
    if (!saferAlternative) return;
    speakGuidance('Switching to safer route.', isMuted);
    selectRoute(saferAlternative.routeIndex);
  };

  // Road condition & traffic analysis (congestion, floods, road hazards)
  const currentRoadConditions = useMemo(() => {
    if (!currentRoute) return null;
    return analyzeRouteRoadConditions(currentRoute, currentComparison?.alerts || []);
  }, [currentRoute, currentComparison]);

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

  const routeCumulativeKm = useMemo(() => {
    const coords = currentRoute?.coordinates;
    if (!coords || coords.length === 0) return [];
    const cum: number[] = [0];
    for (let i = 1; i < coords.length; i++) {
      cum.push(cum[i - 1] + haversineDistanceMeters(coords[i - 1], coords[i]) / 1000);
    }
    return cum;
  }, [currentRoute]);


  const { remainingDistanceKm, remainingDurationMinutes } = useMemo(() => {
    const coords = currentRoute?.coordinates;
    if (!coords || coords.length === 0 || !driverCoord || routeCumulativeKm.length === 0) {
      return {
        remainingDistanceKm: currentRoute?.totalDistanceKm || 0,
        remainingDurationMinutes: currentRoute?.totalDurationMinutes || 0,
      };
    }

    let nearestIdx = 0;
    let minDist = Infinity;
    for (let i = 0; i < coords.length; i++) {
      const d = haversineDistanceMeters(driverCoord, coords[i]);
      if (d < minDist) { minDist = d; nearestIdx = i; }
    }

    const totalKm = currentRoute!.totalDistanceKm;
    const traveledKm = routeCumulativeKm[nearestIdx];
    const progressRatio = totalKm > 0 ? Math.min(1, traveledKm / totalKm) : 0;

    return {
      remainingDistanceKm: Math.max(0, totalKm - traveledKm),
      remainingDurationMinutes: Math.max(0, currentRoute!.totalDurationMinutes * (1 - progressRatio)),
    };
  }, [currentRoute, driverCoord, routeCumulativeKm]);

  const upcomingHazard = driverCoord
    ? findUpcomingHazard(driverCoord, currentComparison?.alerts || [])
    : null;

  const upcomingRoadHazard = driverCoord && currentRoadConditions
    ? currentRoadConditions.roadEvents.reduce<{ event: RoadEvent; distanceKm: number } | null>((closest, ev) => {
      const d = haversineDistanceMeters(driverCoord, { lat: ev.lat, lon: ev.lon }) / 1000;
      if (d <= 25 && (!closest || d < closest.distanceKm)) {
        return { event: ev, distanceKm: d };
      }
      return closest;
    }, null)
    : null;

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

  // Compute active navigation references for destination and driver position
  const activeNavRoute = allRoutes[selectedRouteIndex];
  const targetDestination = destination
    ? { latitude: destination.lat, longitude: destination.lon, label: destination.label }
    : activeNavRoute?.coordinates?.length
      ? {
        latitude: activeNavRoute.coordinates[activeNavRoute.coordinates.length - 1].lat,
        longitude: activeNavRoute.coordinates[activeNavRoute.coordinates.length - 1].lon,
        label: 'Destination',
      }
      : null;

  const currentDriverPos = isNavigating
    ? driverCoord
      ? { latitude: driverCoord.lat, longitude: driverCoord.lon }
      : activeNavRoute?.coordinates?.length
        ? { latitude: activeNavRoute.coordinates[0].lat, longitude: activeNavRoute.coordinates[0].lon }
        : userLocation
          ? { latitude: userLocation.coords.latitude, longitude: userLocation.coords.longitude }
          : null
    : null;

  return (
    <View style={styles.container}>
      <MapView
        key={`map-${mapResetKey}`}
        ref={mapRef}
        style={styles.map}
        initialRegion={DEFAULT_REGION}
        showsUserLocation={!isNavigating}
        showsMyLocationButton={!isNavigating}
        mapType="none"
        pitchEnabled={false}
        onMapReady={() => {
          // After remount, restore camera to saved position so map doesn't jump to default
          if (savedCameraRegionRef.current) {
            mapRef.current?.animateToRegion(savedCameraRegionRef.current, 1);
            savedCameraRegionRef.current = null;
          }
        }}
        onPress={(e) => {
          const { latitude, longitude } = e.nativeEvent.coordinate;
          if (isMarkingOrigin) {
            markOriginAtCoords(latitude, longitude);
          } else if (isMarkingDestination) {
            markDestinationAtCoords(latitude, longitude);
          } else if (contextPinCoords) {
            setContextPinCoords(null);
          }
        }}
        onLongPress={async (e) => {
          const { latitude, longitude } = e.nativeEvent.coordinate;
          const fallbackLabel = `Location (${latitude.toFixed(4)}, ${longitude.toFixed(4)})`;
          setContextPinCoords({ lat: latitude, lon: longitude, label: fallbackLabel });

          try {
            let response: Response;
            try {
              response = await fetch(`${NOMINATIM_BASE}/reverse?lat=${latitude}&lon=${longitude}&format=json`);
              if (!response.ok) throw new Error('Proxy reverse failed');
            } catch {
              response = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${latitude}&lon=${longitude}&format=json`, {
                headers: { 'User-Agent': 'WeatherWiseApp/1.0' },
              });
            }
            const data = await response.json();
            if (data && data.display_name) {
              const segments = data.display_name.split(',').map((s: string) => s.trim());
              const clean = segments.length > 2 ? `${segments[0]}, ${segments[1]}` : data.display_name;
              setContextPinCoords({ lat: latitude, lon: longitude, label: clean });
            }
          } catch { }
        }}
      >
        {/* OpenStreetMap / CARTO Basemap Layer (100% Free, NO Access Blocked, NO Google Billing Needed) */}
        <UrlTile
          urlTemplate="https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png"
          maximumZ={19}
          flipY={false}
          tileSize={256}
        />
        {/* Context Pin for Map Long-Press Selection */}
        {contextPinCoords && !isNavigating && (
          <Marker
            coordinate={{ latitude: contextPinCoords.lat, longitude: contextPinCoords.lon }}
            title={contextPinCoords.label}
            pinColor={COLORS.electricBlue}
            zIndex={250}
          />
        )}
        {/* Route Polylines — stable slots so native overlays update in-place instead of unmounting/ghosting */}
        {[0, 1, 2].map((slotIndex) => {
          const route = allRoutes[slotIndex];
          const isVisible = !!route && !isNavigating;
          const isSelectedSlot = !!route && selectedRouteIndex === slotIndex;

          // Unselected alternative
          if (route && !isSelectedSlot) {
            return (
              <Polyline
                key={`slot-${routeGeneration}-${slotIndex}`}
                coordinates={isVisible ? route.coordinates.map((p: any) => ({ latitude: p.lat, longitude: p.lon })) : []}
                strokeWidth={isVisible ? 4 : 0}
                strokeColor={isVisible ? 'rgba(100, 116, 139, 0.4)' : 'transparent'}
                lineDashPattern={isVisible ? [5, 5] : undefined}
                zIndex={5 + slotIndex}
                tappable={isVisible}
                onPress={() => isVisible && selectRoute(slotIndex)}
              />
            );
          }

          // Selected route — if segmented by road conditions, render the first segment; rest below
          if (route && isSelectedSlot) {
            if (!currentRoadConditions || currentRoadConditions.segments.length === 0) {
              return (
                <Polyline
                  key={`slot-${routeGeneration}-${slotIndex}`}
                  coordinates={route.coordinates.map((p: any) => ({ latitude: p.lat, longitude: p.lon }))}
                  strokeWidth={6}
                  strokeColor={TRAFFIC_COLORS.free}
                  zIndex={10}
                />
              );
            }
            // segmented — return null here; segments rendered below
            return null;
          }

          // Empty slot — invisible placeholder; keyed by generation so it remounts on new search
          return (
            <Polyline
              key={`slot-${routeGeneration}-${slotIndex}`}
              coordinates={[]}
              strokeWidth={0}
              strokeColor="transparent"
            />
          );
        })}

        {/* Traffic/Road-condition segments for the selected route */}
        {allRoutes[selectedRouteIndex] && currentRoadConditions && currentRoadConditions.segments.length > 0 &&
          currentRoadConditions.segments.map((seg: any) => (
            <Polyline
              key={`seg-${routeGeneration}-${seg.id}`}
              coordinates={seg.coordinates.map((p: any) => ({ latitude: p.lat, longitude: p.lon }))}
              strokeWidth={seg.condition === 'flooded' ? 8 : 6}
              strokeColor={seg.color}
              zIndex={seg.condition === 'flooded' ? 15 : 10}
            />
          ))
        }

        {/* Weather Markers along route (sun, rain, cloud icons) */}
        {currentComparison?.alerts?.map((alert, index) => {
          const emoji = getWeatherEmoji(alert.weatherCode);
          const markerColor = alert.severity === 'high' ? COLORS.red : alert.severity === 'moderate' ? COLORS.yellow : COLORS.green;
          return (
            <Marker
              key={`calc-${routeCalculationId}-alert-${index}`}
              coordinate={{ latitude: alert.lat, longitude: alert.lon }}
              title={`Weather: ${alert.label}`}
              description={`${alert.precipitationProbability}% rain · in ${alert.minutesFromNow} min`}
            >
              <View style={[styles.alertMarker, { borderColor: markerColor, borderWidth: 2, borderRadius: 20, backgroundColor: 'rgba(15,23,42,0.85)', padding: 4 }]}>
                <Text style={{ fontSize: 20 }}>{emoji}</Text>
              </View>
            </Marker>
          );
        })}

        {/* Road Hazard Markers: Floods, Accidents, Congestion */}
        {currentRoadConditions?.roadEvents?.map((event) => (
          <Marker
            key={`calc-${routeCalculationId}-event-${event.id}`}
            coordinate={{ latitude: event.lat, longitude: event.lon }}
            title={event.title}
            description={event.description}
            zIndex={30}
          >
            <View style={[styles.roadEventMarker, { borderColor: event.color }]}>
              <Text style={{ fontSize: 18 }}>{event.icon}</Text>
            </View>
          </Marker>
        ))}

        {/* Origin Marker */}
        {origin && !isNavigating && (
          <Marker
            key={`origin-${origin.lat}-${origin.lon}`}
            coordinate={{ latitude: origin.lat, longitude: origin.lon }}
            title="Origin"
            description={origin.label}
            zIndex={190}
            anchor={{ x: 0.5, y: 1 }}
            tracksViewChanges={tracksViewChanges}
          >
            <View style={styles.originMarkerContainer} collapsable={false}>
              <View style={styles.originMarkerBadge}>
                <MaterialCommunityIcons name="map-marker-radius" size={18} color={COLORS.white} />
              </View>
              <View style={styles.originMarkerPointer} />
            </View>
          </Marker>
        )}

        {/* Destination Marker - Always visible whenever destination or route is set */}
        {targetDestination && (
          <Marker
            key={`destination-${targetDestination.latitude.toFixed(4)}-${targetDestination.longitude.toFixed(4)}`}
            coordinate={{ latitude: targetDestination.latitude, longitude: targetDestination.longitude }}
            title="Destination"
            description={targetDestination.label}
            zIndex={900}
            anchor={{ x: 0.5, y: 1 }}
            tracksViewChanges={true}
          >
            <View style={styles.destinationMarkerContainer} collapsable={false}>
              <View style={styles.destinationLabelPill}>
                <Text style={styles.destinationLabelPillText}>DESTINATION</Text>
              </View>
              <View style={styles.destinationMarkerBadge}>
                <MaterialCommunityIcons name="flag-checkered" size={22} color={COLORS.white} />
              </View>
              <View style={styles.destinationMarkerPointer} />
            </View>
          </Marker>
        )}

        {/* User Location Marker when not navigating */}
        {!isNavigating && userLocation && (
          <Marker
            coordinate={{ latitude: userLocation.coords.latitude, longitude: userLocation.coords.longitude }}
            title="You"
            pinColor={COLORS.electricBlue}
          />
        )}

        {/* Active Driver Navigation Marker */}
        {isNavigating && currentDriverPos && (
          <Marker
            key="active-driver-vehicle"
            coordinate={currentDriverPos}
            anchor={{ x: 0.5, y: 0.5 }}
            tracksViewChanges={true}
            zIndex={999}
          >
            <View style={styles.navVehicleContainer} collapsable={false}>
              <View style={styles.navVehiclePulse} />
              <View
                style={[
                  styles.navVehicleIcon,
                  { transform: [{ rotate: `${driverHeading}deg` }] },
                ]}
              >
                <MaterialCommunityIcons name="navigation" size={24} color={COLORS.white} />
              </View>
            </View>
          </Marker>
        )}
      </MapView>

      {/* Tap Map to Mark Origin or Destination Floating Banner */}
      {(isMarkingDestination || isMarkingOrigin) && !isNavigating && (
        <View style={[styles.markingBanner, { top: insets.top + (isSearchExpanded && allRoutes.length === 0 ? 210 : 64) }]}>
          <BlurView intensity={90} tint="dark" style={styles.markingBannerBlur}>
            <MaterialCommunityIcons
              name={isMarkingOrigin ? "map-marker-radius" : "map-marker-plus"}
              size={20}
              color={isMarkingOrigin ? COLORS.electricBlue : "#EF4444"}
              style={{ marginRight: 8 }}
            />
            <Text style={styles.markingBannerText}>
              {isMarkingOrigin ? "Tap map to set Starting Point" : "Tap map to set Destination"}
            </Text>
            <TouchableOpacity
              style={styles.markingCancelBtn}
              onPress={() => {
                setIsMarkingDestination(false);
                setIsMarkingOrigin(false);
              }}
              accessible={true}
              accessibilityRole="button"
              accessibilityLabel="Cancel map marking"
            >
              <MaterialCommunityIcons name="close" size={16} color={COLORS.white} />
            </TouchableOpacity>
          </BlurView>
        </View>
      )}

      {/* Interactive Context Pin Card (Long-Press anywhere on Map) */}
      {contextPinCoords && (
        <View style={styles.contextPinCardContainer}>
          <BlurView intensity={95} tint="dark" style={styles.contextPinCard}>
            <View style={styles.contextPinHeader}>
              <MaterialCommunityIcons name="map-marker" size={20} color={COLORS.electricBlue} style={{ marginRight: 8 }} />
              <Text style={styles.contextPinTitle} numberOfLines={1}>
                {contextPinCoords.label}
              </Text>
              <TouchableOpacity
                onPress={() => setContextPinCoords(null)}
                style={styles.contextPinCloseBtn}
                accessible={true}
                accessibilityRole="button"
                accessibilityLabel="Close pin selector"
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <MaterialCommunityIcons name="close" size={18} color={COLORS.textMuted} />
              </TouchableOpacity>
            </View>

            {isNavigating ? (
              <View style={styles.contextPinActionsRow}>
                <TouchableOpacity
                  style={styles.contextPinOriginBtn}
                  onPress={() => {
                    const pt = contextPinCoords;
                    setContextPinCoords(null);
                    handleInDriveReroute(pt);
                  }}
                  accessible={true}
                  accessibilityRole="button"
                  accessibilityLabel="Reroute mid-drive to this point"
                  activeOpacity={0.8}
                >
                  <MaterialCommunityIcons name="navigation" size={16} color={COLORS.white} style={{ marginRight: 6 }} />
                  <Text style={styles.contextPinOriginBtnText}>Reroute Mid-Drive</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.contextPinDestBtn}
                  onPress={() => {
                    const pt = contextPinCoords;
                    setContextPinCoords(null);
                    handleExitAndPlanNewRoute(pt);
                  }}
                  accessible={true}
                  accessibilityRole="button"
                  accessibilityLabel="Exit and plan route to this point"
                  activeOpacity={0.8}
                >
                  <MaterialCommunityIcons name="routes" size={16} color={COLORS.white} style={{ marginRight: 6 }} />
                  <Text style={styles.contextPinDestBtnText}>Exit & Compare</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <View style={styles.contextPinActionsRow}>
                <TouchableOpacity
                  style={styles.contextPinOriginBtn}
                  onPress={() => {
                    routeGenerationRef.current += 1;
                    setRouteCalculationId((prev) => prev + 1);
                    setRouteGeneration((g) => g + 1);
                    setAllRoutes([]);
                    clearStoreState();
                    setOrigin({ lat: contextPinCoords.lat, lon: contextPinCoords.lon, label: contextPinCoords.label });
                    setContextPinCoords(null);
                  }}
                  accessible={true}
                  accessibilityRole="button"
                  accessibilityLabel="Set as starting location"
                  activeOpacity={0.8}
                >
                  <MaterialCommunityIcons name="map-marker-radius" size={16} color={COLORS.white} style={{ marginRight: 6 }} />
                  <Text style={styles.contextPinOriginBtnText}>Set as Start</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.contextPinDestBtn}
                  onPress={() => {
                    routeGenerationRef.current += 1;
                    setRouteCalculationId((prev) => prev + 1);
                    setRouteGeneration((g) => g + 1);
                    setAllRoutes([]);
                    clearStoreState();
                    setDestination({ lat: contextPinCoords.lat, lon: contextPinCoords.lon, label: contextPinCoords.label });
                    setContextPinCoords(null);
                  }}
                  accessible={true}
                  accessibilityRole="button"
                  accessibilityLabel="Set as destination"
                  activeOpacity={0.8}
                >
                  <MaterialCommunityIcons name="flag-checkered" size={16} color={COLORS.white} style={{ marginRight: 6 }} />
                  <Text style={styles.contextPinDestBtnText}>Set as Destination</Text>
                </TouchableOpacity>
              </View>
            )}
          </BlurView>
        </View>
      )}

      {/* TRAFFIC & ROAD CONDITION LEGEND */}
      {!isNavigating && allRoutes.length > 0 && (
        <View style={[styles.trafficLegendWrapper, { top: insets.top + (allRoutes.length > 0 && !isSearchExpanded ? 64 : 220) }]}>
          <BlurView intensity={85} tint="dark" style={styles.trafficLegendBlur}>
            <View style={styles.trafficLegendItem}>
              <View style={[styles.legendBar, { backgroundColor: TRAFFIC_COLORS.free }]} />
              <Text style={styles.legendText}>Fast</Text>
            </View>
            <View style={styles.trafficLegendItem}>
              <View style={[styles.legendBar, { backgroundColor: TRAFFIC_COLORS.moderate }]} />
              <Text style={styles.legendText}>Moderate</Text>
            </View>
            <View style={styles.trafficLegendItem}>
              <View style={[styles.legendBar, { backgroundColor: TRAFFIC_COLORS.heavy }]} />
              <Text style={styles.legendText}>Congested</Text>
            </View>
            <View style={styles.trafficLegendItem}>
              <View style={[styles.legendBar, { backgroundColor: TRAFFIC_COLORS.flooded }]} />
              <Text style={styles.legendText}>Flooded</Text>
            </View>
          </BlurView>
        </View>
      )}

      {/* SEARCH PANEL — 3 states: Explore (pill) → Search (form) → Route Preview (compact bar) */}
      {!isNavigating && (
        <View style={[styles.inputWrapper, { top: insets.top + 8 }]}>

          {/* ── STATE 3: ROUTE PREVIEW — compact top bar when routes are ready ── */}
          {allRoutes.length > 0 && !isSearchExpanded ? (
            <BlurView intensity={90} tint="dark" style={styles.compactRouteBar}>
              <TouchableOpacity
                style={styles.compactClearBtn}
                onPress={clearRouteState}
                accessible={true}
                accessibilityRole="button"
                accessibilityLabel="Clear route and return to explore"
              >
                <MaterialCommunityIcons name="arrow-left" size={20} color={COLORS.white} />
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.compactContent}
                onPress={() => setIsSearchExpanded(true)}
                activeOpacity={0.7}
                accessible={true}
                accessibilityRole="button"
                accessibilityLabel="Edit route endpoints"
              >
                <View style={styles.compactEndpointsRow}>
                  <Text style={styles.compactOriginText} numberOfLines={1}>
                    {origin?.label?.split(',')[0] || 'Origin'}
                  </Text>
                  <MaterialCommunityIcons name="arrow-right-thin" size={16} color={COLORS.electricBlue} style={{ marginHorizontal: 6 }} />
                  <Text style={styles.compactDestText} numberOfLines={1}>
                    {destination?.label?.split(',')[0] || 'Destination'}
                  </Text>
                </View>
                <Text style={styles.compactSubtext}>Tap to edit locations</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.compactEditBtn}
                onPress={() => setIsSearchExpanded(true)}
                accessible={true}
                accessibilityRole="button"
                accessibilityLabel="Expand search panel"
              >
                <MaterialCommunityIcons name="pencil-outline" size={18} color={COLORS.electricBlue} />
              </TouchableOpacity>
            </BlurView>

          ) : isSearchExpanded ? (
            /* ── STATE 2: SEARCH / EDIT MODE — destination-first, origin secondary ── */
            <BlurView intensity={80} tint="dark" style={styles.blurContainer}>
              <View style={styles.inputContainer}>

                {/* Header row with back button */}
                <View style={styles.searchModeHeader}>
                  <TouchableOpacity
                    style={styles.backBtn}
                    onPress={() => {
                      setIsSearchExpanded(false);
                      setShowOriginInput(false);
                    }}
                    accessible={true}
                    accessibilityRole="button"
                    accessibilityLabel="Close search"
                  >
                    <MaterialCommunityIcons name="arrow-left" size={20} color={COLORS.white} />
                  </TouchableOpacity>
                  <Text style={styles.searchModeTitle}>
                    {allRoutes.length > 0 ? 'Edit Route' : 'Plan Route'}
                  </Text>
                  {allRoutes.length > 0 && (
                    <TouchableOpacity
                      onPress={() => { clearRouteState(); setIsSearchExpanded(false); setShowOriginInput(false); }}
                      accessible={true}
                      accessibilityRole="button"
                      accessibilityLabel="Clear route"
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <MaterialCommunityIcons name="close" size={18} color={COLORS.textMuted} />
                    </TouchableOpacity>
                  )}
                </View>

                {/* DESTINATION — primary, prominent input */}
                <LocationSearchInput
                  label="To"
                  placeholder="Where to?"
                  value={destination?.label || ''}
                  onSelect={(lat, lon, label) => {
                    setRouteGeneration((g) => g + 1);
                    setAllRoutes([]);
                    clearStoreState();
                    setDestination({ lat, lon, label });
                  }}
                  onClear={() => {
                    setRouteGeneration((g) => g + 1);
                    setAllRoutes([]);
                    clearStoreState();
                    setDestination(null);
                  }}
                  showMarkOnMapButton={true}
                  isMarkingOnMap={isMarkingDestination}
                  onMarkOnMapPress={() => {
                    setIsMarkingOrigin(false);
                    setIsMarkingDestination((prev) => !prev);
                  }}
                />

                {/* Divider with swap button */}
                <View style={styles.swapEndpointsRow}>
                  <Divider style={styles.swapDivider} />
                  <TouchableOpacity
                    style={styles.swapEndpointsBtn}
                    onPress={handleSwapEndpoints}
                    accessible={true}
                    accessibilityRole="button"
                    accessibilityLabel="Swap start and destination"
                    activeOpacity={0.7}
                  >
                    <MaterialCommunityIcons name="swap-vertical" size={20} color={COLORS.electricBlue} />
                  </TouchableOpacity>
                </View>

                {/* ORIGIN — collapsed to a quick-row by default, expandable */}
                {showOriginInput ? (
                  <LocationSearchInput
                    label="From"
                    placeholder="Starting point..."
                    value={origin?.label || ''}
                    onSelect={(lat, lon, label) => {
                      setRouteGeneration((g) => g + 1);
                      setAllRoutes([]);
                      clearStoreState();
                      setOrigin({ lat, lon, label });
                    }}
                    onClear={() => {
                      setRouteGeneration((g) => g + 1);
                      setAllRoutes([]);
                      clearStoreState();
                      setOrigin(null);
                    }}
                    showCurrentLocationButton={true}
                    onCurrentLocationPress={handleUseCurrentLocation}
                    showMarkOnMapButton={true}
                    isMarkingOnMap={isMarkingOrigin}
                    onMarkOnMapPress={() => {
                      setIsMarkingDestination(false);
                      setIsMarkingOrigin((prev) => !prev);
                    }}
                  />
                ) : (
                  <TouchableOpacity
                    style={styles.originQuickRow}
                    onPress={() => setShowOriginInput(true)}
                    activeOpacity={0.75}
                    accessible={true}
                    accessibilityRole="button"
                    accessibilityLabel={`Starting from: ${origin?.label?.split(',')[0] || 'Current Location'}. Tap to change.`}
                  >
                    <View style={styles.originQuickDot} />
                    <Text style={styles.originQuickLabel} numberOfLines={1}>
                      {origin?.label?.split(',')[0] || 'Current Location'}
                    </Text>
                    <Text style={styles.originQuickChange}>Change</Text>
                  </TouchableOpacity>
                )}

                {/* Loading indicator replaces the old "Compare Routes" button — auto-trigger handles calculation */}
                {(loadingState || isAnalyzing) && (
                  <View style={styles.autoCalcRow}>
                    <ActivityIndicator size="small" color={COLORS.electricBlue} style={{ marginRight: 8 }} />
                    <Text style={styles.autoCalcText}>{loadingState || 'Analyzing weather...'}</Text>
                  </View>
                )}
              </View>
            </BlurView>

          ) : (
            /* ── STATE 1: EXPLORE MODE — single Google Maps-style "Where to?" pill ── */
            <TouchableOpacity
              style={styles.whereToPill}
              onPress={() => setIsSearchExpanded(true)}
              activeOpacity={0.85}
              accessible={true}
              accessibilityRole="search"
              accessibilityLabel="Search for a destination"
            >
              <BlurView intensity={90} tint="dark" style={styles.whereToPillBlur}>
                <MaterialCommunityIcons name="magnify" size={20} color={COLORS.textMuted} style={{ marginRight: 10 }} />
                <Text style={styles.whereToPillText}>Where to?</Text>
                <MaterialCommunityIcons name="microphone-outline" size={18} color={COLORS.textMuted} />
              </BlurView>
            </TouchableOpacity>
          )}

          {/* Inline Route Error Banner */}
          {routeError && (
            <View style={styles.errorBanner} accessible={true} accessibilityRole="alert">
              <MaterialCommunityIcons name="alert-circle" size={18} color={COLORS.white} style={{ marginRight: 8 }} />
              <Text style={styles.errorText}>{routeError}</Text>
              <TouchableOpacity
                onPress={() => setRouteError(null)}
                accessibilityRole="button"
                accessibilityLabel="Dismiss error"
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <MaterialCommunityIcons name="close" size={18} color={COLORS.white} />
              </TouchableOpacity>
            </View>
          )}

          {/* Dynamic Weather Summary Banner */}
          {summary && !routeError && (
            <View
              style={[
                styles.summaryBanner,
                { backgroundColor: summary.overallRisk === 'high' ? COLORS.red : summary.overallRisk === 'moderate' ? COLORS.yellow : COLORS.green }
              ]}
              accessible={true}
              accessibilityRole="summary"
              accessibilityLabel={`Route weather summary: ${summary.overallRisk} risk`}
            >
              <MaterialCommunityIcons
                name={
                  summary.overallRisk === 'high'
                    ? 'weather-lightning-rainy'
                    : summary.overallRisk === 'moderate'
                      ? 'weather-partly-rainy'
                      : 'shield-check'
                }
                size={20}
                color={summary.overallRisk === 'high' ? COLORS.white : COLORS.navy}
                style={{ marginRight: 8 }}
              />
              <Text
                style={[
                  styles.summaryText,
                  { color: summary.overallRisk === 'high' ? COLORS.white : COLORS.navy }
                ]}
              >
                {summary.overallRisk === 'clear' && 'Clear weather detected along all route segments'}
                {summary.overallRisk === 'moderate' && 'Precipitation likely along route: drive with caution'}
                {summary.overallRisk === 'high' && `${summary.firstHazardLabel} expected in ${summary.firstHazardMinutes} min`}
              </Text>
            </View>
          )}
        </View>
      )}

      {/* ROUTE COMPARISON BOTTOM SHEET (Hidden during Navigation) */}
      {!isNavigating && comparisons?.length > 0 && !isSheetDismissed && (
        <View style={styles.bottomSheet}>
          <BlurView intensity={95} tint="dark" style={styles.bottomBlur}>
            {/* Grab / Drag Handle */}
            <TouchableOpacity
              style={styles.dragHandleWrapper}
              onPress={() => {
                LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
                setIsSheetCollapsed(!isSheetCollapsed);
              }}
              activeOpacity={0.7}
              accessible={true}
              accessibilityRole="button"
              accessibilityLabel={isSheetCollapsed ? 'Expand route details' : 'Collapse route details'}
            >
              <View style={styles.dragHandle} />
            </TouchableOpacity>

            {/* STATE 1: COLLAPSED PEEK MODE */}
            {isSheetCollapsed ? (
              <View style={styles.peekRow}>
                <TouchableOpacity
                  style={styles.peekInfo}
                  onPress={() => {
                    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
                    setIsSheetCollapsed(false);
                  }}
                  activeOpacity={0.7}
                  accessible={true}
                  accessibilityRole="button"
                  accessibilityLabel="Tap to expand route comparison"
                >
                  <View style={styles.peekTitleRow}>
                    <Text style={styles.peekLabel} numberOfLines={1}>
                      {currentComparison?.label || 'Route'}
                    </Text>
                    <View style={[styles.riskBadge, { backgroundColor: currentRiskColor + '25', borderColor: currentRiskColor, marginLeft: 8 }]}>
                      <Text style={[styles.riskText, { color: currentRiskColor }]}>
                        {currentComparison?.overallRisk.toUpperCase() || 'CLEAR'}
                      </Text>
                    </View>
                  </View>
                  <Text style={styles.peekStats}>
                    {Math.round(currentComparison?.totalDurationMinutes ?? 0)} min · {currentComparison?.totalDistanceKm.toFixed(1)} km
                  </Text>
                </TouchableOpacity>

                <View style={styles.peekActions}>
                  <TouchableOpacity
                    style={styles.peekExpandBtn}
                    onPress={() => {
                      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
                      setIsSheetCollapsed(false);
                    }}
                    accessible={true}
                    accessibilityRole="button"
                    accessibilityLabel="Expand route details"
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <MaterialCommunityIcons name="chevron-up" size={22} color={COLORS.white} />
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.peekStartBtn}
                    onPress={handleStartNavigation}
                    activeOpacity={0.8}
                    accessible={true}
                    accessibilityRole="button"
                    accessibilityLabel="Start Drive"
                  >
                    <MaterialCommunityIcons
                      name={currentRoute?.travelMode === 'flight' ? 'airplane' : 'navigation'}
                      size={15}
                      color={COLORS.white}
                    />
                    <Text style={styles.peekStartBtnText}>
                      {currentRoute?.travelMode === 'flight' ? 'Fly' : 'Start'}
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : (
              /* STATE 2: EXPANDED MODE */
              <>
                <View style={styles.sheetHeaderRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.sheetTitle}>
                      {comparisons.length > 1 ? 'Choose Route' : 'Route Overview'}
                    </Text>
                    <Text style={styles.sheetSubtitle}>
                      {comparisons.length > 1
                        ? 'Select route to preview hazard breakdown'
                        : 'Hazard-checked driving trajectory'}
                    </Text>
                  </View>

                  <View style={styles.headerControls}>
                    <TouchableOpacity
                      style={styles.headerControlBtn}
                      onPress={() => {
                        LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
                        setIsSheetCollapsed(true);
                      }}
                      accessible={true}
                      accessibilityRole="button"
                      accessibilityLabel="Collapse route sheet"
                      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                    >
                      <MaterialCommunityIcons name="chevron-down" size={20} color={COLORS.textSecondary} />
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={[styles.headerControlBtn, { marginLeft: 8 }]}
                      onPress={() => {
                        LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
                        clearRouteState();
                      }}
                      accessible={true}
                      accessibilityRole="button"
                      accessibilityLabel="Clear route and close"
                      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                    >
                      <MaterialCommunityIcons name="close" size={18} color={COLORS.textSecondary} />
                    </TouchableOpacity>
                  </View>
                </View>

                {/* Adaptive Content: Single Route Card vs Multi-route Horizontal Scroll */}
                {comparisons.length === 1 ? (
                  <View
                    style={styles.singleRouteCard}
                    accessible={true}
                    accessibilityRole="summary"
                    accessibilityLabel={`Optimal path: ${Math.round(comparisons[0].totalDurationMinutes)} minutes, ${comparisons[0].totalDistanceKm.toFixed(1)} kilometers, ${comparisons[0].overallRisk} risk`}
                  >
                    <View style={styles.singleRouteHeader}>
                      <View>
                        <Text style={styles.singleRouteLabel}>Fastest & Safest Path</Text>
                        <Text style={styles.durationText}>
                          {Math.round(comparisons[0].totalDurationMinutes)} min
                        </Text>
                      </View>
                      <View style={[styles.riskBadgeLarge, { backgroundColor: currentRiskColor + '20', borderColor: currentRiskColor }]}>
                        <MaterialCommunityIcons
                          name={comparisons[0].overallRisk === 'high' ? 'weather-lightning-rainy' : comparisons[0].overallRisk === 'moderate' ? 'weather-partly-rainy' : 'shield-check'}
                          size={18}
                          color={currentRiskColor}
                        />
                        <Text style={[styles.riskTextLarge, { color: currentRiskColor }]}>
                          {comparisons[0].overallRisk.toUpperCase()} RISK
                        </Text>
                      </View>
                    </View>

                    <View style={styles.singleRouteMetaRow}>
                      <Text style={styles.singleRouteMeta}>
                        📍 {comparisons[0].totalDistanceKm.toFixed(1)} km
                      </Text>
                      <Text style={styles.singleRouteMeta}>
                        🚦 {currentRoadConditions?.trafficStats.freePct ?? 90}% Smooth Flow
                      </Text>
                      {currentRoadConditions && currentRoadConditions.roadEvents.some(e => e.type === 'flood') ? (
                        <Text style={[styles.singleRouteMeta, { color: TRAFFIC_COLORS.flooded }]}>
                          🌊 Flood warning
                        </Text>
                      ) : (
                        <Text style={[styles.singleRouteMeta, { color: COLORS.green }]}>
                          🛡️ No water hazards
                        </Text>
                      )}
                    </View>
                  </View>
                ) : (
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.comparisonScroll}
                    keyboardShouldPersistTaps="handled"
                  >
                    {(comparisons ?? []).map((comp) => {
                      const isSelected = selectedRouteIndex === comp.routeIndex;
                      const isRecommended = comp.overallRisk === 'clear' && comp.extraMinutesVsPrimary >= 0;
                      const riskColor = comp.overallRisk === 'high' ? COLORS.red :
                        comp.overallRisk === 'moderate' ? COLORS.yellow : COLORS.green;

                      return (
                        <TouchableOpacity
                          key={comp.routeIndex}
                          onPress={() => selectRoute(comp.routeIndex)}
                          activeOpacity={0.7}
                          accessible={true}
                          accessibilityRole="radio"
                          accessibilityState={{ selected: isSelected }}
                          accessibilityLabel={`${comp.label}, ${Math.round(comp.totalDurationMinutes)} minutes, ${comp.totalDistanceKm.toFixed(1)} kilometers, risk: ${comp.overallRisk}`}
                          style={[
                            styles.comparisonCard,
                            isSelected && styles.activeCard,
                            { borderColor: isSelected ? COLORS.electricBlue : riskColor }
                          ]}
                        >
                          <View style={styles.cardHeader}>
                            <Text style={styles.cardLabel}>{comp.label}</Text>
                            <View style={[styles.riskBadge, { backgroundColor: riskColor + '25', borderColor: riskColor }]}>
                              <Text style={[styles.riskText, { color: riskColor }]}>{comp.overallRisk.toUpperCase()}</Text>
                            </View>
                          </View>

                          <Text style={styles.durationText}>{Math.round(comp.totalDurationMinutes)} min</Text>
                          <Text style={styles.distanceText}>{comp.totalDistanceKm.toFixed(1)} km</Text>

                          {comp.extraMinutesVsPrimary > 0 ? (
                            <Text style={styles.extraText}>
                              +{Math.round(comp.extraMinutesVsPrimary)} min vs primary
                            </Text>
                          ) : (
                            <Text style={styles.primaryRouteTag}>Fastest path</Text>
                          )}

                          {/* R-14 Hierarchy: Recommended badge */}
                          {isRecommended && (
                            <View style={styles.recommendationBadge}>
                              <MaterialCommunityIcons name="shield-check" size={13} color={COLORS.green} style={{ marginRight: 3 }} />
                              <Text style={styles.recommendation}>Safest Route</Text>
                            </View>
                          )}
                        </TouchableOpacity>
                      );
                    })}
                  </ScrollView>
                )}

                {/* Single Primary Action Button */}
                <TouchableOpacity
                  style={styles.startNavActionBtn}
                  onPress={handleStartNavigation}
                  activeOpacity={0.8}
                  accessible={true}
                  accessibilityRole="button"
                  accessibilityLabel="Start Drive"
                  accessibilityHint="Begins turn-by-turn guidance and live weather tracking"
                >
                  <MaterialCommunityIcons
                    name={currentRoute?.travelMode === 'flight' ? 'airplane' : 'navigation'}
                    size={20}
                    color={COLORS.white}
                  />
                  <Text style={styles.startNavActionText}>
                    {currentRoute?.travelMode === 'flight' ? 'Start Flight' : 'Start Drive'}
                    {currentComparison ? ` · ${Math.round(currentComparison.totalDurationMinutes)} min` : ''}
                  </Text>
                </TouchableOpacity>
              </>
            )}
          </BlurView>
        </View>
      )}

      {/* STATE 3: DISMISSED (Floating Route Pill to easily restore bottom sheet or clear route) */}
      {!isNavigating && comparisons?.length > 0 && isSheetDismissed && (
        <View style={styles.floatingRoutePillWrapper}>
          <TouchableOpacity
            style={styles.floatingRoutePill}
            onPress={() => {
              LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
              setIsSheetDismissed(false);
              setIsSheetCollapsed(false);
            }}
            activeOpacity={0.85}
            accessible={true}
            accessibilityRole="button"
            accessibilityLabel="Restore route comparison sheet"
          >
            <MaterialCommunityIcons name="map-marker-path" size={18} color={COLORS.electricBlue} />
            <Text style={styles.floatingRoutePillText}>
              {Math.round(currentComparison?.totalDurationMinutes ?? 0)} min
            </Text>
            <View style={[styles.riskDot, { backgroundColor: currentRiskColor }]} />
            <MaterialCommunityIcons name="chevron-up" size={18} color={COLORS.textSecondary} />
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.floatingRouteClearBtn}
            onPress={clearRouteState}
            activeOpacity={0.85}
            accessible={true}
            accessibilityRole="button"
            accessibilityLabel="Clear active route"
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <MaterialCommunityIcons name="close" size={16} color={COLORS.white} />
          </TouchableOpacity>
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
          upcomingRoadHazard={upcomingRoadHazard}
          saferAlternative={saferAlternative}
          onAcceptSaferRoute={handleAcceptSaferRoute}
          isSimulating={isSimulating}
          simulationSpeed={simulationSpeed}
          isMuted={isMuted}
          travelMode={currentRoute?.travelMode}
          onToggleSimulate={() => setIsSimulating(!isSimulating)}
          onChangeSimSpeed={(spd) => setSimulationSpeed(spd)}
          onToggleMute={() => setIsMuted(!isMuted)}
          onRecenter={handleRecenterCamera}
          onExitNavigation={() => handleExitNavigation(true)}
          onRouteOverview={handleRouteOverview}
          onChangeDestination={() => setIsRerouteModalVisible(true)}
        />
      )}

      {/* IN-DRIVE REROUTE MODAL (OpenStreetMap navigation style) */}
      <Modal
        visible={isRerouteModalVisible}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setIsRerouteModalVisible(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.rerouteModalOverlay}
        >
          <View style={styles.rerouteModalContainer}>
            <View style={styles.rerouteModalHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.rerouteModalTitle}>Change Destination</Text>
                <Text style={styles.rerouteModalSubtitle}>
                  Select how you would like to proceed with the new destination
                </Text>
              </View>
              <TouchableOpacity
                style={styles.rerouteCloseBtn}
                onPress={() => setIsRerouteModalVisible(false)}
                accessible={true}
                accessibilityRole="button"
                accessibilityLabel="Cancel changing destination"
              >
                <MaterialCommunityIcons name="close" size={22} color={COLORS.white} />
              </TouchableOpacity>
            </View>

            <LocationSearchInput
              label="New Destination"
              placeholder="Search new destination..."
              value=""
              onSelect={(lat, lon, label) => {
                Alert.alert(
                  'Update Destination',
                  `Destination selected: ${label.split(',')[0]}`,
                  [
                    {
                      text: 'Reroute Now (Keep Driving)',
                      onPress: () => handleInDriveReroute({ lat, lon, label }),
                    },
                    {
                      text: 'Exit & Compare Routes',
                      onPress: () => {
                        setIsRerouteModalVisible(false);
                        handleExitAndPlanNewRoute({ lat, lon, label });
                      },
                    },
                    { text: 'Cancel', style: 'cancel' },
                  ]
                );
              }}
            />

            <TouchableOpacity
              style={styles.exitAndCompareShortcutBtn}
              onPress={() => {
                setIsRerouteModalVisible(false);
                handleExitAndPlanNewRoute();
              }}
              activeOpacity={0.8}
              accessible={true}
              accessibilityRole="button"
              accessibilityLabel="Exit active navigation to browse map and compare routes"
            >
              <MaterialCommunityIcons name="map-search" size={18} color={COLORS.electricBlue} style={{ marginRight: 8 }} />
              <Text style={styles.exitAndCompareShortcutText}>Exit navigation and browse map / compare routes</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* DESTINATION ARRIVAL MODAL */}
      <Modal
        visible={isArrived}
        transparent={true}
        animationType="fade"
        onRequestClose={() => {
          setIsArrived(false);
          handleExitNavigation();
        }}
      >
        <View style={styles.arrivalModalOverlay}>
          <BlurView intensity={95} tint="dark" style={styles.arrivalCard}>
            <View style={styles.arrivalIconWrapper}>
              <MaterialCommunityIcons name="flag-checkered" size={38} color={COLORS.green} />
            </View>
            <Text style={styles.arrivalTitle}>You Have Arrived!</Text>
            <Text style={styles.arrivalSubtitle} numberOfLines={2}>
              {destination?.label || 'Destination reached successfully'}
            </Text>

            <View style={styles.arrivalDivider} />

            <TouchableOpacity
              style={styles.arrivalFinishBtn}
              onPress={() => {
                setIsArrived(false);
                handleExitNavigation(true);
              }}
              activeOpacity={0.85}
              accessible={true}
              accessibilityRole="button"
              accessibilityLabel="Finish and exit navigation session"
            >
              <MaterialCommunityIcons name="check" size={20} color={COLORS.white} style={{ marginRight: 8 }} />
              <Text style={styles.arrivalFinishBtnText}>Finish Trip</Text>
            </TouchableOpacity>
          </BlurView>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.navy },
  map: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
  },
  // R-03: Responsive positioning utilizing dynamic safe area insets
  inputWrapper: { position: 'absolute', left: 16, right: 16, zIndex: 100 },
  // R-10: Single controlled blur layer for map readability without visual clutter
  blurContainer: { borderRadius: RADII.lg, overflow: 'hidden', borderWidth: 1, borderColor: COLORS.borderSubtle },
  inputContainer: { padding: 16 },
  divider: { backgroundColor: COLORS.borderSubtle, marginVertical: 8 },
  // R-03: Minimum 50px touch target
  button: {
    backgroundColor: COLORS.electricBlue,
    minHeight: 50,
    borderRadius: RADII.md,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 16,
  },
  buttonLoadingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  buttonText: { color: COLORS.white, fontSize: 16, fontWeight: '700' },
  collapseHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  clearRouteSearchBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: RADII.sm,
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.3)',
  },
  clearRouteSearchText: {
    color: COLORS.red,
    fontSize: 12,
    fontWeight: '700',
  },
  collapseSearchBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: RADII.sm,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
  },
  collapseSearchText: {
    color: COLORS.electricBlue,
    fontSize: 12,
    fontWeight: '700',
    marginRight: 2,
  },
  compactRouteBar: {
    borderRadius: RADII.lg,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: COLORS.borderSubtle,
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  compactClearBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 8,
  },
  compactContent: {
    flex: 1,
    justifyContent: 'center',
  },
  compactEndpointsRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  compactOriginText: {
    color: COLORS.white,
    fontSize: 14,
    fontWeight: '700',
    flexShrink: 1,
  },
  compactDestText: {
    color: COLORS.white,
    fontSize: 14,
    fontWeight: '700',
    flexShrink: 1,
  },
  compactSubtext: {
    color: COLORS.textMuted,
    fontSize: 11,
    marginTop: 2,
  },
  compactEditBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(59, 130, 246, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 8,
  },
  // R-27: Inline error banner
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.red,
    marginTop: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: RADII.md,
  },
  errorText: { flex: 1, color: COLORS.white, fontSize: 13, fontWeight: '600' },
  // R-03: Bottom sheet with dynamic safe area inset padding
  bottomSheet: { position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 100 },
  bottomBlur: {
    paddingHorizontal: 16,
    paddingTop: 6,
    paddingBottom: 12,
    borderTopLeftRadius: RADII.xl,
    borderTopRightRadius: RADII.xl,
    borderTopWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
    overflow: 'hidden',
  },
  dragHandleWrapper: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
    paddingVertical: 12,
  },
  dragHandle: {
    width: 44,
    height: 5,
    borderRadius: 3,
    backgroundColor: 'rgba(255, 255, 255, 0.35)',
  },
  // --- Collapsed (Peek) Mode Styles ---
  peekRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  peekInfo: {
    flex: 1,
    justifyContent: 'center',
  },
  peekTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  peekLabel: {
    color: COLORS.white,
    fontSize: 16,
    fontWeight: '800',
  },
  peekStats: {
    color: COLORS.textSecondary,
    fontSize: 13,
    marginTop: 2,
    fontWeight: '600',
  },
  peekActions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  peekExpandBtn: {
    minWidth: 44,
    minHeight: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 6,
  },
  peekStartBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.electricBlue,
    minHeight: 44,
    paddingHorizontal: 16,
    borderRadius: RADII.md,
    shadowColor: COLORS.electricBlue,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 3,
  },
  peekStartBtnText: {
    color: COLORS.white,
    fontWeight: '800',
    fontSize: 14,
    marginLeft: 6,
  },
  // --- Expanded Mode Styles ---
  sheetHeaderRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  headerControls: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 2,
  },
  headerControlBtn: {
    minWidth: 44,
    minHeight: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  sheetTitle: { color: COLORS.white, fontSize: 18, fontWeight: '800' },
  sheetSubtitle: { color: COLORS.textMuted, fontSize: 12, marginTop: 2 },
  // --- Adaptive Single Route Card Styles ---
  singleRouteCard: {
    backgroundColor: COLORS.surfaceElevated,
    borderRadius: RADII.lg,
    padding: 14,
    borderWidth: 1.5,
    borderColor: COLORS.electricBlue,
    marginBottom: 4,
  },
  singleRouteHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  singleRouteLabel: {
    color: COLORS.textSecondary,
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  singleRouteMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 12,
    marginTop: 4,
  },
  singleRouteMeta: {
    color: COLORS.textMuted,
    fontSize: 12,
    fontWeight: '600',
  },
  riskBadgeLarge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: RADII.sm,
    borderWidth: 1,
    gap: 4,
  },
  riskTextLarge: {
    fontSize: 10,
    fontWeight: '900',
  },
  // --- Dismissed Mode: Floating Route Pill ---
  floatingRoutePillWrapper: {
    position: 'absolute',
    bottom: 20,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    zIndex: 90,
  },
  floatingRoutePill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(15, 23, 42, 0.94)',
    minHeight: 48,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 24,
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.2)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 6,
  },
  floatingRouteClearBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(239, 68, 68, 0.92)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.3)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 6,
    elevation: 6,
  },
  floatingRoutePillText: {
    color: COLORS.white,
    fontSize: 14,
    fontWeight: '800',
    marginLeft: 6,
    marginRight: 8,
  },
  riskDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 6,
  },
  // R-03: Minimum 48px tap target with clean neutral elevation
  startNavActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.electricBlue,
    minHeight: 48,
    marginTop: 10,
    marginBottom: 2,
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: RADII.md,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 4,
  },
  startNavActionText: { color: COLORS.white, fontWeight: '800', fontSize: 15, marginLeft: 8, letterSpacing: 0.3 },
  comparisonScroll: { paddingRight: 20, paddingBottom: 6, paddingTop: 4 },
  // R-14 & R-25: High-contrast card with 164px width and accessible typography
  comparisonCard: {
    backgroundColor: COLORS.surfaceElevated,
    width: 164,
    borderRadius: RADII.lg,
    padding: 14,
    marginRight: 12,
    borderWidth: 1.5,
    minHeight: 140,
    justifyContent: 'space-between',
  },
  activeCard: { backgroundColor: 'rgba(59, 130, 246, 0.15)', borderWidth: 2 },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  // R-25: Contrast ratio >= 10:1
  cardLabel: { color: COLORS.textSecondary, fontSize: 13, fontWeight: '700' },
  riskBadge: { paddingHorizontal: 6, paddingVertical: 3, borderRadius: RADII.sm, borderWidth: 1 },
  riskText: { fontSize: 9, fontWeight: '900' },
  durationText: { color: COLORS.white, fontSize: 24, fontWeight: '800' },
  distanceText: { color: COLORS.textSecondary, fontSize: 13, marginTop: 2, marginBottom: 6 },
  extraText: { color: COLORS.yellow, fontSize: 11, fontWeight: '600' },
  primaryRouteTag: { color: COLORS.textMuted, fontSize: 11, fontWeight: '600' },
  recommendationBadge: { flexDirection: 'row', alignItems: 'center', marginTop: 4 },
  recommendation: { color: COLORS.green, fontSize: 11, fontWeight: '700' },
  alertMarker: { alignItems: 'center' },
  // R-25: WCAG AA compliant text color based on risk severity
  summaryBanner: {
    flexDirection: 'row',
    marginTop: 8,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: RADII.md,
    alignItems: 'center',
  },
  summaryText: { fontWeight: '700', fontSize: 13, flex: 1 },
  navVehicleContainer: { width: 60, height: 60, justifyContent: 'center', alignItems: 'center' },
  navVehiclePulse: { position: 'absolute', width: 56, height: 56, borderRadius: 28, backgroundColor: 'rgba(0, 210, 255, 0.28)', borderWidth: 2, borderColor: 'rgba(0, 210, 255, 0.65)' },
  navVehicleIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#0284C7',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2.5,
    borderColor: COLORS.white,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.5,
    shadowRadius: 4.5,
    elevation: 10,
  },
  roadEventMarker: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(15, 23, 42, 0.94)',
    borderWidth: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.35,
    shadowRadius: 4,
    elevation: 5,
  },
  trafficLegendWrapper: {
    position: 'absolute',
    left: 16,
    zIndex: 90,
  },
  trafficLegendBlur: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: RADII.md,
    borderWidth: 1,
    borderColor: COLORS.borderSubtle,
    overflow: 'hidden',
    gap: 10,
  },
  trafficLegendItem: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  legendBar: {
    width: 14,
    height: 4,
    borderRadius: 2,
    marginRight: 4,
  },
  legendText: {
    color: COLORS.white,
    fontSize: 10,
    fontWeight: '700',
  },
  // Destination and Origin Pin Marker Styles
  destinationMarkerContainer: {
    alignItems: 'center',
    justifyContent: 'flex-start',
  },
  destinationLabelPill: {
    backgroundColor: 'rgba(15, 23, 42, 0.94)',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: '#EF4444',
    marginBottom: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.4,
    shadowRadius: 3,
    elevation: 4,
  },
  destinationLabelPillText: {
    color: COLORS.white,
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0.6,
  },
  destinationMarkerBadge: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#EF4444',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2.5,
    borderColor: COLORS.white,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.4,
    shadowRadius: 4,
    elevation: 6,
  },
  destinationMarkerPointer: {
    width: 0,
    height: 0,
    backgroundColor: 'transparent',
    borderStyle: 'solid',
    borderLeftWidth: 6,
    borderRightWidth: 6,
    borderTopWidth: 8,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderTopColor: '#EF4444',
    alignSelf: 'center',
    marginTop: -2,
  },
  markingBanner: {
    position: 'absolute',
    left: 16,
    right: 16,
    alignItems: 'center',
    zIndex: 95,
  },
  markingBannerBlur: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: RADII.lg,
    borderWidth: 1.5,
    borderColor: '#EF4444',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.4,
    shadowRadius: 5,
    elevation: 8,
  },
  markingBannerText: {
    color: COLORS.white,
    fontSize: 13,
    fontWeight: '700',
    flex: 1,
  },
  markingCancelBtn: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 8,
  },
  originMarkerContainer: {
    alignItems: 'center',
    justifyContent: 'flex-start',
  },
  originMarkerBadge: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: COLORS.electricBlue,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: COLORS.white,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.35,
    shadowRadius: 3,
    elevation: 5,
  },
  originMarkerPointer: {
    width: 0,
    height: 0,
    backgroundColor: 'transparent',
    borderStyle: 'solid',
    borderLeftWidth: 6,
    borderRightWidth: 6,
    borderTopWidth: 8,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderTopColor: COLORS.electricBlue,
    alignSelf: 'center',
    marginTop: -2,
  },
  // --- Swap Endpoints Button Styles ---
  swapEndpointsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 4,
    position: 'relative',
  },
  swapDivider: {
    flex: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
  },
  swapEndpointsBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(30, 41, 59, 0.95)',
    borderWidth: 1.5,
    borderColor: COLORS.electricBlue,
    justifyContent: 'center',
    alignItems: 'center',
    marginHorizontal: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 3,
    elevation: 4,
  },
  // --- Context Pin Floating Action Card (Long-Press on Map) ---
  contextPinCardContainer: {
    position: 'absolute',
    bottom: 30,
    left: 16,
    right: 16,
    zIndex: 950,
  },
  contextPinCard: {
    borderRadius: 18,
    padding: 16,
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.2)',
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.4,
    shadowRadius: 10,
    elevation: 8,
  },
  contextPinHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  contextPinTitle: {
    flex: 1,
    color: COLORS.white,
    fontSize: 14,
    fontWeight: '700',
  },
  contextPinCloseBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  contextPinActionsRow: {
    flexDirection: 'row',
    gap: 12,
  },
  contextPinOriginBtn: {
    flex: 1,
    minHeight: 46,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.electricBlue,
    borderRadius: 12,
    paddingHorizontal: 12,
  },
  contextPinOriginBtnText: {
    color: COLORS.white,
    fontWeight: '800',
    fontSize: 13,
  },
  contextPinDestBtn: {
    flex: 1,
    minHeight: 46,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#EF4444',
    borderRadius: 12,
    paddingHorizontal: 12,
  },
  contextPinDestBtnText: {
    color: COLORS.white,
    fontWeight: '800',
    fontSize: 13,
  },
  // --- In-Drive Reroute Modal Styles ---
  rerouteModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    justifyContent: 'flex-end',
  },
  rerouteModalContainer: {
    backgroundColor: COLORS.surfaceElevated,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    paddingBottom: 36,
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.15)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.4,
    shadowRadius: 10,
    elevation: 10,
  },
  rerouteModalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  rerouteModalTitle: {
    color: COLORS.white,
    fontSize: 18,
    fontWeight: '800',
  },
  rerouteModalSubtitle: {
    color: COLORS.textMuted,
    fontSize: 12,
    marginTop: 2,
  },
  rerouteCloseBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  exitAndCompareShortcutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(59, 130, 246, 0.12)',
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
    marginTop: 14,
    borderWidth: 1,
    borderColor: 'rgba(59, 130, 246, 0.3)',
  },
  exitAndCompareShortcutText: {
    color: COLORS.electricBlue,
    fontSize: 13,
    fontWeight: '700',
  },
  arrivalModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  arrivalCard: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: 'rgba(15, 23, 42, 0.95)',
    borderRadius: 24,
    padding: 24,
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: 'rgba(16, 185, 129, 0.4)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.5,
    shadowRadius: 16,
    elevation: 12,
  },
  arrivalIconWrapper: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
    borderWidth: 2,
    borderColor: COLORS.green,
  },
  arrivalTitle: {
    color: COLORS.white,
    fontSize: 22,
    fontWeight: '900',
    letterSpacing: -0.5,
    textAlign: 'center',
  },
  arrivalSubtitle: {
    color: COLORS.textMuted,
    fontSize: 13,
    textAlign: 'center',
    marginTop: 6,
    lineHeight: 18,
  },
  arrivalDivider: {
    height: 1,
    width: '100%',
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    marginVertical: 20,
  },
  arrivalFinishBtn: {
    width: '100%',
    backgroundColor: COLORS.green,
    borderRadius: 14,
    minHeight: 48,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
  },
  arrivalFinishBtnText: {
    color: COLORS.navy,
    fontSize: 16,
    fontWeight: '800',
  },

  // ── Google Maps-style "Where to?" explore pill ──
  whereToPill: {
    borderRadius: RADII.xl,
    overflow: 'hidden',
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
  },
  whereToPillBlur: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: COLORS.borderSubtle,
    borderRadius: RADII.xl,
  },
  whereToPillText: {
    color: COLORS.textMuted,
    fontSize: 16,
    fontWeight: '500',
    flex: 1,
  },

  // ── Search mode header (back button + title) ──
  searchModeHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
  },
  searchModeTitle: {
    color: COLORS.white,
    fontSize: 15,
    fontWeight: '700',
    flex: 1,
  },

  // ── Origin quick-row (collapsed secondary input) ──
  originQuickRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 6,
    marginTop: 4,
    borderRadius: RADII.sm,
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
  },
  originQuickDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: COLORS.electricBlue,
    marginRight: 12,
    marginLeft: 4,
    borderWidth: 2,
    borderColor: 'rgba(59, 130, 246, 0.3)',
  },
  originQuickLabel: {
    color: COLORS.textSecondary,
    fontSize: 14,
    flex: 1,
  },
  originQuickChange: {
    color: COLORS.electricBlue,
    fontSize: 12,
    fontWeight: '700',
    paddingHorizontal: 8,
  },

  // ── Auto-calculation loading row (replaces "Compare Routes" button) ──
  autoCalcRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    marginTop: 8,
    borderRadius: RADII.md,
    backgroundColor: 'rgba(59, 130, 246, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(59, 130, 246, 0.25)',
  },
  autoCalcText: {
    color: COLORS.electricBlue,
    fontSize: 14,
    fontWeight: '600',
  },
});
