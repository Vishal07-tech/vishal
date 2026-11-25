import { StyleSheet, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { color, hairline, space } from '../lib/theme';

export function Formula({ latex }: { latex: string }) {
  const html = `<!doctype html><html><head>
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css">
<script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.js"></script>
<style>
  html,body{margin:0;height:100%;background:transparent;}
  body{display:flex;align-items:center;justify-content:center;
       font-size:19px;color:${color.text};font-family:Georgia,serif;}
  .katex{font-size:1.1em;}
</style></head><body>
<span id="f"></span>
<script>
  var raw = ${JSON.stringify(latex)};
  function draw(){
    try { katex.render(raw, document.getElementById('f'), {throwOnError:false, displayMode:false}); }
    catch(e) { document.getElementById('f').textContent = raw; }
  }
  window.addEventListener('load', draw);
  setTimeout(draw, 500);
</script></body></html>`;

  return (
    <View style={styles.frame}>
      <WebView
        originWhitelist={['*']}
        source={{ html }}
        scrollEnabled={false}
        javaScriptEnabled
        style={styles.web}
        androidLayerType="software"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    marginTop: space.xs,
    paddingVertical: space.sm,
    paddingHorizontal: space.md,
    borderRadius: 10,
    borderWidth: hairline,
    borderColor: color.borderStrong,
    backgroundColor: '#0E0E10',
    minHeight: 54,
    justifyContent: 'center',
    overflow: 'hidden',
  },
  web: { flex: 1, minHeight: 46, backgroundColor: 'transparent' },
});
