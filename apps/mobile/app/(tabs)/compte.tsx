import { useRouter } from 'expo-router';
import { StyleSheet, Text } from 'react-native';
import { displayPhone } from '../../src/format';
import { t } from '../../src/i18n/fr';
import { useSession } from '../../src/session';
import { colors, font } from '../../src/theme';
import { Button } from '../../src/ui/Button';
import { Empty, Loading, Screen, Section } from '../../src/ui/Layout';

export default function AccountScreen() {
  const router = useRouter();
  const { ready, user, signOut } = useSession();
  if (!ready) return <Loading />;
  if (!user) {
    return (
      <Empty
        message={t.account.guest}
        action={t.orders.login}
        onAction={() => router.push('/connexion')}
      />
    );
  }
  return (
    <Screen>
      <Section title={t.account.title}>
        <Text style={styles.label}>{t.account.phone}</Text>
        <Text style={styles.value}>{displayPhone(user.phone)}</Text>
      </Section>
      <Section title={t.account.sell}>
        <Text style={styles.label}>{t.account.sellSoon}</Text>
      </Section>
      <Button label={t.account.logout} variant="secondary" onPress={() => void signOut()} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  label: { color: colors.muted, fontSize: font.small, lineHeight: 20 },
  value: { color: colors.text, fontSize: font.title, fontWeight: '700' },
});
