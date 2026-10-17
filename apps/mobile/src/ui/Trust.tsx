import { StyleSheet, Text, View } from 'react-native';
import { t } from '../i18n/fr';
import { colors, font, radius, space } from '../theme';

/** Bandeau de confiance : le séquestre, raconté partout (principe UX n°1). */
export function TrustBanner() {
  return (
    <View style={styles.banner} accessibilityRole="text">
      <Text style={styles.bannerText}>🛡 {t.trust.banner}</Text>
    </View>
  );
}

export function GuaranteeCard() {
  return (
    <View style={styles.card}>
      <Text style={styles.title}>🛡 {t.trust.guaranteeTitle}</Text>
      <Text style={styles.body}>{t.trust.guaranteeBody}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    backgroundColor: colors.trustSoft,
    paddingVertical: space.sm,
    paddingHorizontal: space.md,
    borderRadius: radius.md,
  },
  bannerText: { color: colors.trust, fontWeight: '700', fontSize: font.small, textAlign: 'center' },
  card: {
    backgroundColor: colors.trustSoft,
    borderRadius: radius.md,
    padding: space.md,
    borderLeftWidth: 4,
    borderLeftColor: colors.trust,
    gap: 4,
  },
  title: { color: colors.trust, fontWeight: '800', fontSize: font.body },
  body: { color: colors.text, fontSize: font.small, lineHeight: 19 },
});
