import { Tabs } from 'expo-router';
import { Text } from 'react-native';
import { useCart } from '../../src/cart';
import { t } from '../../src/i18n/fr';
import { colors } from '../../src/theme';

const icon = (glyph: string) =>
  function TabIcon({ focused }: { focused: boolean }) {
    return <Text style={{ fontSize: 20, opacity: focused ? 1 : 0.55 }}>{glyph}</Text>;
  };

export default function TabsLayout() {
  const { count } = useCart();
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.brand,
        tabBarInactiveTintColor: colors.muted,
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
        tabBarStyle: { minHeight: 58 },
        headerTitleStyle: { fontWeight: '800' },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{ title: t.tabs.home, headerTitle: 'Zandu', tabBarIcon: icon('🏠') }}
      />
      <Tabs.Screen name="recherche" options={{ title: t.tabs.search, tabBarIcon: icon('🔍') }} />
      <Tabs.Screen
        name="panier"
        options={{
          title: t.tabs.cart,
          tabBarIcon: icon('🛒'),
          tabBarBadge: count > 0 ? count : undefined,
        }}
      />
      <Tabs.Screen name="commandes" options={{ title: t.tabs.orders, tabBarIcon: icon('📦') }} />
      <Tabs.Screen name="compte" options={{ title: t.tabs.account, tabBarIcon: icon('👤') }} />
    </Tabs>
  );
}
