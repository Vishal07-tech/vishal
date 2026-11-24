import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const KEY = 'gemini_api_key';

/** SecureStore keeps the key in the OS keystore on device; web falls back to storage. */
export async function getGeminiKey(): Promise<string> {
  if (Platform.OS === 'web') return (await AsyncStorage.getItem(KEY)) ?? '';
  try {
    return (await SecureStore.getItemAsync(KEY)) ?? '';
  } catch {
    return '';
  }
}

export async function setGeminiKey(value: string): Promise<void> {
  const trimmed = value.trim();
  if (Platform.OS === 'web') {
    if (trimmed) await AsyncStorage.setItem(KEY, trimmed);
    else await AsyncStorage.removeItem(KEY);
    return;
  }
  if (trimmed) await SecureStore.setItemAsync(KEY, trimmed);
  else await SecureStore.deleteItemAsync(KEY);
}
