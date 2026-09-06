import React from 'react';
import { View, StyleSheet, TouchableOpacity, Platform } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons, Ionicons } from '@expo/vector-icons';
import { RouteStep } from '../services/osrm';
import { WeatherAlert } from '../hooks/useWeatherAlerts';
import { formatDistance, formatDuration, getManeuverIcon } from '../services/navigation';

interface NavigationHUDProps {
  currentStep: RouteStep | null;
  nextStep: RouteStep | null;
  distanceToNextStepMeters: number;
  remainingDurationMinutes: number;
  remainingDistanceKm: number;
  currentSpeedKph: number;
  upcomingHazard: { alert: WeatherAlert; distanceKm: number } | null;
  isSimulating: boolean;
  simulationSpeed: number;
  isMuted: boolean;
  travelMode?: 'driving' | 'flight';
  onToggleSimulate: () => void;
  onChangeSimSpeed: (speed: number) => void;
  onToggleMute: () => void;
  onRecenter: () => void;
  onExitNavigation: () => void;
}

const COLORS = {
  navy: '#0F172A',
  cardBg: 'rgba(15, 23, 42, 0.94)',
  electricBlue: '#3B82F6',
  white: '#FFFFFF',
  gray: '#94A3B8',
  red: '#EF4444',
  yellow: '#F59E0B',
  green: '#10B981',
  border: 'rgba(255, 255, 255, 0.15)',
};

