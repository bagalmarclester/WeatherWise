import React, { useState, useEffect, useRef } from 'react';
import { StyleSheet, View, TouchableOpacity, ActivityIndicator, Alert, ScrollView } from 'react-native';
import MapView, { Polyline, Marker } from 'react-native-maps';
import * as Location from 'expo-location';
import { BlurView } from 'expo-blur';
import { Text, Divider } from 'react-native-paper';
import { fetchAlternativeRoutes } from '../../services/osrm';
import { useWeatherAlerts } from '../../hooks/useWeatherAlerts';
import { LocationSearchInput } from '../../components/LocationSearchInput';
import { useWeather } from '../../context/WeatherContext';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';

const LAST_KNOWN_LOCATION_KEY = 'last_known_location';

const DAVAO_CITY = {
  latitude: 7.0718,
  longitude: 125.6134,
  latitudeDelta: 0.05,
  longitudeDelta: 0.05,
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

const PROXY_PORT = 3001;

/**
 * Gets the proxy server URL by extracting the dev machine's IP
 * from Expo's hostUri (which the phone already uses to connect to Metro).
 */
const getProxyBaseUrl = (): string => {
  const hostUri = Constants.expoConfig?.hostUri ?? Constants.manifest?.debuggerHost;
  if (hostUri) {
    const host = hostUri.split(':')[0];
    return `http://${host}:${PROXY_PORT}`;
  }
  return `http://localhost:${PROXY_PORT}`;
};

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

interface Point {
  lat: number;
  lon: number;
  label: string;
}

export default function MapScreen() {
  const [origin, setOrigin] = useState<Point | null>(null);
  const [destination, setDestination] = useState<Point | null>(null);
  const [loading, setLoading] = useState(false);
  const [allRoutes, setAllRoutes] = useState<any[]>([]);
  const [userLocation, setUserLocation] = useState<Location.LocationObject | null>(null);
  
  const { comparisons, selectedRouteIndex, setSelectedRouteIndex, setAlerts, setSummary, setComparisons } = useWeather();
  const { isAnalyzing, compareRoutes, selectRoute } = useWeatherAlerts();
  const mapRef = useRef<MapView>(null);

  const clearRouteState = () => {
    setAllRoutes([]);
    setAlerts([]);
    setSummary(null);
    setComparisons([]);
    setSelectedRouteIndex(0);
  };

  // Smoothly focus on the route whenever the selection changes
  useEffect(() => {
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
  }, [selectedRouteIndex, allRoutes]);

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
    console.log('Using absolute fallback: Davao City');
    return { latitude: DAVAO_CITY.latitude, longitude: DAVAO_CITY.longitude };
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

      // 4b. Reverse-geocode the best available coords into an address (5s via proxy)
      let resolvedLabel = 'Current Location';
      try {
        const proxyBase = getProxyBaseUrl();
        const response = await fetch(
          `${proxyBase}/geocode/reverse?lat=${refinedLat}&lon=${refinedLon}`
        );

        const data = await response.json();
        if (data.display_name) {
          resolvedLabel = data.display_name;
        }
      } catch {
        console.log('[Location] Reverse geocode failed via proxy, keeping "Current Location" label');
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

    setLoading(true);
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
      
      const comparisonResults = await compareRoutes(sortedRoutes);
      
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
    } finally {
      setLoading(false);
    }
  };

  const currentRoute = allRoutes[selectedRouteIndex];
  const currentComparison = comparisons.find(c => c.routeIndex === selectedRouteIndex);

  return (
    <View style={styles.container}>
      <MapView
        ref={mapRef}
        style={styles.map}
        initialRegion={DAVAO_CITY}
        customMapStyle={mapStyle}
      >
        {allRoutes.map((route, index) => {
          const isSelected = selectedRouteIndex === index;
          const comparison = comparisons.find(c => c.routeIndex === index);
          
          let strokeColor = 'rgba(100, 116, 139, 0.4)'; // Default gray for alts
          if (isSelected) {
            strokeColor = comparison?.overallRisk === 'high' ? COLORS.red :
                         comparison?.overallRisk === 'moderate' ? COLORS.yellow : COLORS.green;
          }

          return (
            <Polyline
              key={`route-${index}`}
              coordinates={route.coordinates.map((p: any) => ({ latitude: p.lat, longitude: p.lon }))}
              strokeWidth={isSelected ? 6 : 4}
              strokeColor={strokeColor}
              lineDashPattern={isSelected ? undefined : [5, 5]}
              zIndex={isSelected ? 10 : index}
              tappable={true}
              onPress={() => selectRoute(index)}
            />
          );
        })}
        
        {currentComparison?.alerts?.filter(a => a.severity === 'high').map((alert, index) => (
          <Marker
            key={`alert-${index}`}
            coordinate={{ latitude: alert.lat, longitude: alert.lon }}
            title="Rain Alert"
          >
            <View style={styles.alertMarker}><Text style={{ fontSize: 24 }}>🌧️</Text></View>
          </Marker>
        ))}

        {userLocation && (
          <Marker
            coordinate={{ latitude: userLocation.coords.latitude, longitude: userLocation.coords.longitude }}
            title="You"
            pinColor={COLORS.electricBlue}
          />
        )}
      </MapView>

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
            <TouchableOpacity style={styles.button} onPress={handleGetRoute} disabled={loading || isAnalyzing}>
              {loading || isAnalyzing ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Compare Routes</Text>}
            </TouchableOpacity>
          </View>
        </BlurView>
      </View>

      {comparisons?.length > 0 && (
        <View style={styles.bottomSheet}>
          <BlurView intensity={95} tint="dark" style={styles.bottomBlur}>
            <Text style={styles.sheetTitle}>Choose Safest Route</Text>
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
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </BlurView>
        </View>
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
  sheetTitle: { color: '#fff', fontSize: 18, fontWeight: '800', marginBottom: 15 },
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
  alertMarker: { alignItems: 'center' },
});
