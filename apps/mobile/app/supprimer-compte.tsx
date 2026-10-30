import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { Info, ShieldAlert } from 'lucide-react-native';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { api, errorMessage, queryClient, unwrap } from '../src/api';
import { DEMO, SERVER_PICKER } from '../src/config';
import { t } from '../src/i18n/fr';
import { apiUrl, fetchOnServer, recetteHeaders } from '../src/server';
import { useSession } from '../src/session';
import { colors, font, space } from '../src/theme';
import { Button } from '../src/ui/Button';
import { CodeInput } from '../src/ui/CodeInput';
import { ErrorText } from '../src/ui/Form';
import { Card, Note } from '../src/ui/kit';
import { Failure, Loading, Screen } from '../src/ui/Layout';
import { RequireSignIn } from '../src/ui/RequireRole';
import { Text } from '../src/ui/Text';

/**
 * Supprimer mon compte (exigence de Google Play et de l'App Store) : ce qui est effacé et ce qui
 * est gardé, ce qui empêche encore la suppression, puis confirmation par code SMS.
 */
export default function DeleteAccountScreen() {
  return (
    <RequireSignIn>
      <DeleteAccount />
    </RequireSignIn>
  );
}

function DeleteAccount() {
  const router = useRouter();
  const { user, signOut } = useSession();
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const status = useQuery({
    queryKey: ['me', 'deletion'],
    queryFn: async () => unwrap(await api.GET('/v1/me/deletion')),
  });

  if (status.isPending) return <Loading />;
  if (status.isError)
    return <Failure message={errorMessage(status.error)} onRetry={() => void status.refetch()} />;

  const ask = async () => {
    setBusy(true);
    setError(null);
    try {
      const sent = unwrap(await api.POST('/v1/me/deletion'));
      setChallengeId(sent.challengeId);
      // Version de test ou de démonstration : le SMS ne part pas, le code est relu ici.
      if ((SERVER_PICKER || DEMO) && user) {
        const res = await fetchOnServer(
          `${apiUrl()}/dev/messages?recipient=${encodeURIComponent(user.phone)}`,
          { headers: recetteHeaders() },
        );
        const { items } = (await res.json()) as {
          items: Array<{ template: string; variables: { code?: string } }>;
        };
        const found = items.find((m) => m.template === 'account_deletion_code')?.variables.code;
        if (found) setCode(found);
      }
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    if (!challengeId) return;
    setBusy(true);
    setError(null);
    try {
      unwrap(await api.POST('/v1/me/deletion/confirm', { body: { challengeId, code } }));
      await signOut();
      queryClient.clear();
      router.replace('/');
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };

  const blockers = status.data.blockers;
  return (
    <Screen
      footer={
        blockers.length ? null : challengeId ? (
          <Button
            label={t.deletion.confirm}
            variant="secondary"
            onPress={() => void confirm()}
            disabled={code.length !== 6}
            loading={busy}
            testID="deletion-confirm"
          />
        ) : (
          <Button
            label={t.deletion.ask}
            variant="secondary"
            onPress={() => void ask()}
            loading={busy}
            testID="deletion-ask"
          />
        )
      }
    >
      <Card>
        <View style={styles.row}>
          <ShieldAlert color={colors.danger} size={22} strokeWidth={1.8} />
          <Text style={styles.title}>{t.deletion.title}</Text>
        </View>
        <Text style={styles.body}>{t.deletion.erased}</Text>
        <Text style={styles.body}>{t.deletion.kept}</Text>
        <Text style={styles.body}>{t.deletion.final}</Text>
      </Card>
      {blockers.length ? (
        <Card testID="deletion-blocked">
          <Text style={styles.title}>{t.deletion.blockedTitle}</Text>
          {blockers.map((b) => (
            <Text key={b.code} style={styles.body}>
              • {b.message}
            </Text>
          ))}
          <Text style={styles.muted}>{t.deletion.blockedHint}</Text>
        </Card>
      ) : null}
      {challengeId ? (
        <>
          <Note icon={Info}>{t.deletion.codeSent}</Note>
          <CodeInput
            value={code}
            onChange={setCode}
            label={t.auth.codeDigits}
            testID="deletion-code"
          />
        </>
      ) : null}
      <ErrorText message={error} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  title: { color: colors.text, fontWeight: '800', fontSize: font.body },
  body: { color: colors.text, fontSize: font.small, lineHeight: 20 },
  muted: { color: colors.muted, fontSize: font.small, lineHeight: 19 },
});
