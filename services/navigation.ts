import * as Speech from 'expo-speech';
import {
  haversineDistanceMeters,
  calculateBearing,
  formatDistance,
  formatDuration,
  getManeuverIcon,
  formatManeuverInstruction,
  findUpcomingHazard,
  formatWeatherWarningSpeech,
} from '../utils/navigationCalculations';

export {
  haversineDistanceMeters,
  calculateBearing,
  formatDistance,
  formatDuration,
  getManeuverIcon,
  formatManeuverInstruction,
  findUpcomingHazard,
  formatWeatherWarningSpeech,
};

let lastSpokenText = '';
let lastSpokenTime = 0;

/**
 * Speaks turn-by-turn guidance and weather alerts using expo-speech.
 * Avoids repeated speech within 10 seconds unless the text has changed.
 */
export const speakGuidance = async (text: string, isMuted: boolean): Promise<void> => {
  if (isMuted || !text || text.trim() === '') return;

  const now = Date.now();
  if (text === lastSpokenText && now - lastSpokenTime < 10000) {
    return;
  }

  lastSpokenText = text;
  lastSpokenTime = now;

  try {
    const isSpeaking = await Speech.isSpeakingAsync();
    if (isSpeaking) {
      await Speech.stop();
    }
    Speech.speak(text, {
      language: 'en',
      rate: 0.95,
      pitch: 1.0,
    });
  } catch (error) {
    console.warn('[Navigation Speech Error]:', error);
  }
};
