import { StyleSheet, Text, View } from 'react-native';
import { color, hairline, space, type as fonts } from '../lib/theme';

export function Formula({ latex }: { latex: string }) {
  return (
    <View style={styles.frame}>
      <Text style={styles.text}>{latex}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    marginTop: space.xs,
    paddingVertical: space.md,
    paddingHorizontal: space.md,
    borderRadius: 10,
    borderWidth: hairline,
    borderColor: color.borderStrong,
    backgroundColor: '#0E0E10',
    minHeight: 54,
    justifyContent: 'center',
  },
  text: { fontFamily: fonts.serif, fontSize: 16, lineHeight: 23, color: color.text },
});
