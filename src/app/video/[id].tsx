import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { ApiError, type Reader, type Takeaway } from '../../lib/api';
import { getReader, retryVideo } from '../../lib/library';
import { cacheReader, cachedReader } from '../../lib/cache';
import { categoryLabel, duration, stageLabel } from '../../lib/format';
import { markOpened } from '../../lib/recent';
import { color, radius, space, type as fonts } from '../../lib/theme';
import { Timecode } from '../../components/timecode';
import { MomentRow } from '../../components/moment-row';
import { Formula } from '../../components/formula';
import { Card, cardStyles } from '../../components/card';

const KIND_LABEL: Record<Takeaway['kind'], string> = {
  formula: 'Formula',
  definition: 'Definition',
  number: 'Number',
  claim: 'Takeaway',
};

export default function ReaderScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [reader, setReader] = useState<Reader | null>(null);
  const [mode, setMode] = useState<'read' | 'transcript'>('read');
  const [error, setError] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const data = await getReader(String(id));
      setReader(data);
      setError(null);
      setOffline(false);
      await markOpened(String(id));
      if (data.video.status === 'ready') {
        await cacheReader(data);
      } else if (data.video.status === 'queued' || data.video.status === 'processing') {
        timer.current = setTimeout(load, 3000);
      }
    } catch (caught) {
      const cached = await cachedReader(String(id));
      if (cached) {
        setReader(cached);
        setOffline(true);
        setError(null);
      } else {
        setError(caught instanceof ApiError ? caught.message : 'Could not open this video.');
      }
    }
  }, [id]);

  useEffect(() => {
    load();
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [load]);

  const video = reader?.video;
  const moments = reader?.moments ?? [];
  const takeaways = reader?.takeaways ?? [];
  const segments = reader?.segments ?? [];

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.topBar}>
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          hitSlop={10}
          style={styles.back}
        >
          <Ionicons name="chevron-back" size={18} color={color.muted} />
          <Text style={styles.topAction}>Library</Text>
        </Pressable>
        {video ? (
          <Pressable
            accessibilityRole="link"
            hitSlop={10}
            onPress={() => Linking.openURL(`https://youtu.be/${video.youtube_id}`)}
            style={styles.back}
          >
            <Text style={styles.topAction}>YouTube</Text>
            <Ionicons name="open-outline" size={15} color={color.muted} />
          </Pressable>
        ) : null}
      </View>

      {!reader && !error ? (
        <View style={styles.center}>
          <ActivityIndicator color={color.accent} />
        </View>
      ) : null}

      {error ? (
        <View style={styles.center}>
          <Text style={styles.error}>{error}</Text>
          <Pressable onPress={load} style={styles.smallAction} accessibilityRole="button">
            <Text style={styles.smallActionLabel}>Try again</Text>
          </Pressable>
        </View>
      ) : null}

      {video ? (
        <View style={styles.body}>
          <View style={styles.head}>
            <Text style={styles.title}>{video.title ?? 'Untitled video'}</Text>
            <Text style={styles.meta}>
              {[
                video.channel,
                duration(video.duration_s),
                categoryLabel(video.category),
                video.fetch_tier === 'captions' ? 'from captions' : null,
              ]
                .filter(Boolean)
                .join('  ·  ')}
            </Text>
            {offline ? <Text style={styles.offline}>Offline copy</Text> : null}
          </View>

          {video.status === 'failed' ? (
            <Card title="IT DID NOT FINISH" glyph="!" accentGlyph>
              <Text style={cardStyles.body}>{video.error ?? 'The server stopped partway.'}</Text>
              <Pressable
                accessibilityRole="button"
                onPress={async () => {
                  await retryVideo(video.id);
                  load();
                }}
                style={({ pressed }) => [styles.smallAction, pressed && styles.pressed]}
              >
                <Text style={styles.smallActionLabel}>Run it again</Text>
              </Pressable>
            </Card>
          ) : null}

          {video.status === 'queued' || video.status === 'processing' ? (
            <Card title="WORKING" glyph="✦" accentGlyph>
              <Text style={styles.stateTitle}>{stageLabel(video.stage)}</Text>
              <View style={styles.track}>
                <View
                  style={[
                    styles.fill,
                    { width: `${Math.max(6, Math.round(video.progress * 100))}%` },
                  ]}
                />
              </View>
              <Text style={cardStyles.body}>This screen updates itself.</Text>
            </Card>
          ) : null}

          {video.status === 'ready' && mode === 'read' ? (
            <ScrollView contentContainerStyle={styles.readContent} showsVerticalScrollIndicator={false}>
              {video.summary ? (
                <View style={styles.summaryCard}>
                  <Text style={styles.summary}>{video.summary}</Text>
                </View>
              ) : (
                <Text style={cardStyles.body}>No summary was kept for this one.</Text>
              )}

              {moments.length ? (
                <Card title="KEY MOMENTS" glyph="❙" accentGlyph right={<Text style={styles.side}>{moments.length}</Text>}>
                  {moments.map((moment) => (
                    <MomentRow key={moment.idx} moment={moment} videoId={video.youtube_id} />
                  ))}
                </Card>
              ) : null}

              {takeaways.length ? (
                <Card title="WORTH KEEPING" glyph="◆" right={<Text style={styles.side}>{takeaways.length}</Text>}>
                  {takeaways.map((item) => (
                    <View key={item.idx} style={styles.takeaway}>
                      <View style={styles.takeawayHead}>
                        <Text style={styles.kind}>{KIND_LABEL[item.kind] ?? 'Takeaway'}</Text>
                        <Timecode videoId={video.youtube_id} startMs={item.start_ms} tone="muted" />
                      </View>
                      <Text style={styles.takeawayText}>{item.text}</Text>
                      {item.latex ? <Formula latex={item.latex} /> : null}
                    </View>
                  ))}
                </Card>
              ) : null}
            </ScrollView>
          ) : null}

          {video.status === 'ready' && mode === 'transcript' ? (
            <FlatList
              data={segments}
              keyExtractor={(item) => String(item.idx)}
              contentContainerStyle={styles.transcriptContent}
              initialNumToRender={40}
              windowSize={9}
              renderItem={({ item }) => (
                <View style={styles.segment}>
                  <View style={styles.segmentTime}>
                    <Timecode videoId={video.youtube_id} startMs={item.start_ms} tone="muted" />
                  </View>
                  <Text style={styles.segmentText}>{item.text}</Text>
                </View>
              )}
              ListEmptyComponent={
                <Text style={cardStyles.body}>The transcript is not available for this video.</Text>
              }
            />
          ) : null}
        </View>
      ) : null}

      {video?.status === 'ready' ? (
        <View style={styles.switchBar}>
          {(['read', 'transcript'] as const).map((value) => {
            const active = mode === value;
            return (
              <Pressable
                key={value}
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}
                onPress={() => setMode(value)}
                style={styles.switchItem}
              >
                <Text style={[styles.switchLabel, active && styles.switchLabelActive]}>
                  {value === 'read' ? 'Read' : 'Transcript'}
                </Text>
                <View style={[styles.switchMark, active && styles.switchMarkActive]} />
              </Pressable>
            );
          })}
        </View>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bg },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
  },
  back: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  topAction: { fontFamily: fonts.sansMedium, fontSize: 13, color: color.muted },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.lg, gap: space.md },
  error: {
    fontFamily: fonts.sans,
    fontSize: 14,
    lineHeight: 21,
    color: color.danger,
    textAlign: 'center',
  },
  body: { flex: 1 },
  head: { paddingHorizontal: space.lg, paddingBottom: space.md, gap: 6 },
  title: { fontFamily: fonts.sansBold, fontSize: 21, lineHeight: 29, color: color.text },
  meta: { fontFamily: fonts.sans, fontSize: 12.5, color: color.faint },
  offline: { fontFamily: fonts.sansMedium, fontSize: 12, color: color.danger },
  stateTitle: { fontFamily: fonts.sansSemi, fontSize: 15, color: color.text },
  track: {
    height: 3,
    borderRadius: 2,
    backgroundColor: color.border,
    overflow: 'hidden',
    marginVertical: space.xs,
  },
  fill: { height: '100%', backgroundColor: color.accent },
  smallAction: {
    alignSelf: 'flex-start',
    paddingVertical: 9,
    paddingHorizontal: 14,
    borderRadius: 8,
    backgroundColor: color.accent,
  },
  smallActionLabel: { fontFamily: fonts.sansSemi, fontSize: 13, color: color.accentInk },
  pressed: { opacity: 0.8 },
  readContent: { paddingHorizontal: space.lg, paddingBottom: 96, gap: space.md },
  summaryCard: {
    borderWidth: 1,
    borderColor: color.border,
    backgroundColor: color.surface,
    borderRadius: radius.card,
    padding: space.lg,
  },
  summary: { fontFamily: fonts.serif, fontSize: 16.5, lineHeight: 28, color: color.text },
  side: { fontFamily: fonts.sans, fontSize: 11.5, color: color.faint },
  takeaway: { paddingVertical: space.sm, gap: 5 },
  takeawayHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  kind: {
    fontFamily: fonts.sansSemi,
    fontSize: 9.5,
    letterSpacing: 1,
    color: color.muted,
  },
  takeawayText: { fontFamily: fonts.serif, fontSize: 15.5, lineHeight: 24, color: color.text },
  transcriptContent: { paddingHorizontal: space.lg, paddingBottom: 96 },
  segment: { flexDirection: 'row', gap: space.md, paddingVertical: 6 },
  segmentTime: { width: 46, paddingTop: 3 },
  segmentText: { flex: 1, fontFamily: fonts.serif, fontSize: 16, lineHeight: 26, color: color.text },
  switchBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: color.border,
    backgroundColor: '#0C0C0D',
    paddingBottom: space.sm,
  },
  switchItem: { flex: 1, alignItems: 'center', paddingTop: space.md, gap: 6 },
  switchLabel: { fontFamily: fonts.sansMedium, fontSize: 13.5, color: color.faint },
  switchLabelActive: { color: color.text },
  switchMark: { height: 2, width: 22, borderRadius: 1, backgroundColor: 'transparent' },
  switchMarkActive: { backgroundColor: color.accent },
});
