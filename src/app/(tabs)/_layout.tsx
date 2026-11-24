import { Tabs } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { color, hairline, space, type as fonts } from '../../lib/theme';

type BarProps = {
  state: { index: number; routes: { key: string; name: string }[] };
  descriptors: Record<string, { options: { title?: string } }>;
  navigateToTab: (routeKey: string) => void;
};

const ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  index: 'grid-outline',
  reader: 'book-outline',
  add: 'add',
  settings: 'options-outline',
};

function TabBar({ state, descriptors, navigateToTab }: BarProps) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, space.sm) }]}>
      {state.routes.map((route, index) => {
        const focused = state.index === index;
        const title = descriptors[route.key]?.options.title ?? route.name;

        if (route.name === 'add') {
          return (
            <Pressable
              key={route.key}
              accessibilityRole="tab"
              accessibilityLabel="Add a video"
              onPress={() => navigateToTab(route.key)}
              style={styles.fabSlot}
            >
              <View style={styles.fab}>
                <Ionicons name="add" size={30} color={color.accentInk} />
              </View>
              <Text style={styles.fabLabel}>Add</Text>
            </Pressable>
          );
        }

        return (
          <Pressable
            key={route.key}
            accessibilityRole="tab"
            accessibilityState={{ selected: focused }}
            onPress={() => {
              if (!focused) navigateToTab(route.key);
            }}
            style={styles.item}
          >
            <Ionicons
              name={ICONS[route.name] ?? 'ellipse-outline'}
              size={21}
              color={focused ? color.accent : color.faint}
            />
            <Text style={[styles.label, focused && styles.labelActive]}>{title}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export default function TabsLayout() {
  return (
    <Tabs
      tabBar={(props) => <TabBar {...props} />}
      screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: color.bg } }}
    >
      <Tabs.Screen name="index" options={{ title: 'Library' }} />
      <Tabs.Screen name="reader" options={{ title: 'Reader' }} />
      <Tabs.Screen name="add" options={{ title: 'Add' }} />
      <Tabs.Screen name="settings" options={{ title: 'Settings' }} />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    borderTopWidth: hairline,
    borderTopColor: color.border,
    backgroundColor: '#0C0C0D',
    paddingTop: space.sm,
  },
  item: { flex: 1, alignItems: 'center', gap: 5, paddingBottom: 2 },
  label: { fontFamily: fonts.sansMedium, fontSize: 11, color: color.faint },
  labelActive: { color: color.accent },
  fabSlot: { flex: 1, alignItems: 'center', gap: 3, marginTop: -22 },
  fab: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: color.accent,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 4,
    borderColor: '#0C0C0D',
  },
  fabLabel: { fontFamily: fonts.sansMedium, fontSize: 11, color: color.text, marginTop: 2 },
});
