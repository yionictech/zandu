import { useMutation } from '@tanstack/react-query';
import { Ticket, X } from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { api, errorMessage, unwrap } from '../api';
import { t } from '../i18n/fr';
import { colors, font, radius, space } from '../theme';
import { Button } from './Button';
import { ErrorText } from './Form';
import { Text, TextInput } from './Text';

export interface AppliedCoupon {
  code: string;
  percent: number;
  shopName: string;
  sellerId: string;
}

/**
 * Code promo d'une boutique : vérifié avant de payer (boutique, remise, minimum). Le montant
 * exact est calculé par le serveur à la création de la commande.
 */
export function CouponField({
  value,
  onChange,
  sellerIds,
}: {
  value: AppliedCoupon | null;
  onChange: (coupon: AppliedCoupon | null) => void;
  /** Boutiques du panier : un code d'une autre boutique est refusé tout de suite. */
  sellerIds: string[];
}) {
  const [code, setCode] = useState('');
  const check = useMutation({
    mutationFn: async () => {
      const found = unwrap(
        await api.GET('/v1/coupons/{code}', { params: { path: { code: code.trim() } } }),
      );
      if (!sellerIds.includes(found.sellerId)) throw new Error(t.promo.notInCart(found.shopName));
      return found;
    },
    onSuccess: (found) =>
      onChange({
        code: found.code,
        percent: found.percent,
        shopName: found.shopName,
        sellerId: found.sellerId,
      }),
  });

  if (value)
    return (
      <View style={styles.applied} testID="coupon-applied">
        <Ticket color={colors.brand} size={18} strokeWidth={2} />
        <Text style={styles.appliedText}>
          {value.code} · {t.promo.applied(value.percent, value.shopName)}
        </Text>
        <Pressable
          onPress={() => onChange(null)}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={t.promo.remove}
        >
          <X color={colors.muted} size={18} />
        </Pressable>
      </View>
    );
  return (
    <View style={styles.box}>
      <Text style={styles.label}>{t.promo.couponField}</Text>
      <View style={styles.row}>
        <TextInput
          value={code}
          onChangeText={(v) => setCode(v.replace(/\s/g, '').toUpperCase())}
          autoCapitalize="characters"
          maxLength={20}
          placeholder="GRACE10"
          placeholderTextColor={colors.faint}
          style={styles.input}
          accessibilityLabel={t.promo.couponField}
          testID="checkout-coupon"
        />
        <Button
          label={t.promo.apply}
          variant="secondary"
          onPress={() => check.mutate()}
          disabled={code.trim().length < 3}
          loading={check.isPending}
          testID="checkout-coupon-apply"
        />
      </View>
      <ErrorText message={check.error ? errorMessage(check.error) : null} />
    </View>
  );
}

const styles = StyleSheet.create({
  box: { gap: space.sm },
  label: { color: colors.muted, fontSize: font.small },
  row: { flexDirection: 'row', gap: space.sm, alignItems: 'center' },
  input: {
    flex: 1,
    minHeight: 48,
    color: colors.text,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: space.md,
    fontSize: font.body,
    letterSpacing: 1,
  },
  applied: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    backgroundColor: colors.brandSoft,
    borderColor: colors.brandBorder,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: space.md,
  },
  appliedText: { flex: 1, color: colors.brand, fontWeight: '700', fontSize: font.small },
});
