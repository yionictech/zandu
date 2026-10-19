import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Linking, StyleSheet } from 'react-native';
import { Text } from '../src/ui/Text';
import { api, errorMessage, unwrap } from '../src/api';
import { RECETTE_SMS_URL } from '../src/config';
import { displayPhone, isValidCongoPhone } from '../src/format';
import { t } from '../src/i18n/fr';
import { useSession } from '../src/session';
import { colors, font } from '../src/theme';
import { Button } from '../src/ui/Button';
import { ErrorText, Field } from '../src/ui/Form';
import { Screen } from '../src/ui/Layout';

/** Connexion par code SMS : le numéro est l'identité, comme pour le Mobile Money. */
export default function LoginScreen() {
  const router = useRouter();
  const { next } = useLocalSearchParams<{ next?: string }>();
  const { signIn } = useSession();
  const [phone, setPhone] = useState('');
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const requestCode = async () => {
    setBusy(true);
    setError(null);
    try {
      const sent = unwrap(await api.POST('/v1/auth/otp/request', { body: { phone } }));
      setChallengeId(sent.challengeId);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    if (!challengeId) return;
    setBusy(true);
    setError(null);
    try {
      const session = unwrap(
        await api.POST('/v1/auth/otp/verify', { body: { challengeId, code } }),
      );
      await signIn(session.token, session.user);
      if (next) router.replace(next as never);
      else router.back();
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Text style={styles.subtitle}>{t.auth.subtitle}</Text>
      {challengeId === null ? (
        <>
          <Field
            label={t.auth.phoneLabel}
            value={phone}
            onChangeText={setPhone}
            placeholder={t.auth.phonePlaceholder}
            keyboardType="phone-pad"
            autoComplete="tel"
            textContentType="telephoneNumber"
            testID="login-phone"
          />
          <ErrorText message={error} />
          <Button
            label={t.auth.sendCode}
            onPress={() => void requestCode()}
            loading={busy}
            disabled={!isValidCongoPhone(phone)}
            testID="login-send"
          />
        </>
      ) : (
        <>
          <Field
            label={t.auth.codeLabel(displayPhone(phone))}
            value={code}
            onChangeText={(v) => setCode(v.replace(/\D/g, '').slice(0, 6))}
            keyboardType="number-pad"
            autoComplete="sms-otp"
            textContentType="oneTimeCode"
            maxLength={6}
            style={styles.code}
            testID="login-code"
          />
          <ErrorText message={error} />
          <Button
            label={t.auth.verify}
            onPress={() => void verify()}
            loading={busy}
            disabled={code.length !== 6}
            testID="login-verify"
          />
          {RECETTE_SMS_URL && (
            <Button
              label={t.auth.readTestCode}
              variant="ghost"
              onPress={() =>
                void Linking.openURL(`${RECETTE_SMS_URL}?numero=${encodeURIComponent(phone)}`)
              }
            />
          )}
          <Button
            label={t.auth.changeNumber}
            variant="ghost"
            onPress={() => {
              setChallengeId(null);
              setCode('');
              setError(null);
            }}
          />
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  subtitle: { fontSize: font.body, color: colors.muted, lineHeight: 22 },
  code: { fontSize: 28, letterSpacing: 10, textAlign: 'center', fontWeight: '800' },
});
