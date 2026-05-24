import React, { useState, useEffect, useRef } from 'react';
import { View, StyleSheet, TouchableOpacity, Animated, SafeAreaView, ActivityIndicator } from 'react-native';
import { Text } from 'react-native-paper';
import { Ionicons } from '@expo/vector-icons';
import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system/legacy';
import * as Speech from 'expo-speech';
import { useWeatherStore } from '../../store/useWeatherStore';
import { fetchAiResponse } from '../../services/aiAssistant';

type AiState = 'idle' | 'listening' | 'thinking' | 'speaking';

export default function AiAssistantScreen() {
  const [uiState, setUiState] = useState<AiState>('idle');
  const [recording, setRecording] = useState<Audio.Recording | null>(null);
  const [aiResponse, setAiResponse] = useState('');
  
  const pulseAnim = useRef(new Animated.Value(1)).current;

  // Zustand Store
  const summary = useWeatherStore((s) => s.summary);
  const originLabel = useWeatherStore((s) => s.originLabel) || 'Unknown Origin';
  const destinationLabel = useWeatherStore((s) => s.destinationLabel) || 'Unknown Destination';

  useEffect(() => {
    // Request permissions on mount
    (async () => {
      await Audio.requestPermissionsAsync();
    })();
    
    return () => {
      if (recording) {
        recording.stopAndUnloadAsync();
      }
      if (recordingTimeoutRef.current) {
        clearTimeout(recordingTimeoutRef.current);
      }
      Speech.stop();
    };
  }, []);

  useEffect(() => {
    if (uiState === 'listening') {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.2, duration: 800, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1, duration: 800, useNativeDriver: true })
        ])
      ).start();
    } else {
      pulseAnim.stopAnimation();
      pulseAnim.setValue(1);
    }
  }, [uiState]);

  const recordingStartTime = useRef<number>(0);
  const recordingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stopAndProcessRecording = async (rec: Audio.Recording) => {
    setUiState('thinking');
    try {
      const duration = Date.now() - recordingStartTime.current;
      await rec.stopAndUnloadAsync();
      const uri = rec.getURI();
      setRecording(null);

      // Reset audio mode so TTS/playback works on Android
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: true,
      });

      if (!uri) {
        setAiResponse('Recording failed — no audio file was created.');
        setUiState('idle');
        return;
      }

      // Minimum ~1 second of audio so Gemini can actually process it
      if (duration < 1000) {
        setAiResponse('Recording too short. Hold the mic for at least 1 second.');
        setUiState('idle');
        return;
      }

      processAudio(uri);
    } catch (err) {
      console.error('Failed to stop recording', err);
      setAiResponse('Failed to stop recording. Please try again.');
      setUiState('idle');
    }
  };

  const handleMicPress = async () => {
    if (uiState === 'speaking') {
      Speech.stop();
      setUiState('idle');
      return;
    }

    if (uiState === 'listening' && recording) {
      // User tapped to stop manually
      if (recordingTimeoutRef.current) {
        clearTimeout(recordingTimeoutRef.current);
        recordingTimeoutRef.current = null;
      }
      await stopAndProcessRecording(recording);
    } else if (uiState === 'idle' || uiState === 'thinking') {
      // Start listening
      setAiResponse('');
      Speech.stop();
      try {
        await Audio.setAudioModeAsync({
          allowsRecordingIOS: true,
          playsInSilentModeIOS: true,
        });
        const { recording: newRecording } = await Audio.Recording.createAsync(
          Audio.RecordingOptionsPresets.HIGH_QUALITY
        );
        setRecording(newRecording);
        recordingStartTime.current = Date.now();
        setUiState('listening');

        // Auto-stop after 30 seconds to prevent hanging
        recordingTimeoutRef.current = setTimeout(async () => {
          console.log('[AI] Auto-stopping recording after 30s');
          await stopAndProcessRecording(newRecording);
        }, 30000);
      } catch (e: any) {
        console.error('Failed to start recording', e);
        setAiResponse(`Mic error: ${e?.message || 'Could not start recording. Check mic permissions.'}`);
        setUiState('idle');
      }
    }
  };

  const processAudio = async (uri: string) => {
    try {
      const base64Audio = await FileSystem.readAsStringAsync(uri, {
        encoding: FileSystem.EncodingType.Base64,
      });

      const overallRisk = summary?.overallRisk || 'unknown';
      const firstHazardLabel = summary?.firstHazardLabel || null;
      const firstHazardMinutes = summary?.firstHazardMinutes || null;

      const responseText = await fetchAiResponse(
        base64Audio,
        originLabel,
        destinationLabel,
        overallRisk,
        firstHazardLabel,
        firstHazardMinutes
      );

      setAiResponse(responseText);
      setUiState('speaking');

      Speech.speak(responseText, {
        language: 'en-PH',
        pitch: 1.0,
        rate: 0.9,
        onDone: () => setUiState('idle'),
        onError: () => setUiState('idle'),
      });
    } catch (error: any) {
      console.error('[AI] processAudio error:', error);
      const msg = error?.message || 'Unknown error connecting to the AI.';
      setAiResponse(`Error: ${msg}`);
      setUiState('idle');
    }
  };

  // Route context chip
  let contextText = 'No active route';
  let contextColor = '#64748B';
  if (summary) {
    if (summary.overallRisk === 'high') {
      contextText = `⛈ ${summary.firstHazardLabel} in ${summary.firstHazardMinutes} min`;
      contextColor = '#EF4444';
    } else if (summary.overallRisk === 'moderate') {
      contextText = `⚠ Rain possible on route`;
      contextColor = '#F59E0B';
    } else {
      contextText = `✅ Route is clear`;
      contextColor = '#10B981';
    }
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <View style={[styles.contextChip, { borderColor: contextColor }]}>
          <Text style={[styles.contextText, { color: contextColor }]}>{contextText}</Text>
        </View>
      </View>

      <View style={styles.transcriptArea}>
        {uiState === 'listening' ? (
          <Text style={styles.transcriptText}>🎙️ Recording your voice...</Text>
        ) : uiState === 'thinking' ? (
          <Text style={styles.transcriptText}>Sending audio to Gemini...</Text>
        ) : (
          <Text style={styles.placeholderText}>Tap the mic and speak...</Text>
        )}
      </View>

      <View style={styles.centerContainer}>
        {uiState === 'thinking' && (
          <View style={styles.thinkingContainer}>
            <ActivityIndicator size="large" color="#3B82F6" />
            <Text style={styles.thinkingText}>WeatherWise is thinking...</Text>
          </View>
        )}
        
        {uiState === 'speaking' && (
          <View style={styles.speakingContainer}>
            <Ionicons name="volume-high" size={32} color="#3B82F6" />
            <Text style={styles.speakingText}>Speaking...</Text>
          </View>
        )}

        <Animated.View style={[styles.micRing, { transform: [{ scale: pulseAnim }] }]} />
        <TouchableOpacity
          style={[
            styles.micButton,
            uiState === 'listening' ? { backgroundColor: '#EF4444' } : { backgroundColor: '#3B82F6' }
          ]}
          onPress={handleMicPress}
          activeOpacity={0.8}
        >
          <Ionicons name={uiState === 'speaking' ? 'stop' : 'mic'} size={48} color="#FFF" />
        </TouchableOpacity>
        
        <Text style={styles.micLabel}>
          {uiState === 'idle' ? 'Tap to ask' : 
           uiState === 'listening' ? 'Tap to finish' : 
           uiState === 'speaking' ? 'Tap to stop' : ''}
        </Text>
      </View>

      <View style={styles.responseArea}>
        {aiResponse ? (
          <Text style={styles.responseText}>{aiResponse}</Text>
        ) : null}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0F172A', padding: 20 },
  header: { alignItems: 'center', marginTop: 40 },
  contextChip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
  },
  contextText: { fontWeight: '700', fontSize: 14 },
  transcriptArea: { flex: 1, justifyContent: 'flex-end', alignItems: 'center', paddingBottom: 40, paddingHorizontal: 20 },
  transcriptText: { color: '#FFF', fontSize: 24, fontStyle: 'italic', textAlign: 'center' },
  placeholderText: { color: '#64748B', fontSize: 18, textAlign: 'center' },
  centerContainer: { height: 250, alignItems: 'center', justifyContent: 'center' },
  micRing: {
    position: 'absolute',
    width: 140,
    height: 140,
    borderRadius: 70,
    backgroundColor: 'rgba(59, 130, 246, 0.2)',
  },
  micButton: {
    width: 100,
    height: 100,
    borderRadius: 50,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 10,
    zIndex: 10,
  },
  micLabel: { color: '#FFF', marginTop: 20, fontSize: 16, fontWeight: '600', opacity: 0.8 },
  thinkingContainer: { position: 'absolute', top: -40, alignItems: 'center' },
  thinkingText: { color: '#3B82F6', marginTop: 8, fontWeight: '600' },
  speakingContainer: { position: 'absolute', top: -40, alignItems: 'center', flexDirection: 'row' },
  speakingText: { color: '#3B82F6', marginLeft: 8, fontWeight: '700', fontSize: 18 },
  responseArea: { flex: 1, paddingTop: 30, paddingHorizontal: 20, alignItems: 'center' },
  responseText: { color: '#E2E8F0', fontSize: 18, textAlign: 'center', lineHeight: 28 },
});
