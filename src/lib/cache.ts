import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Reader, Video } from './api';

const readerKey = (id: string) => `vishal.reader.${id}`;
const LIBRARY_KEY = 'vishal.library.v1';

export async function cacheReader(reader: Reader): Promise<void> {
  await AsyncStorage.setItem(readerKey(reader.video.id), JSON.stringify(reader));
}

export async function cachedReader(id: string): Promise<Reader | null> {
  const raw = await AsyncStorage.getItem(readerKey(id));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Reader;
  } catch {
    return null;
  }
}

export async function cacheLibrary(videos: Video[]): Promise<void> {
  await AsyncStorage.setItem(LIBRARY_KEY, JSON.stringify(videos));
}

export async function cachedLibrary(): Promise<Video[]> {
  const raw = await AsyncStorage.getItem(LIBRARY_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as Video[];
  } catch {
    return [];
  }
}

export async function clearCache(): Promise<void> {
  const keys = await AsyncStorage.getAllKeys();
  await AsyncStorage.multiRemove(keys.filter((key) => key.startsWith('vishal.')));
}
