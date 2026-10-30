import type { RiderMission } from '@zandu/api-client';
import { useQuery } from '@tanstack/react-query';
import { Phone } from 'lucide-react-native';
import { Linking, Pressable, StyleSheet, View } from 'react-native';
import { api, unwrap } from '../api';
import { t } from '../i18n/fr';
import { colors, fonts, radius, space } from '../theme';
import { Avatar, Card, Eyebrow } from '../ui/kit';
import { Text } from '../ui/Text';

/**
 * Pièces des écrans livreur (maquette « Livreur ») : barre des 4 étapes d'une course, code à
 * montrer en grandes cases, carte d'une personne avec le bouton d'appel.
 */

export const riderKeys = {
  me: ['rider', 'me'] as const,
  missions: ['rider', 'missions'] as const,
  mission: (id: string) => ['rider', 'mission', id] as const,
  history: (period: '7d' | '30d') => ['rider', 'history', period] as const,
};

export function useRiderMe() {
  return useQuery({
    queryKey: riderKeys.me,
    queryFn: async () => unwrap(await api.GET('/v1/rider/me')),
  });
}

/** Prénom du client pour lui parler (« Demandez le code à Grâce »). */
export const firstName = (full: string | null | undefined): string =>
  full?.trim().split(/\s+/)[0] ?? '';

/** Étape d'une course : 0 Récupérer, 1 En route, 2 Remise, 3 Terminé. */
export function missionStep(m: RiderMission): number {
  if (m.status === 'assigned') return 0;
  if (m.status === 'picked_up') return m.arrivedAt ? 2 : 1;
  if (m.status === 'at_pickup_point' || m.status === 'returning') return 2;
  return 3;
}

/** Barre des 4 étapes sous le titre d'une course. */
export function RiderSteps({ step }: { step: number }) {
  return (
    <View style={styles.steps}>
      {t.rider.steps.map((label, i) => (
        <View key={label} style={styles.step}>
          <View style={[styles.stepBar, i <= step && styles.stepBarOn]} />
          <Text style={[styles.stepLabel, i <= step && styles.stepLabelOn]} numberOfLines={1}>
            {label}
          </Text>
        </View>
      ))}
    </View>
  );
}

/** Code à montrer (retrait, retour) : 4 grandes cases citron, lisibles à bout de bras. */
export function ShowCode({
  title,
  code,
  hint,
  testID,
}: {
  title: string;
  code: string;
  hint: string;
  testID?: string;
}) {
  return (
    <Card highlight style={styles.codeCard}>
      <Eyebrow color={colors.brand}>{title}</Eyebrow>
      <View
        style={styles.codeRow}
        accessibilityLabel={`${title} : ${code.split('').join(' ')}`}
        testID={testID}
      >
        {code.split('').map((digit, i) => (
          <View key={i} style={styles.codeBox}>
            <Text style={styles.codeDigit}>{digit}</Text>
          </View>
        ))}
      </View>
      <Text style={styles.codeHint}>{hint}</Text>
    </Card>
  );
}

/** Boutique ou client : initiales, nom, ligne d'adresse, bouton d'appel rond. */
export function PersonCard({
  name,
  line,
  phone,
  onCall,
  appCall,
}: {
  name: string;
  line: string;
  phone: string;
  /** Appelé avant d'ouvrir le téléphone (noter une tentative de contact). */
  onCall?: () => void;
  /** Appel internet dans l'application ; l'appel téléphonique normal reste en secours. */
  appCall?: () => void;
}) {
  return (
    <Card style={styles.person}>
      <Avatar name={name} size={44} />
      <View style={styles.flex}>
        <Text style={styles.personName} numberOfLines={1}>
          {name}
        </Text>
        <Text style={styles.muted} numberOfLines={2}>
          {line}
        </Text>
        {appCall ? (
          <Pressable
            onPress={() => {
              onCall?.();
              void Linking.openURL(`tel:${phone}`);
            }}
            hitSlop={8}
            accessibilityRole="button"
            testID="person-normal-call"
          >
            <Text style={styles.normalCall}>{t.calls.normalCall}</Text>
          </Pressable>
        ) : null}
      </View>
      <Pressable
        onPress={() => {
          onCall?.();
          if (appCall) appCall();
          else void Linking.openURL(`tel:${phone}`);
        }}
        accessibilityRole="button"
        accessibilityLabel={`${t.rider.call} ${name}`}
        style={({ pressed }) => [styles.call, pressed && styles.callPressed]}
      >
        <Phone color={colors.onBrand} size={20} strokeWidth={2} />
      </Pressable>
    </Card>
  );
}

const styles = StyleSheet.create({
  steps: { flexDirection: 'row', gap: 6 },
  step: { flex: 1, gap: 6 },
  stepBar: { height: 4, borderRadius: 2, backgroundColor: colors.surfaceRaised },
  stepBarOn: { backgroundColor: colors.brand },
  stepLabel: { fontSize: 11, color: colors.faint },
  stepLabelOn: { color: colors.text, fontWeight: '700' },
  codeCard: { alignItems: 'center', gap: space.md, backgroundColor: colors.brandSoft },
  codeRow: { flexDirection: 'row', gap: space.sm },
  codeBox: {
    width: 58,
    height: 68,
    borderRadius: radius.md,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.brandBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  codeDigit: { fontFamily: fonts.displayHeavy, fontSize: 32, color: colors.brand },
  codeHint: { fontSize: 13, color: colors.muted, textAlign: 'center', lineHeight: 18 },
  person: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  personName: { fontSize: 16, fontWeight: '700', color: colors.text },
  muted: { fontSize: 13, color: colors.muted, lineHeight: 18 },
  flex: { flex: 1, gap: 2 },
  call: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.brand,
    alignItems: 'center',
    justifyContent: 'center',
  },
  callPressed: { backgroundColor: colors.brandPressed },
  normalCall: { fontSize: 13, color: colors.brand, fontWeight: '700', marginTop: 2 },
});
