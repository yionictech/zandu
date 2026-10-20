import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  BadgeCheck,
  Bell,
  Box,
  Check,
  ChevronRight,
  Clock3,
  ShieldCheck,
  Store,
  TriangleAlert,
} from 'lucide-react-native';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { errorMessage } from '../../../src/api';
import { groupThousands } from '../../../src/format';
import { t } from '../../../src/i18n/fr';
import { useInbox } from '../../../src/inbox';
import {
  operatorName,
  timeOf,
  useBalance,
  useDashboard,
  useShop,
} from '../../../src/seller/queries';
import { TabHeader } from '../../../src/seller/ui';
import { colors, font, radius, space } from '../../../src/theme';
import { useRefetchOnFocus } from '../../../src/useRefetchOnFocus';
import { Avatar, Card, IconButton } from '../../../src/ui/kit';
import { Banner } from '../../../src/ui/Banner';
import { Failure, Loading } from '../../../src/ui/Layout';
import { Text } from '../../../src/ui/Text';

/** Tableau de bord vendeur : ce qui presse, l'argent, la journée, le stock (maquette « Accueil »). */
export default function SellerDashboard() {
  const router = useRouter();
  const { sent } = useLocalSearchParams<{ sent?: string }>();
  const shop = useShop();
  const dashboard = useDashboard();
  const balance = useBalance();
  const inbox = useInbox(true);
  const refetchAll = () => {
    void shop.refetch();
    void dashboard.refetch();
    void balance.refetch();
  };
  useRefetchOnFocus(refetchAll);

  if (shop.isPending || dashboard.isPending) return <Loading />;
  if (shop.isError || dashboard.isError)
    return <Failure message={errorMessage(shop.error ?? dashboard.error)} onRetry={refetchAll} />;
  const s = shop.data;
  const d = dashboard.data;
  const verified = s.verificationStatus === 'verified';
  const steps = [verified, d.productCount >= 3, !!s.openingHours];
  const low = d.lowStock[0];

  return (
    <View style={styles.screen}>
      <TabHeader
        title={
          <Pressable
            style={styles.identity}
            onPress={() => router.push('/vendeur/boutique')}
            accessibilityRole="button"
            accessibilityLabel={t.vendor.myShop}
            testID="dashboard-shop"
          >
            <Avatar name={s.shopName} size={44} />
            <View style={styles.flex}>
              <Text style={styles.shopName} numberOfLines={1}>
                {s.shopName}
              </Text>
              {verified ? (
                <View style={styles.verifiedRow}>
                  <BadgeCheck color={colors.brand} size={14} strokeWidth={2} />
                  <Text style={styles.verified}>{t.seller.verified}</Text>
                </View>
              ) : (
                <Text style={styles.muted}>{t.seller.productStatus.pending_review}</Text>
              )}
            </View>
          </Pressable>
        }
        right={
          <View style={styles.headerActions}>
            <IconButton
              icon={Store}
              label={t.vendor.myShop}
              onPress={() => router.push('/vendeur/boutique')}
            />
            <IconButton
              icon={Bell}
              label={t.inbox.title}
              dot={(inbox.data?.unread ?? 0) > 0}
              onPress={() => router.push('/notifications')}
            />
          </View>
        }
      />
      <ScrollView contentContainerStyle={styles.content}>
        {sent && !verified ? <Banner message={t.vendor.requestSent} tone="trust" /> : null}
        {!s.isOpen ? (
          <Pressable
            style={styles.closed}
            onPress={() => router.push('/vendeur/boutique')}
            accessibilityRole="button"
          >
            <Text style={styles.closedText}>{t.vendor.closedBanner}</Text>
            <Text style={styles.closedAction}>{t.vendor.reopen}</Text>
          </Pressable>
        ) : null}

        {d.toAccept.count > 0 ? (
          <Pressable
            style={styles.urgent}
            onPress={() =>
              router.push({ pathname: '/vendeur/commandes', params: { filter: 'new' } })
            }
            accessibilityRole="button"
            testID="dashboard-new-orders"
          >
            <View style={styles.urgentIcon}>
              <Box color={colors.onBrand} size={20} strokeWidth={2} />
            </View>
            <View style={styles.flex}>
              <Text style={styles.urgentTitle}>{t.vendor.newOrders(d.toAccept.count)}</Text>
              {d.toAccept.nextDeadline ? (
                <Text style={styles.urgentText}>
                  {t.vendor.acceptBefore(timeOf(d.toAccept.nextDeadline))}
                </Text>
              ) : null}
            </View>
            <ChevronRight color={colors.onBrand} size={20} />
          </Pressable>
        ) : null}

        {!verified ? (
          <Pressable
            onPress={() => router.push('/vendeur/verification')}
            accessibilityRole="button"
            testID="kyc-banner"
          >
            <Card highlight={s.verificationStatus !== 'pending_review'}>
              <View style={styles.row}>
                <ShieldCheck
                  color={s.verificationStatus === 'pending_review' ? colors.waiting : colors.brand}
                  size={22}
                  strokeWidth={1.8}
                />
                <View style={styles.flex}>
                  <Text style={styles.cardTitle}>
                    {s.verificationStatus === 'pending_review'
                      ? t.vendor.pendingTitle
                      : t.vendor.toVerify}
                  </Text>
                  <Text style={styles.muted}>
                    {s.verificationStatus === 'pending_review'
                      ? t.vendor.pendingBody
                      : s.verificationStatus === 'rejected'
                        ? t.seller.kycRejectedShort
                        : s.verificationStatus === 'suspended'
                          ? t.seller.suspended
                          : t.seller.kycBanner}
                  </Text>
                </View>
                <ChevronRight color={colors.muted} size={18} />
              </View>
            </Card>
          </Pressable>
        ) : null}

        <Card>
          <View style={styles.row}>
            <Text style={styles.cardTitle}>{t.vendor.myMoney}</Text>
            <Pressable onPress={() => router.push('/vendeur/argent')} hitSlop={8}>
              <Text style={styles.link}>{t.vendor.details}</Text>
            </Pressable>
          </View>
          <View style={styles.tiles}>
            <View style={styles.tile}>
              <View style={styles.dotRow}>
                <View style={[styles.dot, { backgroundColor: colors.waiting }]} />
                <Text style={styles.muted}>{t.vendor.blocked}</Text>
              </View>
              <Text style={styles.tileAmount} numberOfLines={1} testID="money-escrow">
                {groupThousands(String(balance.data?.inEscrow ?? 0))}
              </Text>
              <Text style={styles.small}>FCFA · {t.vendor.inDelivery}</Text>
            </View>
            <View style={styles.tile}>
              <View style={styles.dotRow}>
                <View style={[styles.dot, { backgroundColor: colors.brand }]} />
                <Text style={styles.muted}>{t.vendor.availableShort}</Text>
              </View>
              <Text
                style={[styles.tileAmount, { color: colors.brand }]}
                numberOfLines={1}
                testID="money-available"
              >
                {groupThousands(String(balance.data?.available ?? 0))}
              </Text>
              <Text style={styles.small}>FCFA · {t.vendor.paidAutomatically}</Text>
            </View>
          </View>
          <Text style={styles.note}>{t.vendor.payoutTo(operatorName(s.payoutOperator))}</Text>
        </Card>

        <View style={styles.stats}>
          <View style={styles.stat}>
            <Text style={styles.statLabel}>{t.vendor.sales}</Text>
            <Text style={[styles.statValue, styles.statMoney]} numberOfLines={1}>
              {groupThousands(String(d.todaySales))}
            </Text>
            <Text style={styles.small}>{t.vendor.todayAmount}</Text>
          </View>
          <View style={styles.stat}>
            <Text style={styles.statLabel}>{t.vendor.ordersStat}</Text>
            <Text style={styles.statValue}>{d.todayOrders}</Text>
            <Text style={styles.small}>{t.vendor.today}</Text>
          </View>
          <View style={styles.stat}>
            <Text style={styles.statLabel}>{t.vendor.rating}</Text>
            <Text style={styles.statValue}>
              {s.ratingAvg ? s.ratingAvg.toFixed(1).replace('.', ',') : '—'}
            </Text>
            <Text style={styles.small}>
              {s.ratingCount ? t.vendor.reviewsCount(s.ratingCount) : t.vendor.noReviews}
            </Text>
          </View>
        </View>

        {low ? (
          <Card>
            <View style={styles.dotRow}>
              <TriangleAlert color={colors.danger} size={18} strokeWidth={2} />
              <Text style={styles.cardTitle}>{t.vendor.lowStock}</Text>
            </View>
            <View style={styles.row}>
              <View style={styles.flex}>
                <Text style={styles.body} numberOfLines={2}>
                  {low.title}
                </Text>
                <Text style={styles.danger}>{t.vendor.onlyLeft(low.stock)}</Text>
              </View>
              <Pressable
                style={styles.pill}
                onPress={() => router.push(`/vendeur/produit/${low.id}`)}
                accessibilityRole="button"
              >
                <Text style={styles.pillText}>{t.vendor.restock}</Text>
              </Pressable>
            </View>
          </Card>
        ) : null}

        {steps.some((done) => !done) ? (
          <Card>
            <View style={styles.row}>
              <Text style={styles.cardTitle}>{t.vendor.firstSteps}</Text>
              <Text style={styles.muted}>
                {t.vendor.firstStepsCount(steps.filter(Boolean).length)}
              </Text>
            </View>
            {(
              [
                [t.vendor.stepVerified, t.vendor.stepVerifiedHint, '/vendeur/verification'],
                [t.vendor.stepProducts, t.vendor.stepProductsHint, '/vendeur/produit/nouveau'],
                [t.vendor.stepHours, t.vendor.stepHoursHint, '/vendeur/boutique'],
              ] as const
            ).map(([title, hint, href], i) => (
              <Pressable
                key={title}
                style={styles.stepRow}
                onPress={() => router.push(href)}
                accessibilityRole="button"
              >
                <View style={[styles.stepDot, steps[i] && styles.stepDotDone]}>
                  {steps[i] ? <Check color={colors.onBrand} size={14} strokeWidth={3} /> : null}
                </View>
                <View style={styles.flex}>
                  <Text style={styles.body}>{title}</Text>
                  <Text style={styles.small}>{hint}</Text>
                </View>
                <ChevronRight color={colors.muted} size={18} />
              </Pressable>
            ))}
            <Pressable
              style={styles.primary}
              onPress={() => router.push('/vendeur/produit/nouveau')}
              accessibilityRole="button"
              testID="dashboard-add-product"
            >
              <Text style={styles.primaryText}>{t.seller.actions.addProduct}</Text>
            </Pressable>
          </Card>
        ) : null}

        {s.openingHours ? (
          <View style={styles.hours}>
            <Clock3 color={colors.muted} size={16} />
            <Text style={styles.small}>{s.openingHours}</Text>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: space.md, paddingTop: space.xs, gap: space.md, paddingBottom: space.xl },
  identity: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  headerActions: { flexDirection: 'row', gap: space.sm },
  flex: { flex: 1, gap: 2 },
  shopName: { fontSize: font.title, fontWeight: '800', color: colors.text },
  verifiedRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  verified: { color: colors.brand, fontSize: 12, fontWeight: '700' },
  muted: { color: colors.muted, fontSize: font.small, lineHeight: 18 },
  small: { color: colors.muted, fontSize: 12 },
  body: { color: colors.text, fontSize: font.body },
  danger: { color: colors.danger, fontSize: font.small, fontWeight: '700' },
  link: { color: colors.brand, fontSize: font.small, fontWeight: '700' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.sm,
  },
  closed: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.danger,
    padding: space.md,
  },
  closedText: { flex: 1, color: colors.text, fontSize: font.small },
  closedAction: { color: colors.brand, fontWeight: '700' },
  urgent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    backgroundColor: colors.danger,
    borderRadius: radius.lg,
    padding: space.md,
  },
  urgentIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(11,14,21,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  urgentTitle: { color: colors.onBrand, fontSize: font.body, fontWeight: '800' },
  urgentText: { color: colors.onBrand, fontSize: font.small },
  cardTitle: { color: colors.text, fontSize: font.body, fontWeight: '800' },
  tiles: { flexDirection: 'row', gap: space.sm },
  tile: {
    flex: 1,
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.md,
    padding: space.sm + 4,
    gap: 4,
  },
  dotRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  note: { color: colors.muted, fontSize: 12, textAlign: 'center' },
  stats: { flexDirection: 'row', gap: space.sm },
  stat: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 10,
    gap: 2,
  },
  statLabel: { color: colors.muted, fontSize: 12, fontWeight: '600' },
  statValue: { color: colors.text, fontSize: 20, fontWeight: '800' },
  statMoney: { fontSize: 16 },
  tileAmount: { color: colors.text, fontSize: 20, fontWeight: '800' },
  pill: {
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: space.md,
    paddingVertical: 10,
  },
  pillText: { color: colors.text, fontWeight: '700', fontSize: font.small },
  stepRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: 6 },
  stepDot: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: colors.faint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepDotDone: { backgroundColor: colors.brand, borderColor: colors.brand },
  primary: {
    backgroundColor: colors.brand,
    borderRadius: radius.pill,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: space.xs,
  },
  primaryText: { color: colors.onBrand, fontWeight: '800', fontSize: font.body },
  hours: { flexDirection: 'row', alignItems: 'center', gap: 6, justifyContent: 'center' },
});
