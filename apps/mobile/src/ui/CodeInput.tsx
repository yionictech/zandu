import { StyleSheet, View } from 'react-native';
import { colors, radius } from '../theme';
import { Text, TextInput } from './Text';

/**
 * Code en cases séparées (maquettes : connexion, remise, retrait). Un vrai champ, invisible,
 * est posé par-dessus les cases : le clavier numérique et le remplissage automatique du SMS
 * fonctionnent comme d'habitude.
 */
export function CodeInput({
  value,
  onChange,
  length = 6,
  label,
  testID,
}: {
  value: string;
  onChange: (code: string) => void;
  length?: number;
  label: string;
  testID?: string;
}) {
  const digits = value.split('');
  return (
    <View style={styles.wrap}>
      <View style={styles.boxes} pointerEvents="none">
        {Array.from({ length }, (_, i) => (
          <View
            key={i}
            style={[
              styles.box,
              digits[i] !== undefined && styles.boxFilled,
              i === digits.length && styles.boxActive,
            ]}
          >
            <Text style={styles.digit}>{digits[i] ?? ''}</Text>
          </View>
        ))}
      </View>
      <TextInput
        value={value}
        onChangeText={(v) => onChange(v.replace(/\D/g, '').slice(0, length))}
        keyboardType="number-pad"
        autoComplete="sms-otp"
        textContentType="oneTimeCode"
        maxLength={length}
        autoFocus
        caretHidden
        style={styles.hidden}
        accessibilityLabel={label}
        testID={testID}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { justifyContent: 'center' },
  boxes: { flexDirection: 'row', gap: 8, justifyContent: 'space-between' },
  box: {
    flex: 1,
    maxWidth: 56,
    height: 64,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  boxFilled: { borderColor: colors.brandBorder },
  boxActive: { borderColor: colors.brand },
  digit: { fontSize: 26, fontWeight: '800', color: colors.brand },
  hidden: { ...StyleSheet.absoluteFill, opacity: 0.01, color: 'transparent' },
});
