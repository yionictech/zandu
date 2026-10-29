import { useRouter } from 'expo-router';
import { Bike, ShoppingBag, Store } from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { queryClient } from '../api';
import { DEMO } from '../config';
import { DEMO_ROLES, demoSignIn, resetDemo, type DemoRole } from '../demo';
import { t } from '../i18n/fr';
import { useSession } from '../session';
import { colors, font, radius, space } from '../theme';
import { Card } from './kit';
import { Text } from './Text';

const ROLES: Array<{ role: DemoRole; icon: typeof Store; home: '/' | '/vendeur' | '/livreur' }> = [
  { role: 'buyer', icon: ShoppingBag, home: '/' },
  { role: 'seller', icon: Store, home: '/vendeur' },
  { role: 'rider', icon: Bike, home: '/livreur' },
];

/**
 * Démonstration locale : entrer d'un toucher avec l'acheteuse, la vendeuse ou le livreur
 * fictifs, pour suivre une commande de bout en bout ; remettre les données à zéro.
 */
export function DemoPanel() {
  const router = useRouter();
  const { user, signIn, signOut } = useSession();
  const [notice, setNotice] = useState<string | null>(null);
  if (!DEMO) return null;
  const current = ROLES.find((r) => DEMO_ROLES[r.role].phone === user?.phone);

  const enter = async (role: DemoRole, home: string) => {
    const session = demoSignIn(role);
    queryClient.clear();
    await signIn(session.token, session.user);
    router.replace(home as never);
  };

  return (
    <Card testID="demo-panel">
      <Text style={styles.title}>{t.demo.title}</Text>
      <Text style={styles.muted}>{t.demo.intro}</Text>
      {current ? (
        <Text style={styles.current}>{t.demo.current(DEMO_ROLES[current.role].label)}</Text>
      ) : null}
      <View style={styles.roles}>
        {ROLES.map(({ role, icon: Icon, home }) => (
          <Pressable
            key={role}
            onPress={() => void enter(role, home)}
            accessibilityRole="button"
            style={({ pressed }) => [styles.role, pressed && styles.pressed]}
            testID={`demo-${role}`}
          >
            <Icon color={colors.brand} size={22} strokeWidth={1.8} />
            <View style={styles.flex}>
              <Text style={styles.roleTitle}>{t.demo.enterAs(DEMO_ROLES[role].label)}</Text>
              <Text style={styles.muted}>{DEMO_ROLES[role].detail}</Text>
            </View>
          </Pressable>
        ))}
      </View>
      <Text style={styles.muted}>{t.demo.hint}</Text>
      <Pressable
        onPress={() =>
          void (async () => {
            await signOut();
            await resetDemo();
            queryClient.clear();
            setNotice(t.demo.resetDone);
          })()
        }
        accessibilityRole="button"
        testID="demo-reset"
      >
        <Text style={styles.reset}>{t.demo.reset}</Text>
      </Pressable>
      {notice ? <Text style={styles.muted}>{notice}</Text> : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  title: { color: colors.text, fontWeight: '800', fontSize: font.body },
  muted: { color: colors.muted, fontSize: font.small, lineHeight: 19 },
  current: { color: colors.brand, fontWeight: '700', fontSize: font.small },
  roles: { gap: space.sm },
  role: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceRaised,
  },
  pressed: { opacity: 0.8 },
  roleTitle: { color: colors.text, fontWeight: '700', fontSize: font.body },
  reset: { color: colors.danger, fontWeight: '700', fontSize: font.small, textAlign: 'center' },
});
