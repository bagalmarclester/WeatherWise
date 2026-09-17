import React, {
  forwardRef,
  useImperativeHandle,
  useRef,
  useMemo,
  ReactNode,
} from 'react';
import { StyleSheet, View, Text } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';

// Safely attempt to load @maplibre/maplibre-react-native.
// When running in the standard Expo Go client, native TurboModules (MLRNCameraModule)
// are not available, so this try-catch prevents the entire app from crashing.
let MapLibre: any = null;
let isMapLibreAvailable = false;
try {
  MapLibre = require('@maplibre/maplibre-react-native');
  if (MapLibre && (MapLibre.Map || MapLibre.default?.Map)) {
    isMapLibreAvailable = true;
  }
} catch {
  isMapLibreAvailable = false;
}

export interface LatLng {
  latitude: number;
  longitude: number;
}

export interface Region {
  latitude: number;
  longitude: number;
  latitudeDelta: number;
  longitudeDelta: number;
}

export interface CameraOptions {
  center?: LatLng;
  pitch?: number;
  heading?: number;
  zoom?: number;
  altitude?: number;
}

export interface MapViewRef {
  animateToRegion: (region: Region, duration?: number) => void;
  animateCamera: (camera: CameraOptions, duration?: number | { duration?: number }) => void;
  fitToCoordinates: (
    coordinates: LatLng[],
    options?: {
      edgePadding?: { top?: number; right?: number; bottom?: number; left?: number };
      animated?: boolean;
    }
  ) => void;
}

export type MapView = MapViewRef;

export interface MarkerProps {
  id?: string;
  coordinate: LatLng;
  title?: string;
  description?: string;
  pinColor?: string;
  zIndex?: number;
  anchor?: { x: number; y: number };
  tracksViewChanges?: boolean;
  onPress?: () => void;
  children?: ReactNode;
  [key: string]: any;
}

export interface PolylineProps {
  id?: string;
  coordinates: LatLng[];
  strokeWidth?: number;
  strokeColor?: string;
  lineDashPattern?: number[];
  zIndex?: number;
  tappable?: boolean;
  onPress?: () => void;
  [key: string]: any;
}

export interface MapViewProps {
  style?: any;
  initialRegion?: Region;
  showsUserLocation?: boolean;
  showsMyLocationButton?: boolean;
  mapType?: string;
  pitchEnabled?: boolean;
  onMapReady?: () => void;
  onPress?: (event: { nativeEvent: { coordinate: LatLng } }) => void;
  onLongPress?: (event: { nativeEvent: { coordinate: LatLng } }) => void;
  children?: ReactNode;
  [key: string]: any;
}

// 100% OpenStreetMap (CARTO Dark Matter) raster tile style spec
const OSM_DARK_STYLE = {
  version: 8,
  sources: {
    carto_dark: {
      type: 'raster',
      tiles: [
        'https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
        'https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
        'https://c.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
      ],
      tileSize: 256,
      attribution: '© OpenStreetMap contributors, © CARTO',
    },
  },
  layers: [
    {
      id: 'carto_dark_layer',
      type: 'raster',
      source: 'carto_dark',
      minzoom: 0,
      maxzoom: 19,
    },
  ],
};

function latDeltaToZoom(latitudeDelta: number): number {
  if (!latitudeDelta || latitudeDelta <= 0) return 13;
  return Math.max(1, Math.min(19, Math.round(Math.log2(360 / latitudeDelta))));
}

export const Marker: React.FC<MarkerProps> = () => null;
export const Polyline: React.FC<PolylineProps> = () => null;
export const UrlTile: React.FC<any> = () => null;

