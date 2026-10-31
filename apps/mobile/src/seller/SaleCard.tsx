import { useMutation } from '@tanstack/react-query';
import { BadgePercent } from 'lucide-react-native';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { api, errorMessage, unwrap } from '../api';
import { formatXaf } from '../format';
import { t } from '../i18n/fr';
import { colors, font, space } from '../theme';
import { Button } from '../ui/Button';
import { Chip, ErrorText } from '../ui/Form';
import { Card } from '../ui/kit';
import { Text } from '../ui/Text';

const PERCENTS = [10, 20, 30, 50] as const;
const DURATIONS = [
  { key: '3d', days: 3 },
  { key: '7d', days: 7 },
  { key: 'none', days: null },
] as const;

const dateTime = new Intl.DateTimeFormat('fr-FR', {
  day: 'numeric',
  month: 'long',
  hour: '2-digit',
  minute: '2-digit',
});

/**
 * Promotion d'un produit : prix barré pour les acheteurs, ancien prix rétabli tout seul à la
 * fin. La remise est payée par la boutique (la commission porte sur le prix soldé).
 */
export function SaleCard({
  productId,
  price,
  compareAtPrice,
  saleEndsAt,
  onChange,
}: {
  productId: string;
  price: number;
  compareAtPrice: number | null;
  saleEndsAt: string | null;
  onChange: () => void;
}) {
  const [percent, setPercent] = useState<number>(20);
  const [duration, setDuration] = useState<(typeof DURATIONS)[number]['key']>('7d');
  const original = compareAtPrice ?? price;
  const preview = Math.max(50, Math.round((original * (100 - percent)) / 100 / 50) * 50);
  const start = useMutation({
    mutationFn: async () => {
      const days = DURATIONS.find((d) => d.key === duration)!.days;
      return unwrap(
        await api.POST('/v1/seller/products/{id}/sale', {
          params: { path: { id: productId } },
          body: {
            percent,
            ...(days ? { endsAt: new Date(Date.now() + days * 86_400_000).toISOString() } : {}),
          },
        }),
      );
    },
    onSuccess: onChange,
  });
  const stop = useMutation({
    mutationFn: async () => {
      await api.DELETE('/v1/seller/products/{id}/sale', { params: { path: { id: productId } } });
    },
    onSuccess: onChange,
  });

  return (
    <Card testID="product-sale-card">
      <View style={styles.head}>
        <BadgePercent color={colors.brand} size={20} strokeWidth={2} />
        <Text style={styles.title}>{t.promo.saleTitle}</Text>
      </View>
      {compareAtPrice ? (
        <>
          <Text style={styles.body} testID="product-on-sale">
            {t.promo.onSale(
              formatXaf(price),
              formatXaf(compareAtPrice),
              Math.round((1 - price / compareAtPrice) * 100),
            )}
          </Text>
          <Text style={styles.muted}>
            {saleEndsAt ? t.promo.until(dateTime.format(new Date(saleEndsAt))) : t.promo.noEnd}
          </Text>
          <Button
            label={t.promo.stop}
            variant="secondary"
            onPress={() => stop.mutate()}
            loading={stop.isPending}
          />
        </>
      ) : (
        <Text style={styles.muted}>{t.promo.saleHint}</Text>
      )}
      <View style={styles.row}>
        {PERCENTS.map((p) => (
          <Chip
            key={p}
            label={`−${p} %`}
            selected={percent === p}
            onPress={() => setPercent(p)}
            testID={`sale-${p}`}
          />
        ))}
      </View>
      <View style={styles.row}>
        {DURATIONS.map((d) => (
          <Chip
            key={d.key}
            label={t.promo.durations[d.key]}
            selected={duration === d.key}
            onPress={() => setDuration(d.key)}
          />
        ))}
      </View>
      <Text style={styles.body}>{t.promo.preview(formatXaf(preview), formatXaf(original))}</Text>
      <ErrorText
        message={
          start.error ? errorMessage(start.error) : stop.error ? errorMessage(stop.error) : null
        }
      />
      <Button
        label={compareAtPrice ? t.promo.change : t.promo.start}
        onPress={() => start.mutate()}
        loading={start.isPending}
        testID="sale-start"
      />
    </Card>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  title: { color: colors.text, fontWeight: '800', fontSize: font.body },
  body: { color: colors.text, fontSize: font.small, lineHeight: 20 },
  muted: { color: colors.muted, fontSize: font.small, lineHeight: 19 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
});
