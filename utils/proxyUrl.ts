import Constants from 'expo-constants';

export function getProxyBaseUrl(): string {
  const hostUri = Constants.expoConfig?.hostUri ?? '';
  const ip = hostUri.split(':')[0]; // strip Metro bundler port
  if (!ip) return 'http://localhost:3000'; // fallback for web
  return `http://${ip}:3000`;
}
