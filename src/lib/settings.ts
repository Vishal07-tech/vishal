import AsyncStorage from '@react-native-async-storage/async-storage';

export type Settings = {
  baseUrl: string;
  token: string;
};

const KEY = 'vishal.settings.v1';

export const DEFAULT_SETTINGS: Settings = {
  baseUrl: '',
  token: '',
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
