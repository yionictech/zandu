import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from '../../../src/ui/Text';
import { api, errorMessage, unwrap } from '../../../src/api';
import { formatDateTime, formatXaf } from '../../../src/format';
import { t } from '../../../src/i18n/fr';
import { sellerKeys } from '../../../src/seller/queries';
import { statusColor } from '../../../src/status';
import { colors, font, radius, space } from '../../../src/theme';
import { Banner } from '../../../src/ui/Banner';
import { Button } from '../../../src/ui/Button';
import { Chip, ErrorText, Field } from '../../../src/ui/Form';
import { Failure, Loading, Screen, Section } from '../../../src/ui/Layout';
import { RequireRole } from '../../../src/ui/RequireRole';
import { Timeline } from '../../../src/ui/Timeline';

type Action = { kind: 'accept' } | { kind: 'ready' } | { kind: 'reject'; reason: string };

function SellerOrder({ id }: { id: string }) {
  const queryClient = useQueryClient();
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');

  const order = useQuery({
    queryKey: sellerKeys.order(id),
    queryFn: async () =>
      unwrap(await api.GET('/v1/seller/orders/{id}', { params: { path: { id } } })),
    refetchInterval: 30_000,
  });
  const action = useMutation({
    mutationFn: async (a: Action) => {
      const params = { params: { path: { id } } };
      if (a.kind === 'accept')
        return unwrap(await api.POST('/v1/seller/orders/{id}/accept', params));
      if (a.kind === 'ready') return unwrap(await api.POST('/v1/seller/orders/{id}/ready', params));
      return unwrap(
        await api.POST('/v1/seller/orders/{id}/reject', { ...params, body: { reason: a.reason } }),
      );
    },
    onSuccess: () => {
      setRejecting(false);
      void queryClient.invalidateQueries({ queryKey: ['seller'] });
    },
  });

  if (order.isPending) return <Loading />;
  if (order.isError)
    return <Failure message={errorMessage(order.error)} onRetry={() => void order.refetch()} />;
  const o = order.data;
  const rate = o.itemsSubtotal > 0 ? Math.round((o.commission / o.itemsSubtotal) * 100) : 0;

  const footer =
    o.status === 'paid' ? (
      rejecting ? (
        <>
          <Text style={styles.label}>{t.seller.rejectReason}</Text>
          <View style={styles.wrap}>
            {t.seller.rejectReasons.map((r) => (
              <Chip key={r} label={r} selected={reason === r} onPress={() => setReason(r)} />
            ))}
          </View>
          <Field label={t.dispute.reasons.other} value={reason} onChangeText={setReason} />
          <ErrorText message={action.error ? errorMessage(action.error) : null} />
          <Button
            label={t.seller.confirmReject}
            onPress={() => action.mutate({ kind: 'reject', reason: reason.trim() })}
            disabled={reason.trim().length < 3}
            loading={action.isPending}
          />
          <Button label={t.common.cancel} variant="ghost" onPress={() => setRejecting(false)} />
        </>
      ) : (
        <>
          <ErrorText message={action.error ? errorMessage(action.error) : null} />
          <Button
            label={t.seller.accept}
            onPress={() => action.mutate({ kind: 'accept' })}
            loading={action.isPending}
            testID="seller-accept"
          />
          <Button label={t.seller.reject} variant="ghost" onPress={() => setRejecting(true)} />
        </>
      )
    ) : o.status === 'preparing' ? (
      <>
        <Text style={styles.hint}>{t.seller.readyHint}</Text>
        <ErrorText message={action.error ? errorMessage(action.error) : null} />
        <Button
          label={t.seller.ready}
          variant="trust"
          onPress={() => action.mutate({ kind: 'ready' })}
          loading={action.isPending}
          testID="seller-ready"
        />
      </>
    ) : undefined;

  return (
    <Screen footer={footer}>
      <Stack.Screen options={{ title: o.publicRef }} />
      <View style={styles.header}>
        <Text
          style={[styles.status, { color: statusColor(o.status) }]}
          testID="seller-order-status"
        >
          {t.sellerStatus[o.status]}
        </Text>
        <Text style={styles.ref}>{o.publicRef}</Text>
        <Text style={styles.muted}>{formatDateTime(o.createdAt)}</Text>
      </View>

      {o.status === 'paid' && o.sellerAcceptDeadline ? (
        <Banner message={t.seller.acceptBefore(formatDateTime(o.sellerAcceptDeadline))} />
      ) : null}
      {o.status === 'ready_for_pickup' ? (
        <Banner message={t.seller.waitingRider} tone="trust" />
      ) : null}

      <Section>
        {o.items.map((item) => (
          <View key={item.itemId} style={styles.row}>
            <Text style={styles.itemTitle} numberOfLines={2}>
              {item.quantity} × {item.title}
            </Text>
            <Text style={styles.value}>{formatXaf(item.lineTotal)}</Text>
          </View>
        ))}
        <View style={styles.row}>
          <Text style={styles.muted}>{t.seller.commission(`${rate} %`)}</Text>
          <Text style={styles.muted}>− {formatXaf(o.commission)}</Text>
        </View>
        <View style={[styles.row, styles.netRow]}>
          <Text style={styles.netLabel}>{t.seller.youReceive}</Text>
          <Text style={styles.net} testID="seller-net">
            {formatXaf(o.sellerNet)}
          </Text>
        </View>
      </Section>

      <Section title={t.seller.destination}>
        <Text style={styles.body}>
          {o.destination.pickupPoint
            ? t.seller.pickupPointValue(o.destination.pickupPoint)
            : t.seller.destinationValue(o.destination.zone, o.destination.city)}
        </Text>
        <Text style={styles.muted}>{t.seller.courierNote}</Text>
      </Section>

      <Section title={t.orders.history}>
        <Timeline history={o.history} />
      </Section>
    </Screen>
  );
}

/** Une commande côté vendeur : accepter ou refuser, préparer, suivre ; et ce qu'il recevra. */
export default function SellerOrderScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return (
    <RequireRole role="seller">
      <SellerOrder id={id} />
    </RequireRole>
  );
}

const styles = StyleSheet.create({
  header: { gap: 4 },
  status: { fontSize: font.headline, fontWeight: '800' },
  ref: { fontSize: font.title, fontWeight: '900', color: colors.text, letterSpacing: 1 },
  muted: { color: colors.muted, fontSize: font.small, lineHeight: 19 },
  hint: { color: colors.muted, fontSize: font.small, lineHeight: 19, textAlign: 'center' },
  label: { fontSize: font.small, fontWeight: '700', color: colors.text },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: space.md },
  itemTitle: { flex: 1, color: colors.text, fontSize: font.body },
  value: { color: colors.text, fontWeight: '700' },
  netRow: {
    backgroundColor: colors.trustSoft,
    borderRadius: radius.md,
    padding: space.sm,
    alignItems: 'center',
  },
  netLabel: { color: colors.trust, fontWeight: '800', fontSize: font.body },
  net: { color: colors.trust, fontWeight: '900', fontSize: font.title },
  body: { color: colors.text, fontSize: font.body },
});
