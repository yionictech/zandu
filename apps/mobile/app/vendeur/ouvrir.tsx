import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Redirect, Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Bike, ShieldCheck, Store, Wallet } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api, errorCode, errorMessage, unwrap } from '../../src/api';
import { displayPhone } from '../../src/format';
import { t } from '../../src/i18n/fr';
import { useShop } from '../../src/seller/queries';
import { useSession } from '../../src/session';
import { colors, font, radius, space } from '../../src/theme';
import { Button } from '../../src/ui/Button';
import { Chip, ErrorText, Field } from '../../src/ui/Form';
import { Badge, Card, HeaderBadge } from '../../src/ui/kit';
import { Loading, Screen } from '../../src/ui/Layout';
import { Text } from '../../src/ui/Text';

const CITIES = ['Pointe-Noire', 'Brazzaville'] as const;
const DAYS = ['mondayToSaturday', 'weekdays', 'everyDay'] as const;
type Days = (typeof DAYS)[number];
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/** « Lun – Sam · 08:00 – 18:00 » ⇄ jours, ouverture, fermeture. */
function parseHours(value: string | null | undefined): { days: Days; open: string; close: string } {
  const match = value?.match(/^(.+) · (\d\d:\d\d) – (\d\d:\d\d)$/);
  const days = DAYS.find((d) => t.vendor.days[d] === match?.[1]) ?? 'mondayToSaturday';
  return { days, open: match?.[2] ?? '08:00', close: match?.[3] ?? '18:00' };
}

/** Présentation de l'espace vendeur, avant le formulaire (maquette « Vendez votre électronique »). */
function Intro({ phone, onStart }: { phone: string; onStart: () => void }) {
  const insets = useSafeAreaInsets();
  const icons = [ShieldCheck, Bike, Wallet];
  return (
    <View style={[styles.screen, { paddingBottom: insets.bottom }]}>
      <Stack.Screen options={{ headerRight: () => <HeaderBadge label={t.vendor.badge} /> }} />
      <ScrollView contentContainerStyle={styles.intro}>
        <View style={styles.heroIcon}>
          <Store color={colors.onBrand} size={34} strokeWidth={1.8} />
        </View>
        <Text style={styles.heroTitle}>{t.vendor.heroTitle}</Text>
        <Card>
          {t.vendor.perks.map(([title, hint], i) => {
            const Icon = icons[i]!;
            return (
              <View key={title} style={styles.perk}>
                <Icon color={colors.brand} size={20} strokeWidth={1.8} />
                <View style={styles.flex}>
                  <Text style={styles.perkTitle}>{title}</Text>
                  <Text style={styles.muted}>{hint}</Text>
                </View>
              </View>
            );
          })}
        </Card>
        <Text style={styles.label}>{t.vendor.managerPhone}</Text>
        <View style={styles.phoneRow}>
          <View style={styles.prefix}>
            <Text style={styles.prefixText}>+242</Text>
          </View>
          <View style={[styles.prefix, styles.flex]}>
            <Text style={styles.phone}>{displayPhone(phone)}</Text>
          </View>
        </View>
      </ScrollView>
      <View style={styles.footer}>
        <Button label={t.vendor.start} onPress={onStart} testID="shop-start" />
      </View>
    </View>
  );
}

/**
 * Ouvrir ma boutique, étape 1 sur 3 : nom, ce qui est vendu, lieu de retrait, horaires. Avec
 * `?edit=1`, le même formulaire modifie la boutique (« Infos », « Heures d'ouverture »).
 */