export const NavigationHUD: React.FC<NavigationHUDProps> = ({
  currentStep,
  nextStep,
  distanceToNextStepMeters,
  remainingDurationMinutes,
  remainingDistanceKm,
  currentSpeedKph,
  upcomingHazard,
  isSimulating,
  simulationSpeed,
  isMuted,
  travelMode = 'driving',
  onToggleSimulate,
  onChangeSimSpeed,
  onToggleMute,
  onRecenter,
  onExitNavigation,
}) => {
  const etaDate = new Date(Date.now() + remainingDurationMinutes * 60 * 1000);
  const etaTimeString = etaDate.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

  const maneuverIconName = currentStep
    ? getManeuverIcon(currentStep.maneuver.type, currentStep.maneuver.modifier)
    : 'navigation';

  const isFlight = travelMode === 'flight';

  return (
    <View style={styles.overlay} pointerEvents="box-none">
      {/* TOP: Turn-by-Turn Instruction Card */}
      <View style={styles.topContainer}>
        <View style={styles.maneuverCard}>
          <View style={styles.maneuverIconWrapper}>
            <MaterialCommunityIcons
              name={maneuverIconName as any}
              size={36}
              color={COLORS.white}
            />
          </View>
          <View style={styles.instructionContent}>
            <Text style={styles.distanceText}>
              {formatDistance(distanceToNextStepMeters)}
            </Text>
            <Text style={styles.instructionText} numberOfLines={2}>
              {currentStep ? currentStep.instruction : 'Follow route path'}
            </Text>
            {nextStep && (
              <View style={styles.nextStepRow}>
                <Text style={styles.nextStepPrefix}>Then:</Text>
                <Text style={styles.nextStepText} numberOfLines={1}>
                  {nextStep.instruction}
                </Text>
              </View>
            )}
          </View>
        </View>

        {/* WEATHER HAZARD HEADS-UP (WeatherWise USP) */}
        {upcomingHazard && (
          <View
            style={[
              styles.hazardCard,
              {
                borderColor:
                  upcomingHazard.alert.severity === 'high' ? COLORS.red : COLORS.yellow,
              },
            ]}
          >
            <View style={styles.hazardHeader}>
              <MaterialCommunityIcons
                name={upcomingHazard.alert.severity === 'high' ? 'weather-lightning-rainy' : 'weather-pouring'}
                size={22}
                color={upcomingHazard.alert.severity === 'high' ? COLORS.red : COLORS.yellow}
              />
              <Text
                style={[
                  styles.hazardTitle,
                  {
                    color:
                      upcomingHazard.alert.severity === 'high' ? COLORS.red : COLORS.yellow,
                  },
                ]}
              >
                WEATHER HAZARD IN ~{Math.round(upcomingHazard.distanceKm)} KM
              </Text>
            </View>
            <Text style={styles.hazardDescription}>
              {upcomingHazard.alert.label} · Rain Prob: {upcomingHazard.alert.precipitationProbability}%
            </Text>
            <Text style={styles.hazardTip}>
              ⚡ Slow down & maintain safe braking distance
            </Text>
          </View>
        )}
      </View>

      {/* FLOATING ACTION BUTTONS (Right Side) */}
      <View style={styles.floatingControls}>
        <TouchableOpacity
          style={styles.circleButton}
          onPress={onToggleMute}
          activeOpacity={0.8}
        >
          <Ionicons
            name={isMuted ? 'volume-mute' : 'volume-high'}
            size={22}
            color={isMuted ? COLORS.red : COLORS.white}
          />
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.circleButton}
          onPress={onRecenter}
          activeOpacity={0.8}
        >
          <MaterialCommunityIcons
            name="crosshairs-gps"
            size={24}
            color={COLORS.electricBlue}
          />
        </TouchableOpacity>
      </View>

      {/* BOTTOM: Trip Status Bar & Simulation Controls */}
      <View style={styles.bottomContainer}>
        {/* Simulation Bar */}
        <View style={styles.simBar}>
          <TouchableOpacity
            style={[
              styles.simToggleBtn,
              isSimulating && styles.simToggleBtnActive,
            ]}
            onPress={onToggleSimulate}
            activeOpacity={0.8}
          >
            <MaterialCommunityIcons
              name={isSimulating ? 'motion-pause' : 'motion-play'}
              size={18}
              color={COLORS.white}
            />
            <Text style={styles.simToggleText}>
              {isSimulating ? 'Simulating' : 'Simulate Drive'}
            </Text>
          </TouchableOpacity>

          {isSimulating && (
            <View style={styles.simSpeedRow}>
              {[1, 2, 5].map((speed) => (
                <TouchableOpacity
                  key={speed}
                  style={[
                    styles.speedChip,
                    simulationSpeed === speed && styles.speedChipActive,
                  ]}
                  onPress={() => onChangeSimSpeed(speed)}
                >
                  <Text
                    style={[
                      styles.speedChipText,
                      simulationSpeed === speed && styles.speedChipTextActive,
                    ]}
                  >
                    {speed}x
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          )}

          <View style={styles.speedBadge}>
            <Text style={styles.speedValue}>
              {Math.round(currentSpeedKph)}
            </Text>
            <Text style={styles.speedUnit}>{isFlight ? 'kph (Air)' : 'km/h'}</Text>
          </View>
        </View>

        {/* Trip Stats and Exit */}
        <View style={styles.tripStatsCard}>
          <View style={styles.tripStatItem}>
            <Text style={styles.etaText}>{etaTimeString}</Text>
            <Text style={styles.etaLabel}>ETA</Text>
          </View>

          <View style={styles.tripStatDivider} />

          <View style={styles.tripStatItem}>
            <Text style={styles.tripValueText}>
              {formatDuration(remainingDurationMinutes)}
            </Text>
            <Text style={styles.tripLabelText}>Remaining</Text>
          </View>

          <View style={styles.tripStatDivider} />

          <View style={styles.tripStatItem}>
            <Text style={styles.tripValueText}>
              {remainingDistanceKm.toFixed(1)} km
            </Text>
            <Text style={styles.tripLabelText}>Distance</Text>
          </View>

          <TouchableOpacity
            style={styles.exitButton}
            onPress={onExitNavigation}
            activeOpacity={0.8}
          >
            <MaterialCommunityIcons name="close" size={24} color={COLORS.white} />
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'space-between',
    zIndex: 999,
  },
  topContainer: {
    paddingHorizontal: 16,
    paddingTop: Platform.OS === 'ios' ? 56 : 40,
  },
  maneuverCard: {
    backgroundColor: COLORS.cardBg,
    borderRadius: 18,
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderWidth: 1.5,
    borderColor: COLORS.border,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.4,
    shadowRadius: 10,
    elevation: 8,
  },
  maneuverIconWrapper: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: COLORS.electricBlue,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 16,
  },
  instructionContent: {
    flex: 1,
  },
  distanceText: {
    color: COLORS.white,
    fontSize: 24,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  instructionText: {
    color: COLORS.white,
    fontSize: 16,
    fontWeight: '600',
    marginTop: 2,
  },
  nextStepRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 6,
    opacity: 0.8,
  },
  nextStepPrefix: {
    color: COLORS.gray,
    fontSize: 12,
    fontWeight: '700',
    marginRight: 4,
  },
  nextStepText: {
    color: COLORS.gray,
    fontSize: 12,
    flex: 1,
  },
  hazardCard: {
    backgroundColor: 'rgba(15, 23, 42, 0.95)',
    borderRadius: 14,
    padding: 12,
    marginTop: 10,
    borderWidth: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  hazardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  hazardTitle: {
    fontSize: 12,
    fontWeight: '900',
    marginLeft: 6,
    letterSpacing: 0.5,
  },
  hazardDescription: {
    color: COLORS.white,
    fontSize: 13,
    fontWeight: '600',
  },
  hazardTip: {
    color: COLORS.gray,
    fontSize: 11,
    marginTop: 2,
  },
  floatingControls: {
    position: 'absolute',
    right: 16,
    bottom: 180,
    gap: 12,
  },
  circleButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: COLORS.cardBg,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 5,
  },
  bottomContainer: {
    paddingHorizontal: 16,
    paddingBottom: Platform.OS === 'ios' ? 36 : 24,
  },
  simBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(15, 23, 42, 0.88)',
    borderRadius: 14,
    padding: 8,
    paddingHorizontal: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  simToggleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
  },
  simToggleBtnActive: {
    backgroundColor: COLORS.electricBlue,
  },
  simToggleText: {
    color: COLORS.white,
    fontSize: 12,
    fontWeight: '700',
    marginLeft: 6,
  },
  simSpeedRow: {
    flexDirection: 'row',
    gap: 6,
  },
  speedChip: {
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 6,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
  },
  speedChipActive: {
    backgroundColor: COLORS.green,
  },
  speedChipText: {
    color: COLORS.gray,
    fontSize: 11,
    fontWeight: '700',
  },
  speedChipTextActive: {
    color: COLORS.navy,
  },
  speedBadge: {
    alignItems: 'center',
  },
  speedValue: {
    color: COLORS.white,
    fontSize: 16,
    fontWeight: '800',
  },
  speedUnit: {
    color: COLORS.gray,
    fontSize: 9,
    fontWeight: '600',
  },
  tripStatsCard: {
    backgroundColor: COLORS.cardBg,
    borderRadius: 20,
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderWidth: 1.5,
    borderColor: COLORS.border,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.4,
    shadowRadius: 10,
    elevation: 8,
  },
  tripStatItem: {
    flex: 1,
  },
  etaText: {
    color: COLORS.green,
    fontSize: 18,
    fontWeight: '800',
  },
  etaLabel: {
    color: COLORS.gray,
    fontSize: 11,
    fontWeight: '600',
  },
  tripValueText: {
    color: COLORS.white,
    fontSize: 16,
    fontWeight: '700',
  },
  tripLabelText: {
    color: COLORS.gray,
    fontSize: 11,
    fontWeight: '600',
  },
  tripStatDivider: {
    width: 1,
    height: 28,
    backgroundColor: COLORS.border,
    marginHorizontal: 8,
  },
  exitButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: COLORS.red,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 10,
  },
});
