import { ActivityIndicator, Pressable, StyleSheet, type ViewStyle } from 'react-native';
import { Text } from './Text';
import { colors, font, radius, touchTarget } from '../theme';

type Variant = 'primary' | 'secondary' | 'trust' | 'ghost';

interface Props {
  label: string;
  onPress: () => void;
  variant?: Variant;
  disabled?: boolean;
  loading?: boolean;
  style?: ViewStyle;
  testID?: string;
}

/** Bouton pleine largeur, cible tactile ≥ 48 dp ; un seul bouton principal par écran. */
export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled,
  loading,
  style,
  testID,
}: Props) {
  const inactive = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!inactive, busy: !!loading }}
      testID={testID}
      onPress={onPress}
      disabled={inactive}
      style={({ pressed }) => [
        styles.base,
        styles[variant],
        pressed && variant === 'primary' && { backgroundColor: colors.brandPressed },
        inactive && styles.disabled,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator
          color={variant === 'primary' || variant === 'trust' ? colors.onBrand : colors.brand}
        />
      ) : (
        <Text
          style={[
            styles.label,
            variant === 'secondary' && styles.labelAlt,
            variant === 'ghost' && styles.labelGhost,
          ]}
        >
          {label}
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: Math.max(touchTarget, 54),
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  primary: { backgroundColor: colors.brand },
  trust: { backgroundColor: colors.trust },
  secondary: { backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.border },
  ghost: { backgroundColor: 'transparent' },
  disabled: { opacity: 0.4 },
  label: { color: colors.onBrand, fontSize: font.body, fontWeight: '700', textAlign: 'center' },
  labelAlt: { color: colors.text },
  labelGhost: { color: colors.brand },
});
