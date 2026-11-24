import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'vishal.recent.v1';

export async function getRecent(): Promise<Record<string, number>> {
  const raw = await AsyncStorage.getItem(KEY);
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, number>;
  } catch {
    return {};
  }
}

export async function markOpened(id: string): Promise<void> {
  const map = await getRecent();
  map[id] = Date.now();
  await AsyncStorage.setItem(KEY, JSON.stringify(map));
}
