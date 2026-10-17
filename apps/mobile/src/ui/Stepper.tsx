import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { colors, font, radius, touchTarget } from '../theme';

/** Quantité « − 5 + » : gros boutons, saisie directe possible pour les grands stocks. */
export function Stepper({
  label,
  value,
  onChange,
  min = 0,
  max = 100_000,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
}) {
  const set = (next: number) => onChange(Math.min(max, Math.max(min, next)));
  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.row}>
        <Pressable
          style={styles.button}
          onPress={() => set(value - 1)}
          accessibilityLabel={`${label} : moins un`}
          disabled={value <= min}
        >
          <Text style={styles.sign}>−</Text>
        </Pressable>
        <TextInput
          style={styles.input}
          value={String(value)}
          onChangeText={(text) => set(Number(text.replace(/\D/g, '') || 0))}
          keyboardType="number-pad"
          accessibilityLabel={label}
          selectTextOnFocus
        />
        <Pressable
          style={styles.button}
          onPress={() => set(value + 1)}
          accessibilityLabel={`${label} : plus un`}
        >
          <Text style={styles.sign}>+</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 6 },
  label: { fontSize: font.small, fontWeight: '600', color: colors.text },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  button: {
    width: touchTarget,
    height: touchTarget,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.brand,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  sign: { fontSize: 24, color: colors.brand, fontWeight: '700' },
  input: {
    width: 88,
    height: touchTarget,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    textAlign: 'center',
    fontSize: font.title,
    fontWeight: '700',
    color: colors.text,
    backgroundColor: colors.surface,
  },
});
