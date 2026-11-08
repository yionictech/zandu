import { useRouter, type Href } from 'expo-router';
import { ChevronRight, Gift, Package, UtensilsCrossed, type LucideIcon } from 'lucide-react-native';
import { Pressable, StyleSheet, View } from 'react-native';
import { t } from '../i18n/fr';
import { colors, font, radius, space } from '../theme';
import { Text } from './Text';

interface Service {
  key: string;
  label: string;
  icon: LucideIcon;
  href: Href;
}

/** Services de la super-application, sous la recherche de l'accueil. */
const SERVICES: Service[] = [
  { key: 'food', label: t.services.food, icon: UtensilsCrossed, href: '/repas' },
  { key: 'parcel', label: t.services.parcel, icon: Package, href: '/envoi/nouveau' },
  { key: 'loyalty', label: t.services.loyalty, icon: Gift, href: '/fidelite' },
];

export function ServicesRow() {
  const router = useRouter();
  return (
    <View style={styles.row} accessibilityRole="menu">
      {SERVICES.map(({ key, label, icon: Icon, href }) => (
        <Pressable
          key={key}
          onPress={() => router.push(href)}
          style={styles.tile}
          accessibilityRole="button"
          accessibilityLabel={label}
          testID={`service-${key}`}
        >
          <View style={styles.icon}>
            <Icon color={colors.onBrand} size={20} strokeWidth={2} />
          </View>
          <Text style={styles.label} numberOfLines={1}>
            {label}
          </Text>
          <ChevronRight color={colors.muted} size={18} />
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  tile: {
    flexGrow: 1,
    flexBasis: '45%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: 56,
    paddingHorizontal: space.md,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  icon: {
    width: 34,
    height: 34,
    borderRadius: radius.md,
    backgroundColor: colors.brand,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: { flex: 1, color: colors.text, fontWeight: '700', fontSize: font.small },
});
