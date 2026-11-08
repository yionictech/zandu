import type { components } from '@zandu/api-client';
import { useMutation } from '@tanstack/react-query';
import { UtensilsCrossed } from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { api, errorMessage, unwrap } from '../api';
import { t } from '../i18n/fr';
import { colors, font, space } from '../theme';
import { Button } from '../ui/Button';
import { ErrorText, Field } from '../ui/Form';
import { Card } from '../ui/kit';
import { Text } from '../ui/Text';

type Groups = components['schemas']['DishOptions'];
interface Draft {
  name: string;
  choices: Array<{ label: string; extra: string }>;
}

const toDraft = (groups: Groups | null): Draft[] =>
  (groups ?? []).map((g) => ({
    name: g.name,
    choices: g.choices.map((c) => ({ label: c.label, extra: c.extra ? String(c.extra) : '' })),
  }));
const emptyGroup = (): Draft => ({
  name: '',
  choices: [
    { label: '', extra: '' },
    { label: '', extra: '' },
  ],
});

/**
 * Choix du client pour un plat (restaurants) : jusqu'à 3 groupes (« Taille », « Accompagnement »),
 * chacun avec ses propositions et leur supplément. Le serveur vérifie le tout.
 */
export function DishOptionsCard({
  productId,
  options,
  onSaved,
}: {
  productId: string;
  options: Groups | null;
  onSaved: () => void;
}) {
  const [groups, setGroups] = useState<Draft[]>(() => toDraft(options));
  const save = useMutation({
    mutationFn: async () =>
      unwrap(
        await api.PATCH('/v1/seller/products/{id}', {
          params: { path: { id: productId } },
          body: {
            options: groups.map((g) => ({
              name: g.name,
              choices: g.choices
                .filter((c) => c.label.trim())
                .map((c) => ({ label: c.label, extra: Number(c.extra.replace(/\D/g, '') || 0) })),
            })),
          },
        }),
      ),
    onSuccess: onSaved,
  });
  const setGroup = (i: number, patch: Partial<Draft>) =>
    setGroups((list) => list.map((g, j) => (j === i ? { ...g, ...patch } : g)));
  return (
    <Card testID="dish-options-card">
      <View style={styles.head}>
        <UtensilsCrossed color={colors.brand} size={20} />
        <Text style={styles.title}>{t.food.optionsTitle}</Text>
      </View>
      <Text style={styles.muted}>{t.food.optionsHint}</Text>
      {groups.map((g, i) => (
        <View key={i} style={styles.group}>
          <Field
            label={t.food.groupName}
            value={g.name}
            onChangeText={(name) => setGroup(i, { name })}
            maxLength={40}
            testID={`dish-group-${i}`}
          />
          {g.choices.map((c, k) => (
            <View key={k} style={styles.choice}>
              <View style={styles.label}>
                <Field
                  label={t.food.choiceLabel}
                  value={c.label}
                  onChangeText={(label) =>
                    setGroup(i, {
                      choices: g.choices.map((x, m) => (m === k ? { ...x, label } : x)),
                    })
                  }
                  maxLength={40}
                  testID={`dish-choice-${i}-${k}`}
                />
              </View>
              <View style={styles.extra}>
                <Field
                  label={t.food.extra}
                  value={c.extra}
                  onChangeText={(extra) =>
                    setGroup(i, {
                      choices: g.choices.map((x, m) => (m === k ? { ...x, extra } : x)),
                    })
                  }
                  keyboardType="number-pad"
                  placeholder="0"
                />
              </View>
            </View>
          ))}
          <View style={styles.links}>
            {g.choices.length < 8 ? (
              <Pressable
                onPress={() => setGroup(i, { choices: [...g.choices, { label: '', extra: '' }] })}
                hitSlop={8}
              >
                <Text style={styles.link}>{t.food.addChoice}</Text>
              </Pressable>
            ) : null}
            <Pressable
              onPress={() => setGroups((list) => list.filter((_, j) => j !== i))}
              hitSlop={8}
            >
              <Text style={styles.remove}>{t.food.removeGroup}</Text>
            </Pressable>
          </View>
        </View>
      ))}
      {groups.length < 3 ? (
        <Button
          label={t.food.addGroup}
          variant="ghost"
          onPress={() => setGroups((list) => [...list, emptyGroup()])}
          testID="dish-add-group"
        />
      ) : null}
      <ErrorText message={save.error ? errorMessage(save.error) : null} />
      <Button
        label={t.food.saveOptions}
        variant="secondary"
        onPress={() => save.mutate()}
        loading={save.isPending}
        testID="dish-options-save"
      />
    </Card>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  title: { color: colors.text, fontWeight: '800', fontSize: font.body },
  muted: { color: colors.muted, fontSize: font.small, lineHeight: 19 },
  group: {
    gap: space.sm,
    paddingTop: space.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  choice: { flexDirection: 'row', gap: space.sm },
  label: { flex: 2 },
  extra: { flex: 1 },
  links: { flexDirection: 'row', justifyContent: 'space-between' },
  link: { color: colors.brand, fontWeight: '700', fontSize: font.small },
  remove: { color: colors.danger, fontWeight: '700', fontSize: font.small },
});
