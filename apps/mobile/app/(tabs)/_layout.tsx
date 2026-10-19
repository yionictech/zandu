import { Tabs } from 'expo-router';
import {
  House,
  Package,
  Search,
  ShoppingCart,
  UserRound,
  type LucideIcon,
} from 'lucide-react-native';
import { useCart } from '../../src/cart';
import { t } from '../../src/i18n/fr';
import { colors, fonts } from '../../src/theme';
import { darkHeader } from '../../src/ui/navigation';

const icon = (Glyph: LucideIcon) =>
  function TabIcon({ focused }: { focused: boolean }) {
    return <Glyph color={focused ? colors.brand : colors.muted} size={22} strokeWidth={1.8} />;
  };

/** Barre d'onglets sombre, onglet actif en citron (maquettes acheteur). */
export default function TabsLayout() {
  const { count } = useCart();
  return (
    <Tabs
      screenOptions={{
        ...darkHeader,
        headerTitleStyle: { ...darkHeader.headerTitleStyle, fontSize: 22 },
        tabBarActiveTintColor: colors.brand,
        tabBarInactiveTintColor: colors.muted,
        tabBarLabelStyle: { fontSize: 11, fontFamily: fonts.medium },
        tabBarStyle: {
          minHeight: 62,
          backgroundColor: colors.bar,
          borderTopColor: colors.border,
        },
        tabBarBadgeStyle: { backgroundColor: colors.danger, color: colors.onBrand },
        sceneStyle: { backgroundColor: colors.background },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{ title: t.tabs.home, headerTitle: 'zandu.', tabBarIcon: icon(House) }}
      />
      <Tabs.Screen name="recherche" options={{ title: t.tabs.search, tabBarIcon: icon(Search) }} />
      <Tabs.Screen
        name="panier"
        options={{
          title: t.tabs.cart,
          tabBarIcon: icon(ShoppingCart),
          tabBarBadge: count > 0 ? count : undefined,
        }}
      />
      <Tabs.Screen name="commandes" options={{ title: t.tabs.orders, tabBarIcon: icon(Package) }} />
      <Tabs.Screen name="compte" options={{ title: t.tabs.account, tabBarIcon: icon(UserRound) }} />
    </Tabs>
  );
}
