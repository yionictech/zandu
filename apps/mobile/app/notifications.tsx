import { useQueryClient } from '@tanstack/react-query';
import { useRouter, type Href } from 'expo-router';
import {
  Bike,
  Lock,
  Package,
  ShieldCheck,
  TriangleAlert,
  Wallet,
  XCircle,
  type LucideIcon,
} from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, SectionList, StyleSheet, View } from 'react-native';
import { api, errorMessage } from '../src/api';
import { t } from '../src/i18n/fr';
import { useInbox } from '../src/inbox';
import { colors, font, radius, space } from '../src/theme';
import { Chip } from '../src/ui/Form';
import { Empty, Failure, Loading } from '../src/ui/Layout';
import { RequireSignIn } from '../src/ui/RequireRole';
import { Text } from '../src/ui/Text';

type Item = {
  id: string;
  template: string;
  title: string;
  body: string;
  url: string | null;
  createdAt: string;
  unread: boolean;
};

/** Icône et couleur de chaque message (maquette « Notifications »). */
const LOOK: Record<string, [LucideIcon, string]> = {
  buyer_in_delivery: [Bike, colors.waiting],
  buyer_awaiting_collection: [Package, colors.waiting],
  buyer_handover_code: [Lock, colors.brand],
  buyer_payment_confirmed: [ShieldCheck, colors.brand],
  buyer_delivered: [Package, colors.brand],
  buyer_refunded: [Wallet, colors.brand],
  buyer_late_payment: [Wallet, colors.brand],
  seller_new_order: [Package, colors.danger],
  seller_dispute_opened: [TriangleAlert, colors.danger],
  seller_order_completed: [Wallet, colors.brand],
  seller_payout_sent: [Wallet, colors.brand],
  order_cancelled: [XCircle, colors.danger],
};

const time = new Intl.DateTimeFormat('fr-FR', {
  timeZone: 'Africa/Brazzaville',
  hour: '2-digit',
  minute: '2-digit',
});
const day = new Intl.DateTimeFormat('fr-CA', { timeZone: 'Africa/Brazzaville' });

function sectionOf(iso: string): string {
  const d = day.format(new Date(iso));
  if (d === day.format(new Date())) return t.inbox.today;
  if (d === day.format(new Date(Date.now() - 86_400_000))) return t.inbox.yesterday;
  return t.inbox.earlier;
}

function Row({ item, onPress }: { item: Item; onPress: () => void }) {
  const [Icon, accent] = LOOK[item.template] ?? [Package, colors.muted];
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
      accessibilityRole="button"
    >
      <View style={[styles.icon, { backgroundColor: accent }]}>
        <Icon color={colors.onBrand} size={20} strokeWidth={1.9} />
      </View>
      <View style={styles.body}>
        <View style={styles.titleRow}>
          <Text style={styles.title} numberOfLines={1}>
            {item.title}
          </Text>
          <Text style={styles.time}>{time.format(new Date(item.createdAt))}</Text>
          {item.unread ? <View style={styles.dot} /> : null}
        </View>
        <Text style={styles.text}>{item.body}</Text>
      </View>
    </Pressable>
  );
}

function Notifications() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const inbox = useInbox(true);
  const [onlyOrders, setOnlyOrders] = useState(false);

  if (inbox.isPending) return <Loading />;
  if (inbox.isError)
    return <Failure message={errorMessage(inbox.error)} onRetry={() => void inbox.refetch()} />;

  const items = inbox.data.items.filter((i) => !onlyOrders || i.url?.includes('/commande'));
  const sections = [t.inbox.today, t.inbox.yesterday, t.inbox.earlier]
    .map((title) => ({ title, data: items.filter((i) => sectionOf(i.createdAt) === title) }))
    .filter((s) => s.data.length);

  const readAll = async () => {
    await api.POST('/v1/me/notifications/seen').catch(() => undefined);
    void queryClient.invalidateQueries({ queryKey: ['inbox'] });
  };

  return (
    <SectionList
      sections={sections}
      keyExtractor={(i) => i.id}
      contentContainerStyle={styles.list}
      stickySectionHeadersEnabled={false}
      refreshing={inbox.isRefetching}
      onRefresh={() => void inbox.refetch()}
      ListHeaderComponent={
        <View style={styles.filters}>
          <Chip label={t.inbox.all} selected={!onlyOrders} onPress={() => setOnlyOrders(false)} />
          <Chip label={t.inbox.orders} selected={onlyOrders} onPress={() => setOnlyOrders(true)} />
          <View style={styles.spacer} />
          {inbox.data.unread ? (
            <Pressable onPress={() => void readAll()} accessibilityRole="button">
              <Text style={styles.readAll}>{t.inbox.readAll}</Text>
            </Pressable>
          ) : null}
        </View>
      }
      renderSectionHeader={({ section }) => (
        <Text style={styles.section}>{section.title.toUpperCase()}</Text>
      )}
      renderItem={({ item }) => (
        <Row item={item} onPress={() => item.url && router.push(item.url as Href)} />
      )}
      ListEmptyComponent={<Empty message={t.inbox.empty} />}
    />
  );
}

export default function NotificationsScreen() {
  return (
    <RequireSignIn>
      <Notifications />
    </RequireSignIn>
  );
}

const styles = StyleSheet.create({
  list: { padding: space.md, gap: space.sm, flexGrow: 1 },
  filters: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginBottom: space.sm },
  spacer: { flex: 1 },
  readAll: { color: colors.brand, fontWeight: '700', fontSize: font.small },
  section: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1,
    marginTop: space.md,
    marginBottom: space.xs,
  },
  row: {
    flexDirection: 'row',
    gap: space.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space.md,
    marginBottom: space.sm,
  },
  pressed: { backgroundColor: colors.surfaceRaised },
  icon: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: { flex: 1, gap: 2 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  title: { flex: 1, color: colors.text, fontWeight: '700', fontSize: font.body },
  time: { color: colors.muted, fontSize: 12 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.brand },
  text: { color: colors.muted, fontSize: font.small, lineHeight: 19 },
});
