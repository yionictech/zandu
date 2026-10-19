import { ShieldCheck } from 'lucide-react-native';
import { StyleSheet, View } from 'react-native';
import { t } from '../i18n/fr';
import { colors, font, radius, space } from '../theme';
import { Text } from './Text';

/** Bandeau de confiance : le séquestre, raconté partout (principe UX n°1). */
export function TrustBanner() {
  return (
    <View style={styles.banner} accessibilityRole="text">
      <ShieldCheck color={colors.trust} size={15} strokeWidth={2} />
      <Text style={styles.bannerText}>{t.trust.banner}</Text>
    </View>
  );
}

/** « Garantie Zandu » : encart citron des fiches produit et du paiement (maquettes). */
export function GuaranteeCard() {
  return (
    <View style={styles.card}>
      <ShieldCheck color={colors.trust} size={22} strokeWidth={1.8} />
      <View style={styles.cardBody}>
        <Text style={styles.title}>{t.trust.guaranteeTitle}</Text>
        <Text style={styles.body}>{t.trust.guaranteeBody}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 2 },
  bannerText: { color: colors.muted, fontWeight: '500', fontSize: font.small, flex: 1 },
  card: {
    flexDirection: 'row',
    gap: space.md,
    backgroundColor: colors.trustSoft,
    borderRadius: radius.lg,
    padding: space.md,
    borderWidth: 1,
    borderColor: colors.brandBorder,
  },
  cardBody: { flex: 1, gap: 4 },
  title: { color: colors.text, fontWeight: '700', fontSize: font.body },
  body: { color: colors.muted, fontSize: font.small, lineHeight: 19 },
});
