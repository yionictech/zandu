import { Pressable, StyleSheet, Text, View } from 'react-native';
import { t } from '../i18n/fr';
import { colors, radius, space } from '../theme';

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'erase', '0', 'none'] as const;

/**
 * Pavé numérique géant pour le code de remise : utilisable debout, au soleil, d'une main,
 * sans faire apparaître le clavier du téléphone.
 */
export function CodePad({
  value,
  onChange,
  length = 6,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  length?: number;
  disabled?: boolean;
}) {
  const press = (key: (typeof KEYS)[number]) => {
    if (key === 'erase') onChange(value.slice(0, -1));
    else if (key !== 'none' && value.length < length) onChange(value + key);
  };
  return (
    <View style={styles.wrap}>
      <View style={styles.boxes} accessibilityLabel={`Code saisi : ${value.split('').join(' ')}`}>
        {Array.from({ length }, (_, i) => (
          <View key={i} style={[styles.box, i === value.length && styles.boxActive]}>
            <Text style={styles.digit}>{value[i] ?? ''}</Text>
          </View>
        ))}
      </View>
      <View style={styles.grid}>
        {KEYS.map((key) =>
          key === 'none' ? (
            <View key={key} style={styles.key} />
          ) : (
            <Pressable
              key={key}
              disabled={disabled}
              onPress={() => press(key)}
              accessibilityRole="button"
              accessibilityLabel={key === 'erase' ? t.rider.erase : key}
              testID={`pad-${key}`}
              style={({ pressed }) => [styles.key, styles.keyButton, pressed && styles.pressed]}
            >
              <Text style={key === 'erase' ? styles.erase : styles.keyText}>
                {key === 'erase' ? '⌫' : key}
              </Text>
            </Pressable>
          ),
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.md },
  boxes: { flexDirection: 'row', justifyContent: 'center', gap: 6 },
  box: {
    width: 44,
    height: 56,
    borderRadius: radius.md,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  boxActive: { borderColor: colors.brand },
  digit: { fontSize: 28, fontWeight: '800', color: colors.text },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 10 },
  key: { width: '31.5%', height: 64 },
  keyButton: {
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { backgroundColor: colors.brandSoft },
  keyText: { fontSize: 30, fontWeight: '700', color: colors.text },
  erase: { fontSize: 26, color: colors.muted },
});
