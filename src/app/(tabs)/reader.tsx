import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import type { Video } from '../../lib/api';
import { listVideos } from '../../lib/library';
import { cachedLibrary } from '../../lib/cache';
import { categoryLabel, duration } from '../../lib/format';
import { getRecent } from '../../lib/recent';
import { color, radius, space, type as fonts } from '../../lib/theme';
import { BrandHeader } from '../../components/brand-header';
import { Empty } from '../../components/empty';

export default function ReaderScreen() {
  const router = useRouter();
  const [videos, setVideos] = useState<Video[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    let base: Video[] = [];
    try {
      const fresh = await listVideos();
      base = fresh;
    } catch {
      base = await cachedLibrary();
    }
    const recent = await getRecent();
    base.sort((a, b) => (recent[b.id] ?? 0) - (recent[a.id] ?? 0));
    setVideos(base);
    setLoading(false);
    setRefreshing(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.header}>
        <BrandHeader />
      </View>

      <View style={styles.titleRow}>
        <Text style={styles.heading}>Reader</Text>
        <Text style={styles.count}>Notes you kept</Text>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={color.accent} />
        </View>
      ) : (
        <FlatList
          data={videos}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              tintColor={color.accent}
              colors={[color.accent]}
              progressBackgroundColor={color.surface}
              onRefresh={() => {
                setRefreshing(true);
                load();
              }}
            />
          }
          ListEmptyComponent={
            <Empty
              title="Nothing to read yet"
              body="Once a video is processed, its notes wait here. Add one and come back."
              actionLabel="Add Video"
              onAction={() => router.push('/add')}
            />
          }
          renderItem={({ item }) => (
            <Pressable
              onPress={() => router.push(`/video/${item.id}`)}
              style={({ pressed }) => [styles.card, pressed && styles.pressed]}
            >
              <View style={styles.cardHead}>
                <Text style={styles.chip}>
                  {categoryLabel(item.category) || 'Unfiled'}
                </Text>
                <Text style={styles.duration}>{duration(item.duration_s)}</Text>
              </View>
              <Text style={styles.title} numberOfLines={2}>
                {item.title ?? 'Untitled video'}
              </Text>
              <Text style={styles.summary} numberOfLines={3}>
                {item.summary || item.gist || 'No summary was kept.'}
              </Text>
              <View style={styles.footer}>
                <Text style={styles.open}>Open notes</Text>
                <Ionicons name="chevron-forward" size={15} color={color.accent} />
              </View>
            </Pressable>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bg },
  header: { paddingHorizontal: space.lg, paddingTop: space.sm },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    paddingHorizontal: space.lg,
    paddingTop: space.xl,
    paddingBottom: space.md,
  },
  heading: { fontFamily: fonts.sansBold, fontSize: 24, color: color.text },
  count: { fontFamily: fonts.sans, fontSize: 13, color: color.faint },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  list: { paddingHorizontal: space.lg, paddingBottom: space.xxl, gap: space.md, flexGrow: 1 },
  card: {
    backgroundColor: color.surface,
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radius.card,
    padding: space.lg,
    gap: space.sm,
  },
  pressed: { opacity: 0.7 },
  cardHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  chip: {
    fontFamily: fonts.sansSemi,
    fontSize: 9.5,
    letterSpacing: 0.9,
    color: color.accent,
  },
  duration: { fontFamily: fonts.sans, fontSize: 11.5, color: color.faint },
  title: { fontFamily: fonts.sansSemi, fontSize: 17, lineHeight: 24, color: color.text },
  summary: {
    fontFamily: fonts.serif,
    fontSize: 14.5,
    lineHeight: 23,
    color: color.muted,
  },
  footer: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingTop: space.xs },
  open: { fontFamily: fonts.sansSemi, fontSize: 12.5, color: color.accent },
});
