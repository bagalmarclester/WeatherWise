import { create } from 'zustand';
import { WeatherAlert, RouteSummary, RouteComparison } from '../hooks/useWeatherAlerts';

interface WeatherState {
  // --- State slices ---
  alerts: WeatherAlert[];
  summary: RouteSummary | null;
  comparisons: RouteComparison[];
  selectedRouteIndex: number;
  isAnalyzing: boolean;

  // --- Actions ---
  setAlerts: (alerts: WeatherAlert[]) => void;
  setSummary: (summary: RouteSummary | null) => void;
  setComparisons: (comparisons: RouteComparison[]) => void;
  setSelectedRouteIndex: (index: number) => void;
  setIsAnalyzing: (is: boolean) => void;

  /** Resets all weather/route state to defaults in a single batch. */
  clearRouteState: () => void;
}

export const useWeatherStore = create<WeatherState>((set) => ({
  // --- Initial state ---
  alerts: [],
  summary: null,
  comparisons: [],
  selectedRouteIndex: 0,
  isAnalyzing: false,

  // --- Setters ---
  setAlerts: (alerts) => set({ alerts }),
  setSummary: (summary) => set({ summary }),
  setComparisons: (comparisons) => set({ comparisons }),
  setSelectedRouteIndex: (index) => set({ selectedRouteIndex: index }),
  setIsAnalyzing: (is) => set({ isAnalyzing: is }),

  // --- Compound actions ---
  clearRouteState: () =>
    set({
      alerts: [],
      summary: null,
      comparisons: [],
      selectedRouteIndex: 0,
    }),
}));
