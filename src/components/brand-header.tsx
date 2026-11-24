import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { color, radius, space, type as fonts } from '../lib/theme';

export function BrandHeader({ showAdd = true }: { showAdd?: boolean }) {
  const router = useRouter();
  return (
    <View style={styles.row}>
      <View style={styles.badge}>
        <Text style={styles.badgeLetter}>R</Text>
      </View>
      <View style={styles.names}>
        <Text style={styles.nameTop}>YouTube</Text>
        <Text style={styles.nameBottom}>Recall</Text>
      </View>
      <View style={styles.spacer} />
      <View style={styles.chip}>
        <Text style={styles.chipText}>EDITORIAL</Text>
      </View>
      {showAdd ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push('/add')}
          style={({ pressed }) => [styles.add, pressed && styles.pressed]}
        >
          <Ionicons name="add" size={20} color={color.accentInk} />
          <Text style={styles.addText}>Add Video</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  badge: {
    width: 42,
    height: 42,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: color.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeLetter: {
    fontFamily: fonts.serifSemi,
    fontSize: 22,
    color: color.accent,
    marginTop: -2,
  },
  names: { justifyContent: 'center' },
  nameTop: {
    fontFamily: fonts.sansSemi,
    fontSize: 15,
    lineHeight: 18,
    color: color.text,
  },
  nameBottom: {
    fontFamily: fonts.sansSemi,
    fontSize: 15,
    lineHeight: 18,
    color: color.text,
  },
  spacer: { flex: 1 },
  chip: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: radius.chip,
    backgroundColor: color.raised,
    borderWidth: 1,
    borderColor: color.border,
  },
  chipText: {
    fontFamily: fonts.sansSemi,
    fontSize: 9,
    letterSpacing: 0.9,
    color: color.muted,
  },
  add: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 10,
    paddingLeft: 10,
    paddingRight: 14,
    borderRadius: 10,
    backgroundColor: color.accent,
  },
  pressed: { opacity: 0.8 },
  addText: {
    fontFamily: fonts.sansSemi,
    fontSize: 14,
    color: color.accentInk,
  },
});
