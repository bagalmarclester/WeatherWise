import Constants from 'expo-constants';

const PRODUCTION_PROXY_URL = 'https://weatherwise-0im8.onrender.com';

export function getProxyBaseUrl(): string {
  // If explicitly overridden via environment variable:
  if (process.env.EXPO_PUBLIC_PROXY_URL) {
    return process.env.EXPO_PUBLIC_PROXY_URL;
  }

  // When developing locally with Metro bundler connected:
  const hostUri = Constants.expoConfig?.hostUri ?? '';
  const ip = hostUri.split(':')[0];
  if (ip && ip !== 'localhost' && ip !== '127.0.0.1') {
    return `http://${ip}:3000`;
  }

  // Standalone release APK, external beta testers, or web:
  return PRODUCTION_PROXY_URL;
}
