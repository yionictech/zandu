import { Tabs } from 'expo-router';
import { Bike, History, UserRound, type LucideIcon } from 'lucide-react-native';
import { t } from '../../../src/i18n/fr';
import { colors, fonts } from '../../../src/theme';
import { RequireRole } from '../../../src/ui/RequireRole';

const icon = (Glyph: LucideIcon) =>
  function TabIcon({ focused }: { focused: boolean }) {
    return <Glyph color={focused ? colors.brand : colors.muted} size={22} strokeWidth={1.8} />;
  };

/**
 * Espace livreur : Courses, Historique, Profil (maquette « Livreur »). Pas d'onglet « Gains » :
 * le livreur partenaire est payé par sa société, pas par Zandu (D15, docs/ux/03 §4.1).
 */
export default function RiderTabsLayout() {
  return (
    <RequireRole role="rider">
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: colors.brand,
          tabBarInactiveTintColor: colors.muted,
          tabBarLabelStyle: { fontSize: 11, fontFamily: fonts.medium },
          tabBarStyle: {
            minHeight: 62,
            backgroundColor: colors.bar,
            borderTopColor: colors.border,
          },
          sceneStyle: { backgroundColor: colors.background },
        }}
      >
        <Tabs.Screen
          name="index"
          options={{ title: t.rider.tabs.courses, tabBarIcon: icon(Bike) }}
        />
        <Tabs.Screen
          name="historique"
          options={{ title: t.rider.tabs.history, tabBarIcon: icon(History) }}
        />
        <Tabs.Screen
          name="profil"
          options={{ title: t.rider.tabs.profile, tabBarIcon: icon(UserRound) }}
        />
      </Tabs>
    </RequireRole>
  );
}
