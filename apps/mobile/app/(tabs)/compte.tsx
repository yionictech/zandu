import { Link, useRouter } from 'expo-router';
import { Bike, ChevronRight, Store } from 'lucide-react-native';
import { Pressable, StyleSheet, View } from 'react-native';
import { SERVER_PICKER } from '../../src/config';
import { displayPhone, formatXaf } from '../../src/format';
import { t } from '../../src/i18n/fr';
import { useFavorites } from '../../src/prefs';
import { apiUrl } from '../../src/server';
import { useSession } from '../../src/session';
import { colors, font, radius, space } from '../../src/theme';
import { Button } from '../../src/ui/Button';
import { Card } from '../../src/ui/kit';
import { Loading, Screen } from '../../src/ui/Layout';
import { ProductImage } from '../../src/ui/ProductImage';
import { Text } from '../../src/ui/Text';

/** Favoris gardés sur le téléphone (cœur de la fiche produit), lisibles même sans compte. */
function Favorites() {
  const { list } = useFavorites();
  return (
    <Card>
      <Text style={styles.cardTitle}>{t.account.favorites}</Text>
      {list.length === 0 ? <Text style={styles.label}>{t.account.noFavorites}</Text> : null}
      {list.map((f) => (
        <Link key={f.id} href={`/produit/${f.id}`} asChild>
          <Pressable style={styles.favorite}>
            <ProductImage uri={f.coverImage} title={f.title} style={styles.thumb} />
            <View style={styles.flex}>
              <Text style={styles.favoriteTitle} numberOfLines={1}>
                {f.title}
              </Text>
              <Text style={styles.label} numberOfLines={1}>
                {formatXaf(f.price)} · {f.shopName}
              </Text>
            </View>
            <ChevronRight color={colors.muted} size={18} />
          </Pressable>
        </Link>
      ))}
    </Card>
  );
}

/** APK de test : serveur utilisé, et lien pour en changer. */
function TestServerLink() {
  const router = useRouter();
  if (!SERVER_PICKER) return null;
  return (
    <Pressable
      onPress={() => router.push('/serveur')}
      accessibilityRole="button"
      style={styles.logout}
      testID="account-server"
    >
      <Text style={styles.label}>{t.server.current(apiUrl())}</Text>
      <Text style={styles.serverLink}>{t.server.change}</Text>
    </Pressable>
  );
}

/** Mon compte : numéro, favoris, espaces vendeur et livreur, déconnexion. */
export default function AccountScreen() {
  const router = useRouter();
  const { ready, user, signOut } = useSession();
  if (!ready) return <Loading />;
  if (!user) {
    return (
      <Screen>
        <Card>
          <Text style={styles.label}>{t.account.guest}</Text>
          <Button label={t.orders.login} onPress={() => router.push('/connexion')} />
        </Card>
        <Favorites />
        <TestServerLink />
      </Screen>
    );
  }
  return (
    <Screen>
      <Card>
        <Text style={styles.label}>{t.account.phone}</Text>
        <Text style={styles.value}>{displayPhone(user.phone)}</Text>
      </Card>
      <Favorites />
      {user.roles.includes('seller') ? (
        <Pressable
          style={styles.space}
          onPress={() => router.push('/vendeur')}
          accessibilityRole="button"
          testID="account-seller"
        >
          <Store color={colors.brand} size={22} strokeWidth={1.8} />
          <Text style={styles.spaceText}>{t.account.sellerSpace}</Text>
          <ChevronRight color={colors.muted} size={18} />
        </Pressable>
      ) : (
        <Card>
          <Text style={styles.cardTitle}>{t.account.sell}</Text>
          <Text style={styles.label}>{t.account.sellPitch}</Text>
          <Button
            label={t.account.openShop}
            variant="secondary"
            onPress={() => router.push('/vendeur/ouvrir')}
            testID="account-open-shop"
          />
        </Card>
      )}
      {user.roles.includes('rider') ? (
        <Pressable
          style={styles.space}
          onPress={() => router.push('/livreur')}
          accessibilityRole="button"
          testID="account-rider"
        >
          <Bike color={colors.brand} size={22} strokeWidth={1.8} />
          <Text style={styles.spaceText}>{t.account.riderSpace}</Text>
          <ChevronRight color={colors.muted} size={18} />
        </Pressable>
      ) : null}
      <Pressable onPress={() => void signOut()} accessibilityRole="button" style={styles.logout}>
        <Text style={styles.logoutText}>{t.account.logout}</Text>
      </Pressable>
      <TestServerLink />
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  cardTitle: { color: colors.text, fontWeight: '800', fontSize: font.body },
  label: { color: colors.muted, fontSize: font.small, lineHeight: 20 },
  value: { color: colors.text, fontSize: font.title, fontWeight: '700' },
  favorite: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: 4 },
  thumb: { width: 48, height: 48, borderRadius: radius.md },
  favoriteTitle: { color: colors.text, fontSize: font.small, fontWeight: '600' },
  space: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  spaceText: { flex: 1, color: colors.text, fontWeight: '700', fontSize: font.body },
  logout: { alignItems: 'center', padding: space.md },
  serverLink: { color: colors.brand, fontWeight: '700', fontSize: font.small },
  logoutText: { color: colors.danger, fontWeight: '700', fontSize: font.body },
});
