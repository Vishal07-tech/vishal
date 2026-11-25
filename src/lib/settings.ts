import AsyncStorage from '@react-native-async-storage/async-storage';

export type Settings = {
  baseUrl: string;
  token: string;
};

const KEY = 'vishal.settings.v1';

// The hosted server is the default so a fresh install works straight away.
// Both values can be overridden at build time with EXPO_PUBLIC_* variables,
// which keeps the access token out of the repository.
export const DEFAULT_SETTINGS: Settings = {
  baseUrl: normaliseBaseUrl(process.env.EXPO_PUBLIC_API_URL || 'https://vishal-api.fly.dev'),
  token: process.env.EXPO_PUBLIC_API_TOKEN || '',
};

export async function getSettings(): Promise<Settings> {
  const raw = await AsyncStorage.getItem(KEY);
  if (!raw) return DEFAULT_SETTINGS;
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export async function saveSettings(next: Settings): Promise<void> {
  await AsyncStorage.setItem(KEY, JSON.stringify(next));
}

export function normaliseBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, '');
}
