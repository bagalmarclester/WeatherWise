import * as admin from 'firebase-admin';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { Expo, ExpoPushMessage } from 'expo-server-sdk';

// Initialize Firebase Admin SDK
admin.initializeApp();
const db = admin.firestore();

// Initialize Expo SDK client
const expo = new Expo();

/**
 * Cloud Function: sendRainAlert
 *
 * Triggered when a new document is created in the "alerts" Firestore collection.
 * Reads all stored device tokens from the "devices" collection and sends a
 * push notification to each one with rain alert details.
 *
 * Expected alert document fields:
 *   - minutesAway: number     — Minutes until rain at the waypoint
 *   - waypointLat: number     — Latitude of the affected waypoint
 *   - waypointLon: number     — Longitude of the affected waypoint
 *   - precipProb: number      — Precipitation probability (0-100)
 */
export const sendRainAlert = onDocumentCreated('alerts/{alertId}', async (event) => {
  const snapshot = event.data;
  if (!snapshot) {
    console.log('No data associated with the event');
    return;
  }

  const alertData = snapshot.data();
  const {
    minutesAway = 'unknown',
    waypointLat = 0,
    waypointLon = 0,
    precipProb = 0,
  } = alertData;

  console.log(`Rain alert triggered: ${precipProb}% chance in ${minutesAway} min at (${waypointLat}, ${waypointLon})`);

  // Fetch all stored device tokens
  const devicesSnapshot = await db.collection('devices').get();

  if (devicesSnapshot.empty) {
    console.log('No registered devices found');
    return;
  }

  // Build push notification messages
  const messages: ExpoPushMessage[] = [];

  devicesSnapshot.forEach((doc) => {
    const { token } = doc.data();

    // Validate that this is a proper Expo push token
    if (!Expo.isExpoPushToken(token)) {
      console.warn(`Invalid Expo push token: ${token}, skipping`);
      return;
    }

    messages.push({
      to: token,
      sound: 'default',
      title: '⛈ Rain Alert — WeatherWise',
      body: `Heavy rain expected in ${minutesAway} min at your waypoint. Tap to see alternative routes.`,
      data: {
        waypointLat,
        waypointLon,
        precipProb,
      },
      priority: 'high',
      channelId: 'rain-alerts',
    });
  });

  if (messages.length === 0) {
    console.log('No valid push tokens to send to');
    return;
  }

  // Send notifications in chunks (Expo SDK handles batching)
  const chunks = expo.chunkPushNotifications(messages);
  const tickets = [];

  for (const chunk of chunks) {
    try {
      const ticketChunk = await expo.sendPushNotificationsAsync(chunk);
      console.log('Push notification tickets:', ticketChunk);
      tickets.push(...ticketChunk);
    } catch (error) {
      console.error('Error sending push notification chunk:', error);
    }
  }

  // Log results and clean up invalid tokens
  for (let i = 0; i < tickets.length; i++) {
    const ticket = tickets[i];
    if (ticket.status === 'error') {
      console.error(`Push notification error: ${ticket.message}`);

      // Remove invalid tokens from Firestore
      if (
        ticket.details?.error === 'DeviceNotRegistered' &&
        messages[i]?.to
      ) {
        const invalidToken = messages[i].to as string;
        console.log(`Removing invalid token: ${invalidToken}`);
        await db.collection('devices').doc(invalidToken).delete();
      }
    }
  }

  console.log(`Sent ${tickets.length} rain alert notification(s)`);
});
