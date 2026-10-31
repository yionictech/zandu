import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { api, errorMessage, unwrap } from '../../src/api';
import { formatXaf } from '../../src/format';
import { t } from '../../src/i18n/fr';
import { colors, font, space } from '../../src/theme';
import { Button } from '../../src/ui/Button';
import { Chip, ErrorText, Field } from '../../src/ui/Form';
import { Card } from '../../src/ui/kit';
import { Failure, Loading, Screen } from '../../src/ui/Layout';
import { RequireRole } from '../../src/ui/RequireRole';
import { Text } from '../../src/ui/Text';

const PERCENTS = [5, 10, 15, 20] as const;

/** Codes promo de la boutique : à partager aux clients (WhatsApp, affiche), remise à la charge du vendeur. */
export default function CouponsScreen() {
  return (
    <RequireRole role="seller">
      <Coupons />
    </RequireRole>
  );
}

function Coupons() {
  const queryClient = useQueryClient();
  const [code, setCode] = useState('');
  const [percent, setPercent] = useState<number>(10);
  const [minSubtotal, setMinSubtotal] = useState('');
  const [maxUses, setMaxUses] = useState('');
  const list = useQuery({
    queryKey: ['seller', 'coupons'],
    queryFn: async () => unwrap(await api.GET('/v1/seller/coupons')),
  });
  const create = useMutation({
    mutationFn: async () =>
      unwrap(
        await api.POST('/v1/seller/coupons', {
          body: {
            code: code.trim().toUpperCase(),
            percent,
            ...(Number(minSubtotal) > 0 ? { minSubtotal: Number(minSubtotal) } : {}),
            ...(Number(maxUses) > 0 ? { maxUses: Number(maxUses) } : {}),
          },
        }),
      ),
    onSuccess: () => {
      setCode('');
      setMinSubtotal('');
      setMaxUses('');
      void queryClient.invalidateQueries({ queryKey: ['seller', 'coupons'] });
    },
  });
  const disable = useMutation({
    mutationFn: async (id: string) => {
      await api.POST('/v1/seller/coupons/{id}/disable', { params: { path: { id } } });
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['seller', 'coupons'] }),
  });

  if (list.isPending) return <Loading />;
  if (list.isError)
    return <Failure message={errorMessage(list.error)} onRetry={() => void list.refetch()} />;
  const validCode = /^[A-Za-z0-9]{3,20}$/.test(code.trim());

  return (
    <Screen>
      <Card>
        <Text style={styles.title}>{t.promo.couponsTitle}</Text>
        <Text style={styles.muted}>{t.promo.couponsHint}</Text>
        <Field
          label={t.promo.code}
          value={code}
          onChangeText={(v) => setCode(v.replace(/\s/g, '').toUpperCase())}
          autoCapitalize="characters"
          maxLength={20}
          placeholder="GRACE10"
          testID="coupon-code"
        />
        <Text style={styles.label}>{t.promo.percent}</Text>
        <View style={styles.row}>
          {PERCENTS.map((p) => (
            <Chip
              key={p}
              label={`−${p} %`}
              selected={percent === p}
              onPress={() => setPercent(p)}
            />
          ))}
        </View>
        <Field
          label={t.promo.minSubtotal}
          value={minSubtotal}
          onChangeText={(v) => setMinSubtotal(v.replace(/\D/g, ''))}
          keyboardType="number-pad"
        />
        <Field
          label={t.promo.maxUses}
          value={maxUses}
          onChangeText={(v) => setMaxUses(v.replace(/\D/g, ''))}
          keyboardType="number-pad"
        />
        <Text style={styles.muted}>{t.promo.paidBy}</Text>
        <ErrorText message={create.error ? errorMessage(create.error) : null} />
        <Button
          label={t.promo.create}
          onPress={() => create.mutate()}
          disabled={!validCode}
          loading={create.isPending}
          testID="coupon-create"
        />
      </Card>

      {list.data.items.length === 0 ? <Text style={styles.muted}>{t.promo.none}</Text> : null}
      {list.data.items.map((c) => (
        <Card key={c.id} testID="coupon-item">
          <View style={styles.between}>
            <Text style={styles.code}>{c.code}</Text>
            <Text style={[styles.state, !c.active && styles.off]}>
              {c.active ? t.promo.active : t.promo.inactive}
            </Text>
          </View>
          <Text style={styles.body}>
            −{c.percent} %{c.minSubtotal > 0 ? ` · dès ${formatXaf(c.minSubtotal)}` : ''}
            {c.maxUses ? ` · ${c.maxUses} max.` : ''}
          </Text>
          <Text style={styles.muted}>{t.promo.usage(c.uses, formatXaf(c.discountGiven))}</Text>
          {c.active ? (
            <Button
              label={t.promo.disable}
              variant="ghost"
              onPress={() => disable.mutate(c.id)}
              loading={disable.isPending && disable.variables === c.id}
            />
          ) : null}
        </Card>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { color: colors.text, fontWeight: '800', fontSize: font.body },
  label: { color: colors.muted, fontSize: font.small },
  muted: { color: colors.muted, fontSize: font.small, lineHeight: 19 },
  body: { color: colors.text, fontSize: font.small },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  between: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  code: { color: colors.brand, fontWeight: '800', fontSize: 18, letterSpacing: 1 },
  state: { color: colors.trust, fontSize: font.small, fontWeight: '700' },
  off: { color: colors.faint },
});