const OpenStreetMap = forwardRef<MapViewRef, MapViewProps>((props, ref) => {
  const {
    style,
    initialRegion,
    pitchEnabled = false,
    onMapReady,
    onPress,
    onLongPress,
    children,
  } = props;

  const mapRef = useRef<any>(null);
  const cameraRef = useRef<any>(null);

  useImperativeHandle(ref, () => ({
    animateToRegion: (region: Region, duration = 600) => {
      if (!cameraRef.current || !region) return;
      const zoom = latDeltaToZoom(region.latitudeDelta);
      cameraRef.current.easeTo({
        center: [region.longitude, region.latitude],
        zoom,
        duration,
      });
    },

    animateCamera: (camera: CameraOptions, durationArg = 600) => {
      if (!cameraRef.current || !camera) return;
      const duration = typeof durationArg === 'number' ? durationArg : (durationArg?.duration ?? 600);
      const easeOptions: any = {
        duration,
        easing: 'ease',
      };
      if (camera.center) {
        easeOptions.center = [camera.center.longitude, camera.center.latitude];
      }
      if (camera.zoom !== undefined) {
        easeOptions.zoom = camera.zoom;
      }
      if (camera.heading !== undefined) {
        easeOptions.bearing = camera.heading;
      }
      if (camera.pitch !== undefined) {
        easeOptions.pitch = camera.pitch;
      }

      cameraRef.current.easeTo(easeOptions);
    },

    fitToCoordinates: (coordinates: LatLng[], options) => {
      if (!cameraRef.current || !coordinates || coordinates.length === 0) return;

      let minLat = 90, maxLat = -90, minLon = 180, maxLon = -180;
      for (const c of coordinates) {
        if (c.latitude < minLat) minLat = c.latitude;
        if (c.latitude > maxLat) maxLat = c.latitude;
        if (c.longitude < minLon) minLon = c.longitude;
        if (c.longitude > maxLon) maxLon = c.longitude;
      }

      if (minLat === maxLat) { minLat -= 0.005; maxLat += 0.005; }
      if (minLon === maxLon) { minLon -= 0.005; maxLon += 0.005; }

      const padding = options?.edgePadding
        ? {
            top: options.edgePadding.top || 40,
            right: options.edgePadding.right || 40,
            bottom: options.edgePadding.bottom || 40,
            left: options.edgePadding.left || 40,
          }
        : { top: 60, right: 60, bottom: 60, left: 60 };

      const duration = options?.animated === false ? 0 : 750;

      cameraRef.current.fitBounds(
        [minLon, minLat, maxLon, maxLat],
        { padding, duration }
      );
    },
  }));

  // Parse children into Polylines and Markers
  const { polylineElements, markerElements } = useMemo(() => {
    const polylines: React.ReactElement<PolylineProps>[] = [];
    const markers: React.ReactElement<MarkerProps>[] = [];

    const traverse = (nodes: ReactNode) => {
      React.Children.forEach(nodes, (child) => {
        if (!React.isValidElement(child)) return;
        if ((child as any).type === React.Fragment) {
          traverse((child.props as any)?.children);
          return;
        }
        if (child.type === Polyline || (child.props as any)?.coordinates) {
          polylines.push(child as React.ReactElement<PolylineProps>);
        } else if (child.type === Marker || (child.props as any)?.coordinate) {
          markers.push(child as React.ReactElement<MarkerProps>);
        }
      });
    };

    traverse(children);
    return { polylineElements: polylines, markerElements: markers };
  }, [children]);

  const handleMapPress = (e: any) => {
    if (!onPress) return;
    const coords = e?.nativeEvent?.lngLat || e?.geometry?.coordinates || e?.lngLat;
    if (coords && coords.length >= 2) {
      const [lon, lat] = coords;
      onPress({ nativeEvent: { coordinate: { latitude: lat, longitude: lon } } });
    }
  };

  const initialZoom = initialRegion ? latDeltaToZoom(initialRegion.latitudeDelta) : 13;
  const initialCenter: [number, number] = initialRegion
    ? [initialRegion.longitude, initialRegion.latitude]
    : [120.9842, 14.5995];

  // If MapLibre native module is missing (e.g. running inside standard Expo Go), display informative card
  if (!isMapLibreAvailable || !MapLibre) {
    return (
      <View style={[styles.container, styles.fallbackContainer, style]}>
        <View style={styles.fallbackCard}>
          <MaterialCommunityIcons name="layers-triple" size={44} color="#3B82F6" />
          <Text style={styles.fallbackTitle}>OpenStreetMap Engine</Text>
          <Text style={styles.fallbackBadge}>Requires Development Build</Text>
          <Text style={styles.fallbackDescription}>
            MapLibre native modules are not bundled inside standard Expo Go. To run this Google-free OpenStreetMap engine on your device:
          </Text>
          <View style={styles.stepBox}>
            <Text style={styles.stepNumber}>1.</Text>
            <Text style={styles.stepText}>Build custom APK with EAS: <Text style={styles.codeText}>eas build --profile preview -p android</Text></Text>
          </View>
          <View style={styles.stepBox}>
            <Text style={styles.stepNumber}>2.</Text>
            <Text style={styles.stepText}>Or compile locally to device/emulator: <Text style={styles.codeText}>npx expo run:android</Text></Text>
          </View>
          <View style={styles.stepBox}>
            <Text style={styles.stepNumber}>3.</Text>
            <Text style={styles.stepText}>Install and open the APK on your device, then connect to Metro.</Text>
          </View>
        </View>
      </View>
    );
  }

  const MapComponent = MapLibre.Map;
  const CameraComponent = MapLibre.Camera;
  const MapLibreMarker = MapLibre.Marker;
  const GeoJSONSource = MapLibre.GeoJSONSource;
  const Layer = MapLibre.Layer;

  return (
    <View style={[styles.container, style]}>
      <MapComponent
        ref={mapRef}
        style={styles.fill}
        styleJSON={JSON.stringify(OSM_DARK_STYLE)}
        onDidFinishLoadingMap={onMapReady}
        onPress={handleMapPress}
        pitchEnabled={pitchEnabled}
      >
        <CameraComponent
          ref={cameraRef}
          initialViewState={{
            center: initialCenter,
            zoom: initialZoom,
          }}
        />

        {/* Polylines rendered via GeoJSON LineLayers */}
        {polylineElements.map((poly, idx) => {
          const { coordinates, strokeColor = '#3B82F6', strokeWidth = 4, lineDashPattern, onPress: polyPress } = poly.props;
          if (!coordinates || coordinates.length < 2) return null;

          const sourceId = `osm-route-source-${poly.key || idx}`;
          const layerId = `osm-route-layer-${poly.key || idx}`;

          const lineGeoJson: GeoJSON.FeatureCollection<GeoJSON.LineString> = {
            type: 'FeatureCollection',
            features: [
              {
                type: 'Feature',
                properties: {},
                geometry: {
                  type: 'LineString',
                  coordinates: coordinates.map((c) => [c.longitude, c.latitude]),
                },
              },
            ],
          };

          return (
            <GeoJSONSource
              key={sourceId}
              id={sourceId}
              data={lineGeoJson}
              onPress={polyPress ? () => polyPress() : undefined}
            >
              <Layer
                id={layerId}
                type="line"
                layout={{
                  'line-cap': 'round',
                  'line-join': 'round',
                }}
                paint={{
                  'line-color': strokeColor,
                  'line-width': strokeWidth,
                  'line-dasharray': lineDashPattern ? [lineDashPattern[0] / 2, lineDashPattern[1] / 2] : undefined,
                }}
              />
            </GeoJSONSource>
          );
        })}

        {/* Markers rendered via native MapLibre markers */}
        {markerElements.map((marker, idx) => {
          const { coordinate, title, pinColor = '#3B82F6', onPress: markerPress, children: markerChild } = marker.props;
          if (!coordinate) return null;

          const markerId = `osm-marker-${marker.key || idx}`;

          return (
            <MapLibreMarker
              key={markerId}
              id={markerId}
              lngLat={[coordinate.longitude, coordinate.latitude]}
              onPress={() => markerPress?.()}
            >
              {markerChild ? (
                <View collapsable={false}>{markerChild}</View>
              ) : (
                <View style={styles.defaultPin}>
                  <MaterialCommunityIcons name="map-marker" size={32} color={pinColor} />
                  {title && (
                    <View style={styles.callout}>
                      <Text style={styles.calloutText}>{title}</Text>
                    </View>
                  )}
                </View>
              )}
            </MapLibreMarker>
          );
        })}
      </MapComponent>
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  fill: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
  },
  defaultPin: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  callout: {
    backgroundColor: 'rgba(15, 23, 42, 0.9)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    borderColor: 'rgba(255, 255, 255, 0.2)',
    borderWidth: 1,
    marginTop: 2,
  },
  calloutText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '600',
  },
  fallbackContainer: {
    backgroundColor: '#0B1120',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  fallbackCard: {
    backgroundColor: '#1E293B',
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(59, 130, 246, 0.3)',
    maxWidth: 420,
    width: '100%',
  },
  fallbackTitle: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '700',
    marginTop: 12,
  },
  fallbackBadge: {
    backgroundColor: 'rgba(239, 68, 68, 0.2)',
    color: '#F87171',
    borderColor: '#EF4444',
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 3,
    fontSize: 12,
    fontWeight: '600',
    marginTop: 8,
    marginBottom: 12,
  },
  fallbackDescription: {
    color: '#94A3B8',
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: 16,
  },
  stepBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    width: '100%',
    marginBottom: 10,
  },
  stepNumber: {
    color: '#3B82F6',
    fontWeight: '700',
    fontSize: 14,
    marginRight: 8,
    width: 16,
  },
  stepText: {
    color: '#E2E8F0',
    fontSize: 12,
    flex: 1,
    lineHeight: 17,
  },
  codeText: {
    color: '#38BDF8',
    fontFamily: 'monospace',
    fontWeight: '600',
  },
});

export default OpenStreetMap;
