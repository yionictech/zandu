import { useRouter } from 'expo-router';
import { Building2, LifeBuoy, MapPin, Phone } from 'lucide-react-native';
import { Linking, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { errorMessage } from '../../../src/api';
import { displayPhone } from '../../../src/format';
import { t } from '../../../src/i18n/fr';
import { useRiderMe } from '../../../src/rider/ui';
import { SettingRow, TabHeader } from '../../../src/seller/ui';
import { useSession } from '../../../src/session';
import { colors, font, space } from '../../../src/theme';
import { Avatar, Badge, Card } from '../../../src/ui/kit';
import { Failure, Loading } from '../../../src/ui/Layout';
import { Text } from '../../../src/ui/Text';

/** Profil du livreur (maquette) : identité, zone, société partenaire, aide, déconnexion. */
export default function RiderProfile() {
  const router = useRouter();
  const { signOut } = useSession();
  const me = useRiderMe();

  if (me.isPending) return <Loading />;
  if (me.isError)
    return <Failure message={errorMessage(me.error)} onRetry={() => void me.refetch()} />;
  const r = me.data;
  const partnerPhone = r.partnerPhone;

  return (
    <View style={styles.screen}>
      <TabHeader title={t.rider.profileTitle} />
      <ScrollView contentContainerStyle={styles.content}>
        <Card style={styles.identity}>
          <Avatar name={r.fullName ?? t.rider.appName} size={56} />
          <View style={styles.flex}>
            <Text style={styles.name}>{r.fullName ?? displayPhone(r.phone)}</Text>
            <Text style={styles.muted}>{t.rider.deliveredTotal(r.deliveredTotal)}</Text>
            <View style={styles.badge}>
              <Badge label={t.rider.verified} tone="brand" />
            </View>
          </View>
        </Card>
        <Card style={styles.list}>
          <SettingRow icon={Phone} title={t.rider.phone} value={displayPhone(r.phone)} />
          <SettingRow
            icon={MapPin}
            title={t.rider.zone}
            value={[r.zone, r.city].filter(Boolean).join(', ') || '—'}
          />
          <SettingRow icon={Building2} title={t.rider.company} value={r.partnerName} />
          <SettingRow
            icon={LifeBuoy}
            title={t.rider.help}
            value={partnerPhone ? `${t.rider.helpBody} · ${displayPhone(partnerPhone)}` : null}
            onPress={partnerPhone ? () => void Linking.openURL(`tel:${partnerPhone}`) : undefined}
          />
        </Card>
        <Pressable
          onPress={() => void signOut().then(() => router.replace('/'))}
          accessibilityRole="button"
          style={styles.logout}
        >
          <Text style={styles.logoutText}>{t.rider.logout}</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: space.md, paddingTop: space.xs, gap: space.md, paddingBottom: space.xl },
  identity: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  flex: { flex: 1, gap: 4 },
  name: { fontSize: font.title, fontWeight: '800', color: colors.text },
  muted: { fontSize: font.small, color: colors.muted },
  badge: { flexDirection: 'row' },
  list: { padding: 0, gap: 0, overflow: 'hidden' },
  logout: { alignItems: 'center', padding: space.md },
  logoutText: { color: colors.danger, fontWeight: '700', fontSize: font.body },
});
