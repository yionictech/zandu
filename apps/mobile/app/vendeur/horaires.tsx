import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { api, errorMessage, unwrap } from '../../src/api';
import { t } from '../../src/i18n/fr';
import { sellerKeys, useShop } from '../../src/seller/queries';
import { Toggle } from '../../src/seller/ui';
import { colors, font, space } from '../../src/theme';
import { Button } from '../../src/ui/Button';
import { ErrorText, Field } from '../../src/ui/Form';
import { Card } from '../../src/ui/kit';
import { Failure, Loading, Screen } from '../../src/ui/Layout';
import { RequireRole } from '../../src/ui/RequireRole';
import { Text } from '../../src/ui/Text';

type Day = { open: string; close: string } | null;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const DEFAULT_WEEK: Day[] = Array.from({ length: 7 }, (_, i) =>
  i < 6 ? { open: '08:00', close: '18:00' } : null,
);
const dayValid = (d: Day) => !d || (TIME.test(d.open) && TIME.test(d.close) && d.open < d.close);

function Hours() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const shop = useShop();
  const [week, setWeek] = useState<Day[] | null>(null);
  useEffect(() => {
    if (shop.data && week === null) setWeek(shop.data.weeklyHours ?? DEFAULT_WEEK);
  }, [shop.data, week]);
  const save = useMutation({
    mutationFn: async (weeklyHours: Day[]) =>
      unwrap(await api.PATCH('/v1/seller/shop', { body: { weeklyHours } })),
    onSuccess: (updated) => {
      queryClient.setQueryData(sellerKeys.shop, updated);
      router.back();
    },
  });

  if (shop.isPending || week === null) return <Loading />;
  if (shop.isError)
    return <Failure message={errorMessage(shop.error)} onRetry={() => void shop.refetch()} />;
  const set = (i: number, day: Day) => setWeek(week.map((d, j) => (j === i ? day : d)));
  const invalid = week.findIndex((d) => !dayValid(d));
  const first = week.find(Boolean);

  return (
    <Screen
      footer={
        <>
          <ErrorText
            message={
              invalid >= 0
                ? t.vendor.hoursInvalid(t.vendor.weekDays[invalid]!)
                : save.error
                  ? errorMessage(save.error)
                  : null
            }
          />
          <Button
            label={t.vendor.saveHours}
            onPress={() => save.mutate(week)}
            disabled={invalid >= 0}
            loading={save.isPending}
            testID="hours-save"
          />
        </>
      }
    >
      <Text style={styles.muted}>{t.vendor.hoursIntro}</Text>
      {week.map((day, i) => (
        <Card key={t.vendor.weekDays[i]} style={styles.day}>
          <View style={styles.row}>
            <Text style={styles.dayName}>{t.vendor.weekDays[i]}</Text>
            <Text style={styles.muted}>{day ? '' : t.vendor.closedDay}</Text>
            <Toggle
              value={!!day}
              onChange={(on) => set(i, on ? (first ?? { open: '08:00', close: '18:00' }) : null)}
              label={t.vendor.weekDays[i]!}
              testID={`hours-day-${i}`}
            />
          </View>
          {day ? (
            <View style={styles.row}>
              <View style={styles.flex}>
                <Field
                  label={t.vendor.opens}
                  value={day.open}
                  onChangeText={(open) => set(i, { ...day, open })}
                  keyboardType="numbers-and-punctuation"
                  maxLength={5}
                  testID={`hours-open-${i}`}
                />
              </View>
              <View style={styles.flex}>
                <Field
                  label={t.vendor.closes}
                  value={day.close}
                  onChangeText={(close) => set(i, { ...day, close })}
                  keyboardType="numbers-and-punctuation"
                  maxLength={5}
                  testID={`hours-close-${i}`}
                />
              </View>
            </View>
          ) : null}
        </Card>
      ))}
      {first ? (
        <Button
          label={t.vendor.sameForAll}
          variant="ghost"
          onPress={() => setWeek(week.map((d) => (d ? { ...first } : null)))}
        />
      ) : null}
    </Screen>
  );
}

/** Heures d'ouverture jour par jour (docs/ux/03 §13). */
export default function HoursScreen() {
  return (
    <RequireRole role="seller">
      <Hours />
    </RequireRole>
  );
}

const styles = StyleSheet.create({
  muted: { fontSize: font.small, color: colors.muted, lineHeight: 19 },
  day: { gap: space.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  dayName: { flex: 1, fontSize: font.body, fontWeight: '700', color: colors.text },
  flex: { flex: 1 },
});
