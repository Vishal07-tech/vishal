import { StyleSheet, Text, View } from 'react-native';
import { color, space, type as fonts } from '../lib/theme';
import type { Moment } from '../lib/api';
import { Timecode } from './timecode';

export function MomentRow({ moment, videoId }: { moment: Moment; videoId: string }) {
  return (
    <View style={styles.row}>
      <View style={styles.marker} />
      <View style={styles.body}>
        <View style={styles.head}>
          <Text style={styles.title}>{moment.title}</Text>
        </View>
        {moment.note ? <Text style={styles.note}>{moment.note}</Text> : null}
        <Text style={styles.quote}>“{moment.quote}”</Text>
        <Timecode videoId={videoId} startMs={moment.start_ms} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: space.md, paddingVertical: space.md },
  marker: {
    width: 2.5,
    borderRadius: 2,
    backgroundColor: color.accent,
    marginTop: 3,
    alignSelf: 'stretch',
  },
  body: { flex: 1, gap: 6 },
  head: { flexDirection: 'row', alignItems: 'center' },
  title: { fontFamily: fonts.sansSemi, fontSize: 15.5, lineHeight: 21, color: color.text, flex: 1 },
  note: { fontFamily: fonts.sans, fontSize: 13.5, lineHeight: 20, color: color.muted },
  quote: {
    fontFamily: fonts.serif,
    fontSize: 14.5,
    lineHeight: 22,
    color: color.text,
    opacity: 0.78,
  },
});
