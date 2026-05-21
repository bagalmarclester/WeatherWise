import React from 'react';
import { View, StyleSheet, ScrollView, SafeAreaView } from 'react-native';
import { Text, Card } from 'react-native-paper';
import { useWeatherAlerts } from '../../hooks/useWeatherAlerts';
import { format } from 'date-fns';
import { MaterialCommunityIcons } from '@expo/vector-icons';

const COLORS = {
  navy: '#0F172A',
  electricBlue: '#3B82F6',
  white: '#FFFFFF',
  gray: '#64748B',
  green: '#10B981',
  yellow: '#F59E0B',
  red: '#EF4444',
  line: 'rgba(255, 255, 255, 0.1)',
};

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

const getRiskColor = (severity: 'low' | 'medium' | 'high') => {
  if (severity === 'high') return COLORS.red;
  if (severity === 'medium') return COLORS.yellow;
  return COLORS.green;
};

export default function Alerts() {
  const { alerts, summary } = useWeatherAlerts();

  if (!summary || alerts.length === 0) {
    return (
      <View style={styles.emptyContainer}>
        <Text style={styles.emptyEmoji}>🌧️</Text>
        <Text style={styles.emptyText}>
          Set a route on the map to see your weather timeline.
        </Text>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text variant="headlineMedium" style={styles.title}>Weather Timeline</Text>
        <Text style={styles.subtitle}>Analyzing {summary.totalWaypoints} waypoints along your route</Text>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {alerts.map((alert, index) => {
          const riskColor = getRiskColor(alert.severity);
          const isLast = index === alerts.length - 1;
          const timeStr = format(alert.eta, 'h:mm a');
          const minutesFromStart = Math.round((alert.eta.getTime() - Date.now()) / 60000);
          
          return (
            <View key={index} style={styles.timelineItem}>
              {/* Left Side: Time Bubble and Line */}
              <View style={styles.timeColumn}>
                <View style={[styles.timeBubble, { borderColor: riskColor }]}>
                  <Text style={styles.timeText}>{timeStr}</Text>
                </View>
                {!isLast && <View style={styles.verticalLine} />}
              </View>

              {/* Right Side: Card */}
              <View style={styles.cardColumn}>
                <Card style={[styles.card, { borderLeftColor: riskColor, borderLeftWidth: 4 }]}>
                  <Card.Content>
                    <View style={styles.cardHeader}>
                      <Text style={styles.weatherIcon}>{getWeatherEmoji(alert.weatherCode)}</Text>
                      <View>
                        <Text style={styles.alertLabel}>{alert.label}</Text>
                        <Text style={styles.segmentText}>
                          Waypoint {alert.waypointIndex + 1} — ~{minutesFromStart > 0 ? minutesFromStart : 0} min into trip
                        </Text>
                      </View>
                    </View>

                    <View style={styles.statsRow}>
                      <View style={styles.stat}>
                        <Text style={styles.statValue}>{alert.precipitationProbability}%</Text>
                        <Text style={styles.statLabel}>Rain Prob.</Text>
                      </View>
                      <View style={styles.stat}>
                        <Text style={styles.statValue}>{alert.precipitationMm}mm</Text>
                        <Text style={styles.statLabel}>Precip.</Text>
                      </View>
                      <View style={[styles.riskBadge, { backgroundColor: riskColor + '20', borderColor: riskColor }]}>
                        <Text style={[styles.riskBadgeText, { color: riskColor }]}>
                          {alert.severity.toUpperCase()} RISK
                        </Text>
                      </View>
                    </View>
                  </Card.Content>
                </Card>
              </View>
            </View>
          );
        })}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.navy,
  },
  header: {
    padding: 20,
    paddingTop: 40,
  },
  title: {
    color: COLORS.white,
    fontWeight: '800',
  },
  subtitle: {
    color: COLORS.gray,
    fontSize: 14,
    marginTop: 4,
  },
  scrollContent: {
    padding: 20,
    paddingTop: 10,
  },
  timelineItem: {
    flexDirection: 'row',
    minHeight: 120,
  },
  timeColumn: {
    width: 80,
    alignItems: 'center',
  },
  timeBubble: {
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderRadius: 12,
    borderWidth: 1,
    backgroundColor: COLORS.navy,
    zIndex: 1,
  },
  timeText: {
    color: COLORS.white,
    fontSize: 12,
    fontWeight: '700',
  },
  verticalLine: {
    flex: 1,
    width: 2,
    backgroundColor: COLORS.line,
    marginVertical: 4,
  },
  cardColumn: {
    flex: 1,
    marginLeft: 15,
    paddingBottom: 25,
  },
  card: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 12,
    elevation: 0,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 15,
  },
  weatherIcon: {
    fontSize: 32,
    marginRight: 12,
  },
  alertLabel: {
    color: COLORS.white,
    fontSize: 16,
    fontWeight: '700',
  },
  segmentText: {
    color: COLORS.gray,
    fontSize: 12,
  },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  stat: {
    alignItems: 'flex-start',
  },
  statValue: {
    color: COLORS.white,
    fontSize: 18,
    fontWeight: '800',
  },
  statLabel: {
    color: COLORS.gray,
    fontSize: 10,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  riskBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
  },
  riskBadgeText: {
    fontSize: 10,
    fontWeight: '900',
  },
  emptyContainer: {
    flex: 1,
    backgroundColor: COLORS.navy,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
  },
  emptyEmoji: {
    fontSize: 64,
    marginBottom: 20,
  },
  emptyText: {
    color: COLORS.gray,
    fontSize: 16,
    textAlign: 'center',
    lineHeight: 24,
  },
});
