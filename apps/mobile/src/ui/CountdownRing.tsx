import { StyleSheet, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { countdown } from '../format';
import { colors } from '../theme';
import { Text } from './Text';

/** Anneau de compte à rebours (maquette « Paiement en cours ») : le temps restant en grand. */
export function CountdownRing({
  msLeft,
  totalMs,
  caption,
  size = 180,
}: {
  msLeft: number;
  totalMs: number;
  caption: string;
  size?: number;
}) {
  const stroke = 10;
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
          stroke={colors.danger}
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${circumference} ${circumference}`}
          strokeDashoffset={circumference * (1 - fraction)}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </Svg>
      <View style={styles.center}>
        <Text style={styles.time}>{countdown(msLeft)}</Text>
        <Text style={styles.caption}>{caption}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
  time: { fontSize: 38, fontWeight: '800', color: colors.danger },
  caption: { fontSize: 13, color: colors.muted },
});
