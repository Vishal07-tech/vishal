import { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { color, radius, space, type as fonts } from '../lib/theme';

export function Card({
  title,
  glyph,
  accentGlyph,
  right,
  children,
  style,
}: {
  title?: string;
  glyph?: string;
  accentGlyph?: boolean;
  right?: ReactNode;
  children: ReactNode;
  style?: object;
}) {
  return (
    <View style={[styles.card, style]}>
      {title ? (
        <View style={styles.head}>
          {glyph ? (
            <Text style={[styles.glyph, accentGlyph && styles.glyphAccent]}>{glyph}</Text>
          ) : null}
          <Text style={styles.title}>{title}</Text>
          <View style={styles.grow} />
          {right}
        </View>
      ) : null}
      {children}
    </View>
  );
}

export const cardStyles = StyleSheet.create({
  body: {
    fontFamily: fonts.sans,
    fontSize: 14,
    lineHeight: 22,
    color: color.muted,
  },
});

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderColor: color.border,
    backgroundColor: color.surface,
    borderRadius: radius.card,
    padding: space.lg,
    gap: space.md,
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  glyph: { fontFamily: fonts.sans, fontSize: 15, color: color.muted },
  glyphAccent: { color: color.accent },
  title: {
    flexShrink: 1,
    fontFamily: fonts.sansSemi,
    fontSize: 12.5,
    letterSpacing: 1.2,
    lineHeight: 18,
    color: color.text,
  },
  grow: { flex: 1 },
});
