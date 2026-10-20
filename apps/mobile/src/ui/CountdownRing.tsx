import { StyleSheet, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { countdown } from '../format';
import { colors } from '../theme';
import { Text } from './Text';

/**
 * Anneau de compte à rebours (maquettes « Paiement en cours », « Prête dans 18 min ») : le temps
 * restant en grand, ou un libellé court (« 18' ») dans un petit anneau.
 */
export function CountdownRing({
  msLeft,
  totalMs,
  caption,
  size = 180,
  color = colors.danger,
  label,
}: {
  msLeft: number;
  totalMs: number;
  caption?: string;
  size?: number;
  color?: string;
  /** Remplace « 09:58 ». */
  label?: string;
}) {
  const stroke = size < 100 ? 5 : 10;
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  const fraction = Math.max(0, Math.min(1, msLeft / totalMs));
  return (
    <View style={{ width: size, height: size }} accessibilityLabel="Temps restant">
      <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={colors.surfaceRaised}
          strokeWidth={stroke}
          fill="none"
        />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={color}
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${circumference} ${circumference}`}
          strokeDashoffset={circumference * (1 - fraction)}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </Svg>
      <View style={styles.center}>
        <Text style={[styles.time, { color, fontSize: size < 100 ? size * 0.26 : 38 }]}>
          {label ?? countdown(msLeft)}
        </Text>
        {caption ? <Text style={styles.caption}>{caption}</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
  time: { fontWeight: '800' },
  caption: { fontSize: 13, color: colors.muted },
});
