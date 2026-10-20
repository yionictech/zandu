import type { ProductCondition } from '@zandu/api-client';
import { useQuery } from '@tanstack/react-query';
import { StyleSheet, View } from 'react-native';
import { Text } from '../ui/Text';
import { api, unwrap } from '../api';
import { formatRate, formatXaf, groupThousands } from '../format';
import { t } from '../i18n/fr';
import { colors, font, radius, space } from '../theme';
import { useDebounced } from '../useDebounced';
import { Chip, Field } from '../ui/Form';
import { Stepper } from '../ui/Stepper';
import { useLeafCategories } from './queries';

export interface ProductFormValues {
  title: string;
  /** Chiffres seulement : « 50000 ». */
  price: string;
  stock: number;
  categoryId: string | null;
  description: string;
  /** Absents des brouillons enregistrés avant l'étape 3 : valeurs par défaut de l'API. */
  condition?: ProductCondition;
  lowStockThreshold?: number;
}

export const emptyProductForm: ProductFormValues = {
  title: '',
  price: '',
  stock: 1,
  categoryId: null,
  description: '',
  condition: 'new',
  lowStockThreshold: 2,
};

const CONDITIONS: ProductCondition[] = ['new', 'refurbished', 'used'];

export const isProductFormValid = (v: ProductFormValues): boolean =>
  v.title.trim().length >= 3 && Number(v.price) > 0 && !!v.categoryId;

/** Transparence : « Vous recevrez 45 000 FCFA », recalculé par l'API pendant la saisie. */
function Earnings({ categoryId, price }: { categoryId: string | null; price: string }) {
  const debouncedPrice = useDebounced(price);
  const amount = Number(debouncedPrice);
  const preview = useQuery({
    queryKey: ['commission-preview', categoryId, amount],
    queryFn: async () =>
      unwrap(
        await api.GET('/v1/seller/commission-preview', {
          params: { query: { categoryId: categoryId!, price: amount } },
        }),
      ),
    enabled: !!categoryId && amount > 0,
    staleTime: 300_000,
  });
  if (!preview.data || !categoryId || amount <= 0) return null;
  return (
    <View style={styles.earnings} testID="earnings">
      <View style={styles.row}>
        <Text style={styles.earnLabel}>{t.seller.youReceive}</Text>
        <Text style={styles.earnAmount}>{formatXaf(preview.data.net)}</Text>
      </View>
      <Text style={styles.muted}>
        {t.seller.commission(formatRate(preview.data.rateBps))} :{' '}
        {formatXaf(preview.data.commission)}
      </Text>
    </View>
  );
}

/** Nom, catégorie, prix (pavé numérique, séparateur automatique) et gain net, stock, description. */
export function ProductForm({
  values,
  onChange,
}: {
  values: ProductFormValues;
  onChange: (patch: Partial<ProductFormValues>) => void;
}) {
  const categories = useLeafCategories();
  return (
    <View style={styles.form}>
      <Field
        label={t.seller.title}
        value={values.title}
        onChangeText={(title) => onChange({ title })}
        placeholder={t.seller.titlePlaceholder}
        maxLength={140}
        testID="product-title"
      />
      <Text style={styles.label}>{t.seller.category}</Text>
      <View style={styles.wrap}>
        {(categories.data ?? []).map((c) => (
          <Chip
            key={c.id}
            label={c.name}
            selected={values.categoryId === c.id}
            onPress={() => onChange({ categoryId: c.id })}
            testID={`product-category-${c.slug}`}
          />
        ))}
      </View>
      <Text style={styles.label}>{t.vendor.condition}</Text>
      <View style={styles.wrap}>
        {CONDITIONS.map((c) => (
          <Chip
            key={c}
            label={t.vendor.conditions[c]}
            selected={(values.condition ?? 'new') === c}
            onPress={() => onChange({ condition: c })}
            testID={`product-condition-${c}`}
          />
        ))}
      </View>
      <Field
        label={t.seller.price}
        value={groupThousands(values.price)}
        onChangeText={(text) => onChange({ price: text.replace(/\D/g, '').slice(0, 9) })}
        keyboardType="number-pad"
        placeholder="50 000"
        testID="product-price"
      />
      <Earnings categoryId={values.categoryId} price={values.price} />
      <Stepper
        label={t.seller.stock}
        value={values.stock}
        onChange={(stock) => onChange({ stock })}
        hint={t.vendor.stockAlert(values.lowStockThreshold ?? 2)}
      />
      <Stepper
        label={t.vendor.alertThreshold}
        value={values.lowStockThreshold ?? 2}
        onChange={(lowStockThreshold) => onChange({ lowStockThreshold })}
        max={1000}
        hint={t.vendor.lowStock}
      />
      <Field
        label={t.seller.description}
        value={values.description}
        onChangeText={(description) => onChange({ description })}
        placeholder={t.seller.descriptionPlaceholder}
        multiline
        maxLength={5000}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  form: { gap: space.md },
  label: { fontSize: font.small, fontWeight: '600', color: colors.text },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  earnings: {
    backgroundColor: colors.trustSoft,
    borderRadius: radius.md,
    padding: space.md,
    gap: 4,
  },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  earnLabel: { color: colors.trust, fontWeight: '800', fontSize: font.body },
  earnAmount: { color: colors.trust, fontWeight: '900', fontSize: font.title },
  muted: { color: colors.muted, fontSize: font.small },
});
