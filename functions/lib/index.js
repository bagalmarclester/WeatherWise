"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendRainAlert = void 0;
const admin = __importStar(require("firebase-admin"));
const firestore_1 = require("firebase-functions/v2/firestore");
const expo_server_sdk_1 = require("expo-server-sdk");
// Initialize Firebase Admin SDK
admin.initializeApp();
const db = admin.firestore();
// Initialize Expo SDK client
const expo = new expo_server_sdk_1.Expo();
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
exports.sendRainAlert = (0, firestore_1.onDocumentCreated)('alerts/{alertId}', async (event) => {
    var _a, _b;
    const snapshot = event.data;
    if (!snapshot) {
        console.log('No data associated with the event');
        return;
    }
    const alertData = snapshot.data();
    const { minutesAway = 'unknown', waypointLat = 0, waypointLon = 0, precipProb = 0, } = alertData;
    console.log(`Rain alert triggered: ${precipProb}% chance in ${minutesAway} min at (${waypointLat}, ${waypointLon})`);
    // Fetch all stored device tokens
    const devicesSnapshot = await db.collection('devices').get();
    if (devicesSnapshot.empty) {
        console.log('No registered devices found');
        return;
    }
    // Build push notification messages
    const messages = [];
    devicesSnapshot.forEach((doc) => {
        const { token } = doc.data();
        // Validate that this is a proper Expo push token
        if (!expo_server_sdk_1.Expo.isExpoPushToken(token)) {
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
        }
        catch (error) {
            console.error('Error sending push notification chunk:', error);
        }
    }
    // Log results and clean up invalid tokens
    for (let i = 0; i < tickets.length; i++) {
        const ticket = tickets[i];
        if (ticket.status === 'error') {
            console.error(`Push notification error: ${ticket.message}`);
            // Remove invalid tokens from Firestore
            if (((_a = ticket.details) === null || _a === void 0 ? void 0 : _a.error) === 'DeviceNotRegistered' &&
                ((_b = messages[i]) === null || _b === void 0 ? void 0 : _b.to)) {
                const invalidToken = messages[i].to;
                console.log(`Removing invalid token: ${invalidToken}`);
                await db.collection('devices').doc(invalidToken).delete();
            }
        }
    }
    console.log(`Sent ${tickets.length} rain alert notification(s)`);
});
//# sourceMappingURL=index.js.map