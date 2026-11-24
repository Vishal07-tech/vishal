import { Linking, Pressable, StyleSheet, Text } from 'react-native';
import { color, hitSlop, type as fonts } from '../lib/theme';
import { timecode, youtubeUrl } from '../lib/format';

type Props = {
  videoId: string;
  startMs: number;
  tone?: 'accent' | 'muted';
};

export function Timecode({ videoId, startMs, tone = 'accent' }: Props) {
  return (
    <Pressable
      hitSlop={hitSlop}
      accessibilityRole="link"
      accessibilityLabel={`Open the video at ${timecode(startMs)}`}
      onPress={() => Linking.openURL(youtubeUrl(videoId, startMs))}
      style={({ pressed }) => [styles.press, pressed && styles.pressed]}
    >
      <Text style={[styles.label, tone === 'muted' && styles.muted]}>{timecode(startMs)}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  press: { paddingVertical: 1 },
  pressed: { opacity: 0.5 },
  label: {
    fontFamily: fonts.sansSemi,
    fontSize: 12.5,
    letterSpacing: 0.2,
    color: color.accent,
    fontVariant: ['tabular-nums'],
  },
  muted: { color: color.faint, fontFamily: fonts.sansMedium },
});
