import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { ApiError, type Video } from '../../lib/api';
import { addVideo, getVideo, retryVideo } from '../../lib/library';
import { stageLabel } from '../../lib/format';
import { color, radius, space, type as fonts } from '../../lib/theme';
import { BrandHeader } from '../../components/brand-header';

export default function AddScreen() {
  const router = useRouter();
  const [url, setUrl] = useState('');
  const [job, setJob] = useState<Video | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const poll = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (poll.current) {
      clearInterval(poll.current);
      poll.current = null;
    }
  }, []);

  useEffect(() => stopPolling, [stopPolling]);

  const watch = useCallback(
    (id: string) => {
      stopPolling();
      poll.current = setInterval(async () => {
        try {
          const video = await getVideo(id);
          setJob(video);
          if (video.status === 'ready') {
            stopPolling();
            setJob(null);
            setUrl('');
            router.push(`/video/${id}`);
          } else if (video.status === 'failed') {
            stopPolling();
          }
        } catch {
          /* a dropped poll is not a failure */
        }
      }, 3000);
    },
    [router, stopPolling],
  );

  async function submit() {
    setError(null);
    setBusy(true);
    try {
      const { video } = await addVideo(url.trim());
      setJob(video);
      if (video.status === 'ready') {
        setUrl('');
        router.push(`/video/${video.id}`);
      } else if (video.status !== 'failed') {
        watch(video.id);
      }
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not add that video.');
    } finally {
      setBusy(false);
    }
  }

  async function retry() {
    if (!job) return;
    setError(null);
    try {
      const video = await retryVideo(job.id);
      setJob(video);
      watch(video.id);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not retry.');
    }
  }

  async function paste() {
    try {
      const text = await Clipboard.getStringAsync();
      if (text) setUrl(text.trim());
    } catch {
      setError('This browser will not share the clipboard. Paste with the keyboard instead.');
    }
  }

  const processing = !!job && (job.status === 'queued' || job.status === 'processing');

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.flex}
      >
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <BrandHeader showAdd={false} />

          <Text style={styles.heading}>Add a video</Text>
          <Text style={styles.lede}>
            Paste a YouTube link. Long talks are the point — an hour becomes a page you can finish
            on the way to work.
          </Text>

          <View style={styles.field}>
            <TextInput
              value={url}
              onChangeText={setUrl}
              placeholder="https://youtube.com/watch?v=…"
              placeholderTextColor={color.faint}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              editable={!processing}
              style={styles.input}
              onSubmitEditing={submit}
              returnKeyType="go"
            />
            <Pressable onPress={paste} accessibilityRole="button" hitSlop={8}>
              <Ionicons name="clipboard-outline" size={19} color={color.muted} />
            </Pressable>
          </View>

          <Pressable
            onPress={submit}
            disabled={busy || !url.trim() || processing}
            accessibilityRole="button"
            style={({ pressed }) => [
              styles.primary,
              (busy || !url.trim() || processing) && styles.disabled,
              pressed && styles.pressed,
            ]}
          >
            {busy ? (
              <ActivityIndicator color={color.accentInk} size="small" />
            ) : (
              <>
                <Ionicons name="sparkles-outline" size={18} color={color.accentInk} />
                <Text style={styles.primaryLabel}>Add Video</Text>
              </>
            )}
          </Pressable>

          {error ? (
            <View style={styles.errorBox}>
              <Text style={styles.error}>{error}</Text>
              {/Settings/.test(error) ? (
                <Pressable
                  onPress={() => router.push('/settings')}
                  accessibilityRole="button"
                  style={({ pressed }) => [styles.errorAction, pressed && styles.pressed]}
                >
                  <Text style={styles.errorActionLabel}>Open Settings</Text>
                  <Ionicons name="arrow-forward" size={14} color={color.accent} />
                </Pressable>
              ) : null}
            </View>
          ) : null}

          {job ? (
            <View style={styles.card}>
              <View style={styles.cardHead}>
                <Text style={styles.cardTitle} numberOfLines={2}>
                  {job.title ?? 'Reading the link'}
                </Text>
                {processing ? (
                  <Text style={styles.live}>WORKING</Text>
                ) : (
                  <Text style={styles.failed}>STOPPED</Text>
                )}
              </View>

              {job.status === 'failed' ? (
                <>
                  <Text style={styles.cardError}>{job.error ?? 'Something went wrong.'}</Text>
                  <Pressable onPress={retry} style={styles.ghost} accessibilityRole="button">
                    <Text style={styles.ghostLabel}>Run it again</Text>
                  </Pressable>
                </>
              ) : (
                <>
                  <Text style={styles.stage}>{stageLabel(job.stage)}</Text>
                  <View style={styles.track}>
                    <View
                      style={[
                        styles.fill,
                        { width: `${Math.max(6, Math.round(job.progress * 100))}%` },
                      ]}
                    />
                  </View>
                  <Text style={styles.hint}>
                    Safe to leave. It keeps running and lands in Library when it is done.
                  </Text>
                </>
              )}
            </View>
          ) : (
            <Text style={styles.footnote}>
              The transcript is checked word by word against the audio before any note is shown, so
              nothing gets invented.
            </Text>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bg },
  flex: { flex: 1 },
  content: { paddingHorizontal: space.lg, paddingTop: space.sm, paddingBottom: space.xxl },
  heading: {
    fontFamily: fonts.sansBold,
    fontSize: 24,
    color: color.text,
    marginTop: space.xl,
  },
  lede: {
    fontFamily: fonts.sans,
    fontSize: 14,
    lineHeight: 21,
    color: color.muted,
    marginTop: space.sm,
    marginBottom: space.xl,
  },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.md,
    height: 50,
    borderRadius: 10,
    backgroundColor: color.surface,
    borderWidth: 1,
    borderColor: color.borderStrong,
  },
  input: { flex: 1, fontFamily: fonts.sans, fontSize: 15, color: color.text },
  primary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    height: 50,
    borderRadius: 10,
    backgroundColor: color.accent,
    marginTop: space.md,
  },
  disabled: { opacity: 0.35 },
  pressed: { opacity: 0.8 },
  primaryLabel: { fontFamily: fonts.sansSemi, fontSize: 15, color: color.accentInk },
  errorBox: { marginTop: space.md, gap: space.sm },
  error: {
    fontFamily: fonts.sans,
    fontSize: 13.5,
    lineHeight: 20,
    color: color.danger,
  },
  errorAction: { flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start' },
  errorActionLabel: { fontFamily: fonts.sansSemi, fontSize: 13, color: color.accent },
  card: {
    marginTop: space.xl,
    padding: space.lg,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: color.border,
    backgroundColor: color.surface,
    gap: space.sm,
  },
  cardHead: { flexDirection: 'row', gap: space.sm, alignItems: 'flex-start' },
  cardTitle: { flex: 1, fontFamily: fonts.sansSemi, fontSize: 15.5, lineHeight: 22, color: color.text },
  live: {
    fontFamily: fonts.sansSemi,
    fontSize: 9.5,
    letterSpacing: 1,
    color: color.accent,
    paddingTop: 4,
  },
  failed: {
    fontFamily: fonts.sansSemi,
    fontSize: 9.5,
    letterSpacing: 1,
    color: color.danger,
    paddingTop: 4,
  },
  stage: { fontFamily: fonts.sans, fontSize: 13, color: color.muted },
  cardError: { fontFamily: fonts.sans, fontSize: 13, lineHeight: 20, color: color.danger },
  hint: { fontFamily: fonts.sans, fontSize: 12.5, lineHeight: 19, color: color.faint },
  track: {
    height: 3,
    borderRadius: 2,
    backgroundColor: color.border,
    overflow: 'hidden',
    marginVertical: space.xs,
  },
  fill: { height: '100%', backgroundColor: color.accent },
  ghost: {
    alignSelf: 'flex-start',
    marginTop: space.xs,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: color.borderStrong,
  },
  ghostLabel: { fontFamily: fonts.sansMedium, fontSize: 13, color: color.text },
  footnote: {
    fontFamily: fonts.sans,
    fontSize: 12.5,
    lineHeight: 19,
    color: color.faint,
    marginTop: space.xl,
  },
});
