import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  TextInput,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Keyboard,
} from 'react-native';
import { Text, Divider } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { getProxyBaseUrl } from '../utils/proxyUrl';

interface LocationSearchResult {
  display_name: string;
  lat: string;
  lon: string;
}

interface LocationSearchInputProps {
  label: string;
  placeholder: string;
  value: string;
  onSelect: (lat: number, lon: number, label: string) => void;
  onClear?: () => void;
  onCurrentLocationPress?: () => void;
  showCurrentLocationButton?: boolean;
}

const DEBOUNCE_MS = 300;
const NOMINATIM_BASE = `${getProxyBaseUrl()}/nominatim`;

/** Stable separator — extracted outside render to avoid re-creating on every frame */
const ItemSeparator = () => <Divider style={styles.divider} />;

export const LocationSearchInput: React.FC<LocationSearchInputProps> = ({
  label,
  placeholder,
  value,
  onSelect,
  onClear,
  onCurrentLocationPress,
  showCurrentLocationButton,
}) => {
  const [query, setQuery] = useState(value);
  const [results, setResults] = useState<LocationSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  // Track whether the user is actively editing — prevents external value syncing mid-typing
  const isEditing = useRef(false);

  const debounceTimer = useRef<NodeJS.Timeout | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Sync internal query with external value only when the user is NOT typing
  // (e.g., when "Current Location" is set programmatically from the parent)
  useEffect(() => {
    if (!isEditing.current) {
      setQuery(value);
    }
  }, [value]);

  // Cleanup debounce & abort on unmount
  useEffect(() => {
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
      if (abortControllerRef.current) abortControllerRef.current.abort();
    };
  }, []);

  const searchLocations = async (text: string) => {
    const trimmed = text.trim();
    if (trimmed.length < 3) {
      setResults([]);
      setShowDropdown(false);
      setLoading(false);
      return;
    }

    // Abort any previous in-flight geocoding request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setLoading(true);

    const url = `${NOMINATIM_BASE}/search?q=${encodeURIComponent(trimmed)}&format=json&limit=5&countrycodes=ph`;

    try {
      const response = await fetch(url, {
        signal: controller.signal,
      });

      if (!response.ok) throw new Error('Search failed');
      const data: LocationSearchResult[] = await response.json();

      // Only update UI if this request wasn't aborted
      if (!controller.signal.aborted) {
        setResults(data);
        setShowDropdown(data.length > 0);
      }
    } catch (error: any) {
      // Silently ignore aborted requests — they are expected
      if (error.name === 'AbortError') return;

      console.error('Nominatim Search Error:', error);
      setResults([]);
      setShowDropdown(false);
    } finally {
      // Only clear loading if this controller is still the active one
      if (abortControllerRef.current === controller) {
        setLoading(false);
      }
    }
  };

  const handleTextChange = (text: string) => {
    isEditing.current = true;
    setQuery(text);

    // If the user clears the field completely, notify the parent to clear the point
    if (text.trim() === '' && onClear) {
      onClear();
    }

    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current);
    }

    if (text.trim().length < 3) {
      setResults([]);
      setShowDropdown(false);
      return;
    }

    debounceTimer.current = setTimeout(() => {
      searchLocations(text);
    }, DEBOUNCE_MS);
  };

  const handleSelect = (item: LocationSearchResult) => {
    const lat = parseFloat(item.lat);
    const lon = parseFloat(item.lon);

    // Clean up display name: Take first 2-3 segments (e.g. "SM Lanang, Davao City")
    const segments = item.display_name.split(',').map(s => s.trim());
    const cleanLabel = segments.length > 2
      ? `${segments[0]}, ${segments[1]}`
      : item.display_name;

    isEditing.current = false;
    setQuery(cleanLabel);
    setResults([]);
    setShowDropdown(false);
    Keyboard.dismiss();
    onSelect(lat, lon, cleanLabel);
  };

  const handleFocus = () => {
    isEditing.current = true;
    // Re-show dropdown if there are cached results
    if (query.length >= 3 && results.length > 0) {
      setShowDropdown(true);
    }
  };

  const handleBlur = () => {
    // Small delay so that dropdown item taps register before blur hides them
    setTimeout(() => {
      isEditing.current = false;
    }, 200);
  };

  return (
    <View style={styles.container}>
      <View style={styles.inputHeader}>
        <Text style={styles.label}>{label}</Text>
        {showCurrentLocationButton && (
          <TouchableOpacity onPress={() => {
            isEditing.current = false;
            setShowDropdown(false);
            Keyboard.dismiss();
            onCurrentLocationPress?.();
          }} style={styles.currentLocBtn}>
            <MaterialCommunityIcons name="crosshairs-gps" size={16} color="#3B82F6" />
            <Text style={styles.currentLocText}>Current</Text>
          </TouchableOpacity>
        )}
      </View>

      <View style={styles.inputWrapper}>
        <TextInput
          style={styles.input}
          value={query}
          onChangeText={handleTextChange}
          placeholder={placeholder}
          placeholderTextColor="#64748B"
          onFocus={handleFocus}
          onBlur={handleBlur}
          selectTextOnFocus={true}
        />
        {loading && <ActivityIndicator size="small" color="#3B82F6" style={styles.loader} />}
      </View>

      {showDropdown && (
        <View style={styles.dropdown}>
          <FlatList
            data={results}
            keyExtractor={(_, index) => `loc-${index}`}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={styles.resultItem}
                onPress={() => handleSelect(item)}
              >
                <MaterialCommunityIcons name="map-marker-outline" size={18} color="#64748B" />
                <Text style={styles.resultText} numberOfLines={2}>
                  {item.display_name}
                </Text>
              </TouchableOpacity>
            )}
            ItemSeparatorComponent={ItemSeparator}
            keyboardShouldPersistTaps="handled"
            nestedScrollEnabled={true}
          />
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    marginVertical: 4,
    zIndex: 100,
  },
  inputHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  label: {
    color: '#3B82F6',
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  currentLocBtn: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  currentLocText: {
    color: '#3B82F6',
    fontSize: 10,
    fontWeight: '700',
    marginLeft: 4,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 40,
  },
  input: {
    flex: 1,
    color: '#FFFFFF',
    fontSize: 15,
    paddingHorizontal: 0,
    height: '100%',
  },
  loader: {
    marginLeft: 8,
  },
  dropdown: {
    position: 'absolute',
    top: 60,
    left: 0,
    right: 0,
    backgroundColor: '#1E293B',
    borderRadius: 8,
    maxHeight: 200,
    elevation: 5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    zIndex: 1000,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  resultItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
  },
  resultText: {
    color: '#FFFFFF',
    fontSize: 13,
    marginLeft: 10,
    flex: 1,
  },
  divider: {
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
});