export default function OpenShopScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { edit } = useLocalSearchParams<{ edit?: string }>();
  const { ready, user, refresh } = useSession();
  const editing = edit === '1' && !!user?.roles.includes('seller');
  const shop = useShop();
  const [started, setStarted] = useState(false);
  const [shopName, setShopName] = useState('');
  const [sold, setSold] = useState<string[]>([]);
  const [city, setCity] = useState<(typeof CITIES)[number]>('Pointe-Noire');
  const [zoneId, setZoneId] = useState<string | null>(null);
  const [days, setDays] = useState<Days>('mondayToSaturday');
  const [open, setOpen] = useState('08:00');
  const [close, setClose] = useState('18:00');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filled, setFilled] = useState(false);

  const zones = useQuery({
    queryKey: ['zones'],
    queryFn: async () => unwrap(await api.GET('/v1/delivery/zones')),
    staleTime: 3_600_000,
  });
  const categories = useQuery({
    queryKey: ['categories'],
    queryFn: async () => unwrap(await api.GET('/v1/categories')),
    staleTime: 3_600_000,
  });

  // Modification : formulaire prérempli avec la boutique.
  useEffect(() => {
    if (!editing || filled || !shop.data) return;
    const s = shop.data;
    const hours = parseHours(s.openingHours);
    setShopName(s.shopName);
    setSold(s.soldCategoryIds);
    setCity(
      CITIES.includes(s.city as (typeof CITIES)[number])
        ? (s.city as (typeof CITIES)[number])
        : 'Pointe-Noire',
    );
    setZoneId(s.pickupZoneId);
    setDays(hours.days);
    setOpen(hours.open);
    setClose(hours.close);
    setFilled(true);
  }, [editing, filled, shop.data]);

  if (!ready) return <Loading />;
  if (!user)
    return <Redirect href={{ pathname: '/connexion', params: { next: '/vendeur/ouvrir' } }} />;
  if (user.roles.includes('seller') && !editing) return <Redirect href="/vendeur" />;
  if (editing && !filled) return <Loading />;
  if (!editing && !started) return <Intro phone={user.phone} onStart={() => setStarted(true)} />;

  const hoursValid = TIME.test(open) && TIME.test(close) && open < close;
  const valid = shopName.trim().length >= 2 && !!zoneId && hoursValid;
  const openingHours = `${t.vendor.days[days]} · ${open} – ${close}`;
  const roots = (categories.data ?? []).filter((c) => !c.parentId);

  const submit = async () => {
    if (!zoneId) return;
    setBusy(true);
    setError(null);
    const fields = {
      shopName: shopName.trim(),
      city,
      pickupZoneId: zoneId,
      soldCategoryIds: sold,
      openingHours,
    };
    try {
      if (editing) {
        const updated = unwrap(await api.PATCH('/v1/seller/shop', { body: fields }));
        queryClient.setQueryData(['seller', 'shop'], updated);
        void queryClient.invalidateQueries({ queryKey: ['seller'] });
        router.back();
        return;
      }
      unwrap(await api.POST('/v1/seller/shop', { body: fields }));
      await refresh();
      router.replace({ pathname: '/vendeur/verification', params: { onboarding: '1' } });
    } catch (e) {
      // Boutique créée mais réponse perdue (coupure réseau) : on reprend simplement la suite.
      if (errorCode(e) === 'shop_exists') {
        await refresh().catch(() => undefined);
        router.replace({ pathname: '/vendeur/verification', params: { onboarding: '1' } });
        return;
      }
      setError(errorMessage(e));
      setBusy(false);
    }
  };

  return (
    <Screen
      footer={
        <>
          <ErrorText message={error} />
          <Button
            label={editing ? t.vendor.save : t.vendor.continue}
            onPress={() => void submit()}
            disabled={!valid}
            loading={busy}
            testID="shop-create"
          />
        </>
      }
    >
      <Stack.Screen
        options={{
          title: editing ? t.vendor.infoAndLogo : t.seller.openTitle,
          headerRight: editing ? undefined : () => <HeaderBadge label={t.vendor.step(1)} />,
        }}
      />
      <Field
        label={t.seller.shopName}
        value={shopName}
        onChangeText={setShopName}
        placeholder={t.seller.shopNamePlaceholder}
        maxLength={80}
        testID="shop-name"
      />
      <Text style={styles.label}>{t.vendor.whatYouSell}</Text>
      <View style={styles.wrap}>
        {roots.map((c) => (
          <Chip
            key={c.id}
            label={c.name}
            selected={sold.includes(c.id)}
            onPress={() =>
              setSold((list) =>
                list.includes(c.id)
                  ? list.filter((id) => id !== c.id)
                  : [...list, c.id].slice(0, 10),
              )
            }
            testID={`shop-sells-${c.slug}`}
          />
        ))}
      </View>
      <Text style={styles.label}>{t.seller.city}</Text>
      <View style={styles.wrap}>
        {CITIES.map((c) => (
          <Chip
            key={c}
            label={c}
            selected={city === c}
            onPress={() => {
              setCity(c);
              setZoneId(null);
            }}
          />
        ))}
      </View>
      <Text style={styles.label}>{t.vendor.pickupWhere}</Text>
      {zones.isPending ? <Loading /> : null}
      <View style={styles.wrap}>
        {(zones.data ?? [])
          .filter((z) => z.city === city)
          .map((z) => (
            <Chip
              key={z.id}
              label={z.name}
              selected={zoneId === z.id}
              onPress={() => setZoneId(z.id)}
              testID={`shop-zone-${z.name}`}
            />
          ))}
      </View>
      <Text style={styles.label}>{t.vendor.openingHours}</Text>
      <View style={styles.wrap}>
        {DAYS.map((d) => (
          <Chip key={d} label={t.vendor.days[d]} selected={days === d} onPress={() => setDays(d)} />
        ))}
      </View>
      <View style={styles.hours}>
        <View style={styles.flex}>
          <Field
            label="Ouverture"
            value={open}
            onChangeText={setOpen}
            keyboardType="numbers-and-punctuation"
            maxLength={5}
            testID="shop-open-time"
          />
        </View>
        <View style={styles.flex}>
          <Field
            label="Fermeture"
            value={close}
            onChangeText={setClose}
            keyboardType="numbers-and-punctuation"
            maxLength={5}
            testID="shop-close-time"
          />
        </View>
      </View>
      {!editing ? (
        <View style={styles.later}>
          <Badge label={t.vendor.step(2)} />
          <Text style={styles.muted}>{t.vendor.verifyIntro}</Text>
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  intro: { padding: space.md, gap: space.md },
  heroIcon: {
    width: 76,
    height: 76,
    borderRadius: radius.lg,
    backgroundColor: colors.brand,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroTitle: { fontSize: 28, fontWeight: '800', color: colors.text, lineHeight: 34 },
  perk: { flexDirection: 'row', gap: space.md, alignItems: 'center', paddingVertical: 4 },
  perkTitle: { color: colors.text, fontWeight: '700', fontSize: font.body },
  flex: { flex: 1, gap: 2 },
  muted: { color: colors.muted, fontSize: font.small, lineHeight: 18 },
  label: { fontSize: font.small, fontWeight: '600', color: colors.muted, marginTop: space.xs },
  phoneRow: { flexDirection: 'row', gap: space.sm },
  prefix: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    minHeight: 52,
    justifyContent: 'center',
  },
  prefixText: { color: colors.text, fontWeight: '700' },
  phone: { color: colors.text, fontSize: font.body },
  footer: {
    padding: space.md,
    backgroundColor: colors.bar,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  hours: { flexDirection: 'row', gap: space.sm },
  later: { flexDirection: 'row', gap: space.sm, alignItems: 'center', opacity: 0.8 },
});
