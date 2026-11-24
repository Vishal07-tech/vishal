import { fontsToLoad } from '../lib/fonts';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import { View } from 'react-native';
import { color } from '../lib/theme';

export default function RootLayout() {
  const [loaded] = useFonts(fontsToLoad);

  if (!loaded) {
    return <View style={{ flex: 1, backgroundColor: color.bg }} />;
  }

  return (
    <>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: color.bg },
          animation: 'slide_from_right',
        }}
      >
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="video/[id]" />
      </Stack>
    </>
  );
}
