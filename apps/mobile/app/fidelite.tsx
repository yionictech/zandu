import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Redirect } from 'expo-router';
import { Gift, Share2, Users } from 'lucide-react-native';
import { useState } from 'react';
import { Share, StyleSheet, View } from 'react-native';
import { api, errorMessage, unwrap } from '../src/api';
import { formatDateTime, groupThousands } from '../src/format';
import { t } from '../src/i18n/fr';
import { SITE_URL } from '../src/config';
import { useSession } from '../src/session';
import { colors, font, radius, space } from '../src/theme';
import { Button } from '../src/ui/Button';
import { ErrorText, Field } from '../src/ui/Form';
import { Card, Eyebrow, Note } from '../src/ui/kit';
import { Failure, Loading, Screen } from '../src/ui/Layout';
import { Text } from '../src/ui/Text';

/**
 * Mes points : solde (1 point = 1 FCFA de réduction), comment en gagner, mon code de parrainage
 * à partager sur WhatsApp, le code de mon parrain (avant ma première commande), l'historique.
 */
export default function LoyaltyScreen() {
  const { ready, user } = useSession();
  const queryClient = useQueryClient();
  const [code, setCode] = useState('');
  const loyalty = useQuery({
    queryKey: ['loyalty'],
    queryFn: async () => unwrap(await api.GET('/v1/me/loyalty')),
    enabled: !!user,
  });
  const referral = useMutation({
    mutationFn: async () => unwrap(await api.POST('/v1/me/referral', { body: { code } })),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['loyalty'] }),
  });

  if (!ready) return <Loading />;
  if (!user) return <Redirect href={{ pathname: '/connexion', params: { next: '/fidelite' } }} />;
  if (loyalty.isPending) return <Loading />;
  if (loyalty.isError)
    return <Failure message={errorMessage(loyalty.error)} onRetry={() => void loyalty.refetch()} />;
  const l = loyalty.data;
  const share = () =>
    void Share.share({
      message: [t.loyalty.shareMessage(l.referralCode, l.rules.referralBonus), SITE_URL]
        .filter(Boolean)
        .join('\n'),
    }).catch(() => undefined);

  return (
    <Screen refreshing={loyalty.isRefetching} onRefresh={() => void loyalty.refetch()}>
      <Card style={styles.hero} testID="loyalty-balance">
        <Eyebrow color={colors.brand}>{t.loyalty.balance}</Eyebrow>
        <Text style={styles.points}>{groupThousands(String(l.points))}</Text>
        <Text style={styles.muted}>{t.loyalty.worth(groupThousands(String(l.points)))}</Text>
      </Card>

      <Card>
        <Text style={styles.cardTitle}>{t.loyalty.howTitle}</Text>
        <Text style={styles.body}>• {t.loyalty.howEarn(l.rules.fcfaPerPoint)}</Text>
        <Text style={styles.body}>
          • {t.loyalty.howSpend(l.rules.minRedeem, l.rules.maxSharePercent)}
        </Text>
        <Text style={styles.body}>• {t.loyalty.howReferral(l.rules.referralBonus)}</Text>
      </Card>

      <Card highlight>
        <View style={styles.row}>
          <Users color={colors.brand} size={20} />
          <Text style={styles.cardTitle}>{t.loyalty.referralTitle}</Text>
        </View>
        <Text style={styles.muted}>
          {t.loyalty.referralHint(l.rules.referralBonus, l.rules.referralMinOrder)}
        </Text>
        <Text style={styles.code} testID="loyalty-code" selectable>
          {l.referralCode}
        </Text>
        {l.referralCount > 0 ? (
          <Text style={styles.muted}>{t.loyalty.referralCount(l.referralCount)}</Text>
        ) : null}
        <Button label={t.loyalty.share} onPress={share} testID="loyalty-share" />
      </Card>

      {l.canEnterCode ? (
        <Card>
          <View style={styles.row}>
            <Gift color={colors.brand} size={20} />
            <Text style={styles.cardTitle}>{t.loyalty.sponsorTitle}</Text>
          </View>
          <Text style={styles.muted}>{t.loyalty.sponsorHint(l.rules.referralBonus)}</Text>
          <Field
            label={t.loyalty.sponsorCode}
            value={code}
            onChangeText={(v) => setCode(v.toUpperCase())}
            autoCapitalize="characters"
            maxLength={12}
            testID="loyalty-sponsor-code"
          />
          <ErrorText message={referral.error ? errorMessage(referral.error) : null} />
          <Button
            label={t.loyalty.sponsorSave}
            variant="secondary"
            onPress={() => referral.mutate()}
            disabled={code.trim().length < 6}
            loading={referral.isPending}
            testID="loyalty-sponsor-save"
          />
        </Card>
      ) : l.referredBy ? (
        <Note icon={Share2}>{t.loyalty.sponsorDone}</Note>
      ) : null}

      <Card>
        <Text style={styles.cardTitle}>{t.loyalty.history}</Text>
        {l.history.length === 0 ? <Text style={styles.muted}>{t.loyalty.noHistory}</Text> : null}
        {l.history.map((h) => (
          <View key={h.id} style={styles.line}>
            <View style={styles.flex}>
              <Text style={styles.body}>
                {t.loyalty.kinds[h.kind]}
                {h.orderRef ? ` · ${h.orderRef}` : ''}
              </Text>
              <Text style={styles.small}>{formatDateTime(h.at)}</Text>
            </View>
            <Text style={[styles.delta, h.points < 0 && styles.negative]}>
              {h.points > 0 ? '+' : '−'}
              {groupThousands(String(Math.abs(h.points)))}
            </Text>
          </View>
        ))}
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { gap: 4, borderColor: colors.brandBorder },
  points: { color: colors.text, fontSize: 44, fontWeight: '800' },
  muted: { color: colors.muted, fontSize: font.small, lineHeight: 19 },
  small: { color: colors.faint, fontSize: 12 },
  body: { color: colors.text, fontSize: font.small, lineHeight: 20 },
  cardTitle: { color: colors.text, fontWeight: '800', fontSize: font.body },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  code: {
    color: colors.brand,
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: 2,
    textAlign: 'center',
    paddingVertical: space.sm,
    borderRadius: radius.md,
    backgroundColor: colors.background,
  },
  line: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  flex: { flex: 1 },
  delta: { color: colors.brand, fontWeight: '800', fontSize: font.body },
  negative: { color: colors.muted },
});
