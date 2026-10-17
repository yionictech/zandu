import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, font, radius, space } from '../theme';

type Tone = 'trust' | 'waiting' | 'danger' | 'brand';

const TONES: Record<Tone, { background: string; accent: string }> = {
  trust: { background: colors.trustSoft, accent: colors.trust },
  waiting: { background: colors.waitingSoft, accent: colors.waiting },
  danger: { background: colors.dangerSoft, accent: colors.danger },
  brand: { background: colors.brandSoft, accent: colors.brand },
};

/** Bandeau d'information ; touchable quand il mène quelque part (« Vérifiez votre identité › »). */
export function Banner({
  message,
  tone = 'waiting',
  onPress,
  testID,
}: {
  message: string;
  tone?: Tone;
  onPress?: () => void;
  testID?: string;
}) {
  const { background, accent } = TONES[tone];
  const body = (
    <View style={[styles.banner, { backgroundColor: background, borderLeftColor: accent }]}>
      <Text style={[styles.text, { color: accent }]}>{message}</Text>
      {onPress ? <Text style={[styles.chevron, { color: accent }]}>›</Text> : null}
    </View>
  );
  if (!onPress) return body;
  return (
    <Pressable onPress={onPress} accessibilityRole="button" testID={testID}>
      {body}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    borderRadius: radius.md,
    borderLeftWidth: 4,
    padding: space.md,
  },
  text: { flex: 1, fontSize: font.small, fontWeight: '700', lineHeight: 19 },
  chevron: { fontSize: 24, fontWeight: '700' },
});
