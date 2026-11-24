import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import type { Video } from '../../lib/api';
import { listVideos } from '../../lib/library';
import { cacheLibrary, cachedLibrary } from '../../lib/cache';
import { categoryLabel, duration, since } from '../../lib/format';
import { color, radius, space, type as fonts } from '../../lib/theme';
import { BrandHeader } from '../../components/brand-header';
import { Empty } from '../../components/empty';

export default function LibraryScreen() {
  const router = useRouter();
  const [videos, setVideos] = useState<Video[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [offline, setOffline] = useState(false);
  const [query, setQuery] = useState('');

  const load = useCallback(async (showSpinner: boolean, term?: string) => {
    if (showSpinner) setLoading(true);
    try {
      const fresh = await listVideos(term || undefined);
      setVideos(fresh);
      setOffline(false);
      if (!term) await cacheLibrary(fresh);
    } catch {
      const cached = await cachedLibrary();
      setVideos(
        term
          ? cached.filter((v) =>
              `${v.title} ${v.gist}`.toLowerCase().includes(term.toLowerCase()),
            )
          : cached,
      );
      setOffline(true);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load(true, query);
    }, [load, query]),
  );

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.header}>
        <BrandHeader />
      </View>

      <View style={styles.titleRow}>
        <Text style={styles.heading}>Library</Text>
        <Text style={styles.count}>
          {videos.length} {videos.length === 1 ? 'note' : 'notes'}
        </Text>
      </View>

      <View style={styles.search}>
        <Ionicons name="search-outline" size={17} color={color.faint} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search what you saved"
          placeholderTextColor={color.faint}
          autoCapitalize="none"
          autoCorrect={false}
          style={styles.searchInput}
          returnKeyType="search"
        />
      </View>

      {offline ? (
        <Text style={styles.offline}>Offline — showing the copies on this phone.</Text>
      ) : null}

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
                load(false);
              }}
            />
          }
          ListEmptyComponent={
            <Empty
              title={query ? 'Nothing matched' : 'No notes yet'}
              body={
                query
                  ? 'Try a shorter word, or the speaker’s name.'
                  : 'Paste a link and it becomes a page you can read instead of two hours you cannot.'
              }
              actionLabel={query ? undefined : 'Add Video'}
              onAction={query ? undefined : () => router.push('/add')}
            />
          }
          renderItem={({ item }) => (
            <Pressable
              onPress={() => router.push(`/video/${item.id}`)}
              style={({ pressed }) => [styles.card, pressed && styles.pressed]}
            >
              <View style={styles.cardTop}>
                <View style={styles.chip}>
                  <Text style={styles.chipText}>
                    {categoryLabel(item.category) || 'Unfiled'}
                  </Text>
                </View>
                <Text style={styles.time}>
                  {[duration(item.duration_s), since(item.created_at)]
                    .filter(Boolean)
                    .join('  ·  ')}
                </Text>
              </View>
              <Text style={styles.cardTitle} numberOfLines={2}>
                {item.title ?? 'Untitled video'}
              </Text>
              {item.gist ? (
                <Text style={styles.gist} numberOfLines={2}>
                  {item.gist}
                </Text>
              ) : null}
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
  },
  heading: { fontFamily: fonts.sansBold, fontSize: 24, color: color.text },
  count: { fontFamily: fonts.sans, fontSize: 13, color: color.faint },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    marginHorizontal: space.lg,
    marginTop: space.md,
    paddingHorizontal: space.md,
    height: 44,
    borderRadius: radius.chip,
    backgroundColor: color.surface,
    borderWidth: 1,
    borderColor: color.border,
  },
  searchInput: { flex: 1, fontFamily: fonts.sans, fontSize: 14, color: color.text },
  offline: {
    fontFamily: fonts.sans,
    fontSize: 12,
    color: color.danger,
    paddingHorizontal: space.lg,
    paddingTop: space.sm,
  },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  list: { padding: space.lg, gap: space.md, paddingBottom: space.xxl, flexGrow: 1 },
  card: {
    backgroundColor: color.surface,
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radius.card,
    padding: space.lg,
    gap: space.sm,
  },
  pressed: { opacity: 0.7 },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  chip: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: color.raised,
  },
  chipText: {
    fontFamily: fonts.sansSemi,
    fontSize: 9.5,
    letterSpacing: 0.9,
    color: color.accent,
  },
  time: { fontFamily: fonts.sans, fontSize: 11.5, color: color.faint },
  cardTitle: {
    fontFamily: fonts.sansSemi,
    fontSize: 17,
    lineHeight: 24,
    color: color.text,
  },
  gist: { fontFamily: fonts.sans, fontSize: 13.5, lineHeight: 20, color: color.muted },
});
