import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api, ApiError } from '../../lib/api';
import { clearCache } from '../../lib/cache';
import { getGeminiKey, setGeminiKey } from '../../lib/keys';
import { GEMINI_MODEL, testGeminiKey, GeminiError } from '../../lib/gemini';
import { getSettings, saveSettings, normaliseBaseUrl } from '../../lib/settings';
import { color, radius, space, type as fonts } from '../../lib/theme';
import { BrandHeader } from '../../components/brand-header';
import { Card, cardStyles } from '../../components/card';

export default function SettingsScreen() {
  const [geminiKey, setGemini] = useState('');
  const [hasKey, setHasKey] = useState(false);
  const [saved, setSaved] = useState(false);
  const [savingKey, setSavingKey] = useState(false);
  const [keyNote, setKeyNote] = useState<string | null>(null);
  const [keyTone, setKeyTone] = useState<'ok' | 'bad'>('ok');

  const [baseUrl, setBaseUrl] = useState('');
  const [token, setToken] = useState('');
  const [serverNote, setServerNote] = useState<string | null>(null);
  const [serverTone, setServerTone] = useState<'ok' | 'bad'>('ok');
  const [testingServer, setTestingServer] = useState(false);

  const [noteCount, setNoteCount] = useState(0);

  const countNotes = useCallback(async () => {
    const keys = await AsyncStorage.getAllKeys();
    setNoteCount(keys.filter((key) => key.startsWith('vishal.reader.')).length);
  }, []);

  useEffect(() => {
    getGeminiKey().then((value) => {
      setHasKey(!!value);
      setGemini(value);
    });
    getSettings().then((settings) => {
      setBaseUrl(settings.baseUrl);
      setToken(settings.token);
    });
    countNotes();
  }, [countNotes]);

  useFocusEffect(
    useCallback(() => {
      countNotes();
    }, [countNotes]),
  );

  async function saveAndTestKey() {
    if (!geminiKey.trim()) {
      setKeyNote('Paste a key first.');
      setKeyTone('bad');
      return;
    }
    setSavingKey(true);
    setKeyNote(null);
    try {
      await setGeminiKey(geminiKey);
      await testGeminiKey(geminiKey.trim());
      setHasKey(true);
      setKeyTone('ok');
      setKeyNote('Key works. Gemini answered from this device.');
    } catch (caught) {
      setHasKey(false);
      setKeyTone('bad');
      setKeyNote(
        caught instanceof GeminiError
          ? caught.message
          : 'That key did not work. Copy it again from Google AI Studio.',
      );
    } finally {
      setSavingKey(false);
    }
  }

  async function clearKey() {
    await setGeminiKey('');
    setGemini('');
    setHasKey(false);
    setKeyNote('Key removed from this device.');
    setKeyTone('ok');
  }

  async function wipe() {
    await clearCache();
    await countNotes();
    setSaved(true);
  }

  async function saveServer() {
    setTestingServer(true);
    setServerNote(null);
    try {
      await saveSettings({ baseUrl: normaliseBaseUrl(baseUrl), token: token.trim() });
      const result = await api.health();
      setServerTone(result.groq_key ? 'ok' : 'bad');
      setServerNote(
        result.groq_key
          ? `Server awake. ${result.asr} for speech, ${result.model} for notes.`
          : 'Server awake, but it has no model key of its own.',
      );
    } catch (caught) {
      setServerTone('bad');
      setServerNote(caught instanceof ApiError ? caught.message : 'Could not reach the server.');
    } finally {
      setTestingServer(false);
    }
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <BrandHeader showAdd={false} />

        <Text style={styles.heading}>Settings & Standalone Mode</Text>
        <Text style={styles.lede}>
          Your Gemini key lets notes be written on the device. Links still need the server: YouTube
          no longer serves caption tracks to apps, and a phone cannot download the audio itself.
        </Text>

        <Card
          title="GOOGLE GEMINI API (ON-DEVICE MODE)"
          glyph="✦"
          accentGlyph
          right={
            <View style={[styles.badge, hasKey ? styles.badgeOk : styles.badgeOff]}>
              <Text style={[styles.badgeText, hasKey && styles.badgeTextOk]}>
                {hasKey ? 'Key configured' : 'No key'}
              </Text>
            </View>
          }
        >
          <Text style={cardStyles.body}>
            The key is stored in this device's keystore and only ever travels to Google. When the
            phone can read a video's own captions, notes are produced here with no server involved.
          </Text>

          <Text style={styles.label}>Gemini API key</Text>
          <TextInput
            value={geminiKey}
            onChangeText={setGemini}
            placeholder="Paste the key from AI Studio"
            placeholderTextColor={color.faint}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
            style={styles.input}
          />

          <Pressable
            onPress={() => Linking.openURL('https://aistudio.google.com/app/apikey')}
            accessibilityRole="link"
          >
            <Text style={styles.link}>Get a free Gemini API key on Google AI Studio ↗</Text>
          </Pressable>

          <Pressable
            onPress={saveAndTestKey}
            disabled={savingKey}
            accessibilityRole="button"
            style={({ pressed }) => [styles.primary, pressed && styles.pressed, savingKey && styles.disabled]}
          >
            {savingKey ? (
              <ActivityIndicator size="small" color={color.accentInk} />
            ) : (
              <>
                <Ionicons name="flash" size={16} color={color.accentInk} />
                <Text style={styles.primaryLabel}>Save & Test Key</Text>
              </>
            )}
          </Pressable>

          {keyNote ? (
            <Text style={[styles.note, keyTone === 'bad' && styles.noteBad]}>{keyNote}</Text>
          ) : null}

          {hasKey ? (
            <Pressable onPress={clearKey} accessibilityRole="button" style={styles.inlineAction}>
              <Text style={styles.inlineLabel}>Remove key</Text>
            </Pressable>
          ) : null}

          <Text style={styles.modelNote}>
            Model: {GEMINI_MODEL}. Audio arrives as ten-minute pieces so timestamps stay honest.
          </Text>
        </Card>

        <Card
          title="ON-DEVICE STORAGE"
          glyph="▤"
          right={<Text style={styles.side}>{noteCount} notes saved</Text>}
        >
          <Text style={cardStyles.body}>
            Plus saved summaries and transcripts live in this phone's storage, so they open without
            a connection.
          </Text>
          <Pressable onPress={wipe} accessibilityRole="button" style={styles.ghost}>
            <Ionicons name="trash-outline" size={15} color={color.text} />
            <Text style={styles.ghostLabel}>Clear Local Library</Text>
          </Pressable>
          {saved ? <Text style={styles.note}>Local copies cleared.</Text> : null}
        </Card>

        <Card
          title="OPTIONAL SERVER (AUDIO TRANSCRIPTION)"
          glyph="◎"
          right={<Text style={styles.side}>fallback</Text>}
        >
          <Text style={cardStyles.body}>
            Some videos have no captions for the phone to read. Point this at your own server and it
            pulls the audio and runs Whisper instead.
          </Text>

          <Text style={styles.label}>Server address</Text>
          <TextInput
            value={baseUrl}
            onChangeText={setBaseUrl}
            placeholder="https://vishal-api.fly.dev"
            placeholderTextColor={color.faint}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            style={styles.input}
          />

          <Text style={styles.label}>Access token</Text>
          <TextInput
            value={token}
            onChangeText={setToken}
            placeholder="the API_TOKEN you set"
            placeholderTextColor={color.faint}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
            style={styles.input}
          />

          <Pressable
            onPress={saveServer}
            disabled={testingServer || !baseUrl.trim()}
            accessibilityRole="button"
            style={({ pressed }) => [
              styles.ghost,
              (testingServer || !baseUrl.trim()) && styles.disabled,
              pressed && styles.pressed,
            ]}
          >
            {testingServer ? (
              <ActivityIndicator size="small" color={color.text} />
            ) : (
              <Text style={styles.ghostLabel}>Save and test server</Text>
            )}
          </Pressable>

          {serverNote ? (
            <Text style={[styles.note, serverTone === 'bad' && styles.noteBad]}>{serverNote}</Text>
          ) : null}
        </Card>

        <Text style={styles.footNote}>
          Notes are extracted from the transcript only. Every quote is checked against the segment
          it claims to come from, and anything that does not match is dropped rather than reworded.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bg },
  content: { paddingHorizontal: space.lg, paddingTop: space.sm, paddingBottom: space.xxl, gap: space.md },
  heading: {
    fontFamily: fonts.sansBold,
    fontSize: 22,
    lineHeight: 29,
    color: color.text,
    marginTop: space.xl,
  },
  lede: {
    fontFamily: fonts.sans,
    fontSize: 14,
    lineHeight: 21,
    color: color.muted,
    marginTop: -space.xs,
    marginBottom: space.sm,
  },
  badge: { paddingHorizontal: 9, paddingVertical: 4, borderRadius: 6 },
  badgeOk: { backgroundColor: color.goodBg },
  badgeOff: { backgroundColor: color.raised },
  badgeText: { fontFamily: fonts.sansMedium, fontSize: 10.5, color: color.faint },
  badgeTextOk: { color: color.good },
  label: { fontFamily: fonts.sansSemi, fontSize: 12.5, color: color.text, marginTop: space.xs },
  input: {
    height: 46,
    paddingHorizontal: space.md,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: color.borderStrong,
    backgroundColor: '#0E0E10',
    fontFamily: fonts.sans,
    fontSize: 14,
    color: color.text,
  },
  link: {
    fontFamily: fonts.sansMedium,
    fontSize: 13,
    color: color.accent,
    textDecorationLine: 'underline',
  },
  primary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    height: 46,
    borderRadius: 9,
    backgroundColor: color.accent,
    marginTop: space.xs,
  },
  primaryLabel: { fontFamily: fonts.sansSemi, fontSize: 14, color: color.accentInk },
  pressed: { opacity: 0.82 },
  disabled: { opacity: 0.4 },
  note: { fontFamily: fonts.sans, fontSize: 12.5, lineHeight: 19, color: color.good },
  noteBad: { color: color.danger },
  inlineAction: { alignSelf: 'flex-start' },
  inlineLabel: { fontFamily: fonts.sansMedium, fontSize: 12.5, color: color.faint },
  modelNote: { fontFamily: fonts.sans, fontSize: 11.5, lineHeight: 17, color: color.faint },
  side: { fontFamily: fonts.sans, fontSize: 12, color: color.faint },
  ghost: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    height: 42,
    paddingHorizontal: space.md,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: color.borderStrong,
    alignSelf: 'flex-start',
    minWidth: 150,
  },
  ghostLabel: { fontFamily: fonts.sansMedium, fontSize: 13, color: color.text },
  footNote: {
    fontFamily: fonts.sans,
    fontSize: 12,
    lineHeight: 18,
    color: color.faint,
    marginTop: space.sm,
    paddingHorizontal: space.xs,
  },
});
