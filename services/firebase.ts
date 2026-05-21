import { initializeApp } from 'firebase/app';
import { getFirestore, doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { Platform } from 'react-native';

const firebaseConfig = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
};

let db: any = null;
let auth: any = null;

try {
  const app = initializeApp(firebaseConfig);
  db = getFirestore(app);
  auth = getAuth(app);
} catch (error) {
  console.warn("Firebase skipped: Missing or invalid API key");
}

export { db, auth };

export const signIn = async () => {
  if (!auth) {
    console.warn('Firebase Auth not initialized');
    return null;
  }
  try {
    const userCredential = await signInAnonymously(auth);
    return userCredential.user;
  } catch (error) {
    console.error('Firebase Auth Error:', error);
    throw error;
  }
};

/**
 * Saves an Expo push token to Firestore under the "devices" collection.
 * Uses the token string as the document ID for easy deduplication.
 *
 * @param token - The Expo push token string (e.g. "ExponentPushToken[xxx]")
 */
export const saveExpoPushToken = async (token: string): Promise<void> => {
  if (!db) {
    console.warn('Firestore not initialized');
    return;
  }
  try {
    const deviceRef = doc(db, 'devices', token);
    await setDoc(deviceRef, {
      token,
      createdAt: serverTimestamp(),
      platform: Platform.OS,
    }, { merge: true });
    console.log('Expo push token saved to Firestore:', token);
  } catch (error) {
    console.error('Failed to save Expo push token:', error);
    throw error;
  }
};
