import { Tabs } from 'expo-router';
import { House, LayoutGrid, Package, Wallet, type LucideIcon } from 'lucide-react-native';
import { t } from '../../../src/i18n/fr';
import { useSellerOrders } from '../../../src/seller/queries';
import { colors, fonts } from '../../../src/theme';
import { useUnreadMessages } from '../../../src/ui/MessagesButton';
import { RequireRole } from '../../../src/ui/RequireRole';

const icon = (Glyph: LucideIcon) =>
  function TabIcon({ focused }: { focused: boolean }) {
    return <Glyph color={focused ? colors.brand : colors.muted} size={22} strokeWidth={1.8} />;
  };

function SellerTabs() {
  // Pastille « Commandes » : commandes payées qui attendent d'être acceptées.
  const toAccept = useSellerOrders('new');
  // … et messages non lus des clients et des livreurs.
  const count = (toAccept.data?.length ?? 0) + useUnreadMessages();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.brand,
        tabBarInactiveTintColor: colors.muted,
        tabBarLabelStyle: { fontSize: 11, fontFamily: fonts.medium },
        tabBarStyle: { minHeight: 62, backgroundColor: colors.bar, borderTopColor: colors.border },
        tabBarBadgeStyle: { backgroundColor: colors.danger, color: colors.onBrand },
        sceneStyle: { backgroundColor: colors.background },
      }}
    >
      <Tabs.Screen name="index" options={{ title: t.vendor.tabs.home, tabBarIcon: icon(House) }} />
      <Tabs.Screen
        name="commandes"
        options={{
          title: t.vendor.tabs.orders,
          tabBarIcon: icon(Package),
          tabBarBadge: count > 0 ? count : undefined,
        }}
      />
      <Tabs.Screen
        name="produits"
        options={{ title: t.vendor.tabs.products, tabBarIcon: icon(LayoutGrid) }}
      />
      <Tabs.Screen
        name="argent"
        options={{ title: t.vendor.tabs.money, tabBarIcon: icon(Wallet) }}
      />
    </Tabs>
  );
}

/** Espace vendeur : Accueil, Commandes, Produits, Argent (maquettes vendeur). */
export default function SellerTabsLayout() {
  return (
    <RequireRole role="seller">
      <SellerTabs />
    </RequireRole>
  );
}
