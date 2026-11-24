import { Pressable, StyleSheet, Text, View } from 'react-native';
import { color, space, type as fonts } from '../lib/theme';

export function Empty({
  title,
  body,
  actionLabel,
  onAction,
}: {
  title: string;
  body: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.body}>{body}</Text>
      {actionLabel && onAction ? (
        <Pressable
          onPress={onAction}
          accessibilityRole="button"
          style={({ pressed }) => [styles.action, pressed && styles.pressed]}
        >
          <Text style={styles.actionLabel}>{actionLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    paddingVertical: space.xxl,
    paddingHorizontal: space.lg,
    gap: space.sm,
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: 16,
    backgroundColor: color.surface,
  },
  title: { fontFamily: fonts.sansSemi, fontSize: 17, color: color.text },
  body: { fontFamily: fonts.sans, fontSize: 14, lineHeight: 21, color: color.muted },
  action: {
    alignSelf: 'flex-start',
    marginTop: space.sm,
    paddingVertical: 9,
    paddingHorizontal: 16,
    borderRadius: 9,
    backgroundColor: color.accent,
  },
  pressed: { opacity: 0.8 },
  actionLabel: { fontFamily: fonts.sansSemi, fontSize: 13, color: color.accentInk },
});
