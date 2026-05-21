import React, { createContext, useContext, useState, ReactNode } from 'react';
import { WeatherAlert, RouteSummary, RouteComparison } from '../hooks/useWeatherAlerts';

interface WeatherContextType {
  alerts: WeatherAlert[];
  setAlerts: (alerts: WeatherAlert[]) => void;
  summary: RouteSummary | null;
  setSummary: (summary: RouteSummary | null) => void;
  comparisons: RouteComparison[];
  setComparisons: (comparisons: RouteComparison[]) => void;
  selectedRouteIndex: number;
  setSelectedRouteIndex: (index: number) => void;
  isAnalyzing: boolean;
  setIsAnalyzing: (is: boolean) => void;
}

const WeatherContext = createContext<WeatherContextType | undefined>(undefined);

export const WeatherProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [alerts, setAlerts] = useState<WeatherAlert[]>([]);
  const [summary, setSummary] = useState<RouteSummary | null>(null);
  const [comparisons, setComparisons] = useState<RouteComparison[]>([]);
  const [selectedRouteIndex, setSelectedRouteIndex] = useState(0);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  return (
    <WeatherContext.Provider
      value={{
        alerts,
        setAlerts,
        summary,
        setSummary,
        comparisons,
        setComparisons,
        selectedRouteIndex,
        setSelectedRouteIndex,
        isAnalyzing,
        setIsAnalyzing,
      }}
    >
      {children}
    </WeatherContext.Provider>
  );
};

export const useWeather = () => {
  const context = useContext(WeatherContext);
  if (context === undefined) {
    throw new Error('useWeather must be used within a WeatherProvider');
  }
  return context;
};
