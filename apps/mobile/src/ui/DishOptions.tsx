import type { components } from '@zandu/api-client';
import { StyleSheet, View } from 'react-native';
import { formatXaf } from '../format';
import { t } from '../i18n/fr';
import { colors, font, space } from '../theme';
import { Chip } from './Form';
import { Text } from './Text';

type Groups = components['schemas']['DishOptions'];

/** Choix d'un plat : une proposition par groupe (« Taille », « Accompagnement »), supplément affiché. */
export function DishOptionsPicker({
  groups,
  value,
  onChange,
}: {
  groups: Groups;
  value: Array<string | null>;
  onChange: (value: Array<string | null>) => void;
}) {
  return (
    <View style={styles.box} testID="dish-options">
      {groups.map((g, i) => (
        <View key={g.name} style={styles.group}>
          <Text style={styles.name}>
            {g.name}
            {value[i] ? '' : ` · ${t.food.required}`}
          </Text>
          <View style={styles.wrap}>
            {g.choices.map((c) => (
              <Chip
                key={c.label}
                label={c.extra ? `${c.label} +${formatXaf(c.extra)}` : c.label}
                selected={value[i] === c.label}
                onPress={() =>
                  onChange(groups.map((_, j) => (j === i ? c.label : (value[j] ?? null))))
                }
                testID={`dish-option-${i}-${c.label}`}
              />
            ))}
          </View>
        </View>
      ))}
    </View>
  );
}

/** Supplément total et liste des choix, ou null s'il en manque un. */
export function chosenOptions(
  groups: Groups,
  value: Array<string | null>,
): { options: string[]; extra: number } | null {
  if (groups.some((_, i) => !value[i])) return null;
  const options = groups.map((_, i) => value[i]!);
  const extra = groups.reduce(
    (n, g, i) => n + (g.choices.find((c) => c.label === options[i])?.extra ?? 0),
    0,
  );
  return { options, extra };
}

const styles = StyleSheet.create({
  box: { gap: space.md },
  group: { gap: space.sm },
  name: { color: colors.text, fontWeight: '700', fontSize: font.body },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
});
