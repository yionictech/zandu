import type { PrepMinutes } from '@zandu/api-client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { Clock3, CreditCard, ShieldCheck, Star, Store } from 'lucide-react-native';
import { Pressable, StyleSheet, View } from 'react-native';
import { api, errorMessage, unwrap } from '../../src/api';
import { displayPhone } from '../../src/format';
import { t } from '../../src/i18n/fr';
import { operatorName, sellerKeys, useShop } from '../../src/seller/queries';
import { SettingRow, Toggle } from '../../src/seller/ui';
import { useSession } from '../../src/session';
import { colors, font, radius, space } from '../../src/theme';
import { Chip, ErrorText } from '../../src/ui/Form';
import { Card, Eyebrow } from '../../src/ui/kit';
import { Failure, Loading, Screen } from '../../src/ui/Layout';
import { RequireRole } from '../../src/ui/RequireRole';
import { Text } from '../../src/ui/Text';

const PREP: PrepMinutes[] = [15, 30, 60, 120];

function MyShop() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { signOut } = useSession();
  const shop = useShop();
  const update = useMutation({
    mutationFn: async (body: { isOpen?: boolean; defaultPrepMinutes?: PrepMinutes }) =>
      unwrap(await api.PATCH('/v1/seller/shop', { body })),
    onSuccess: (updated) => {
      queryClient.setQueryData(sellerKeys.shop, updated);
      void queryClient.invalidateQueries({ queryKey: ['seller'] });
    },
  });

  if (shop.isPending) return <Loading />;
  if (shop.isError)
    return <Failure message={errorMessage(shop.error)} onRetry={() => void shop.refetch()} />;
  const s = shop.data;
  const isOpen =
    update.isPending && update.variables.isOpen !== undefined ? update.variables.isOpen : s.isOpen;
  const prep =
    update.isPending && update.variables.defaultPrepMinutes
      ? update.variables.defaultPrepMinutes
      : s.defaultPrepMinutes;
  const phone = displayPhone(s.payoutPhone);

  return (
    <Screen>
      <Card>
        <View style={styles.row}>
          <View style={styles.flex}>
            <Text style={styles.cardTitle}>{isOpen ? t.vendor.shopOpen : t.vendor.shopClosed}</Text>
            <Text style={styles.muted}>{t.vendor.shopOpenHint}</Text>
          </View>
          <Toggle
            value={isOpen}
            onChange={(next) => update.mutate({ isOpen: next })}
            label={t.vendor.shopOpen}
            disabled={update.isPending}
            testID="shop-open-toggle"
          />
        </View>
      </Card>

      <Card>
        <Eyebrow>{t.vendor.defaultPrep}</Eyebrow>
        <View style={styles.wrap}>
          {PREP.map((minutes) => (
            <Chip
              key={minutes}
              label={t.vendor.prepChoices[minutes]!}
              selected={prep === minutes}
              onPress={() => update.mutate({ defaultPrepMinutes: minutes })}
              testID={`shop-prep-${minutes}`}
            />
          ))}
        </View>
      </Card>
      <ErrorText message={update.error ? errorMessage(update.error) : null} />

      <View style={styles.list}>
        <SettingRow
          icon={Store}
          title={t.vendor.infoAndLogo}
          value={`${s.shopName} · ${s.pickupZoneName}`}
          onPress={() => router.push({ pathname: '/vendeur/ouvrir', params: { edit: '1' } })}
        />
        <SettingRow
          icon={Clock3}
          title={t.vendor.hours}
          value={s.openingHours ?? t.vendor.hoursMissing}
          onPress={() => router.push({ pathname: '/vendeur/ouvrir', params: { edit: '1' } })}
        />
        <SettingRow
          icon={CreditCard}
          title={t.vendor.mobileMoneyAccount}
          value={`${operatorName(s.payoutOperator)} · ${phone.slice(0, 2)} ••• •• ${phone.slice(-2)}`}
          onPress={() => router.push('/vendeur/compte')}
        />
        <SettingRow
          icon={ShieldCheck}
          title={t.seller.actions.verification}
          value={
            s.verificationStatus === 'verified'
              ? t.seller.verified
              : t.seller.productStatus.pending_review
          }
          onPress={() => router.push('/vendeur/verification')}
        />
        <SettingRow
          icon={Star}
          title={t.vendor.reviewsTitle}
          value={
            s.ratingCount
              ? `${(s.ratingAvg ?? 0).toFixed(1).replace('.', ',')} · ${t.vendor.reviewsCount(s.ratingCount)}`
              : t.vendor.noReviews
          }
          onPress={() => router.push('/vendeur/avis')}
          testID="shop-reviews"
        />
      </View>

      <Pressable
        onPress={() => void signOut().then(() => router.replace('/'))}
        accessibilityRole="button"
        style={styles.logout}
      >
        <Text style={styles.logoutText}>{t.vendor.logout}</Text>
      </Pressable>
    </Screen>
  );
}

/** Ma boutique (maquette) : congés, préparation par défaut, infos, horaires, compte, avis. */
export default function MyShopScreen() {
  return (
    <RequireRole role="seller">
      <MyShop />
    </RequireRole>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  flex: { flex: 1, gap: 4 },
  cardTitle: { color: colors.text, fontWeight: '800', fontSize: font.body },
  muted: { color: colors.muted, fontSize: font.small, lineHeight: 18 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  list: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  logout: { alignItems: 'center', padding: space.md },
  logoutText: { color: colors.danger, fontWeight: '700', fontSize: font.body },
});
