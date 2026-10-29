import { useLocalSearchParams, useRouter } from 'expo-router';
import { ShieldCheck, Smartphone } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';
import { api, errorMessage, unwrap } from '../src/api';
import { parseCongoMobile } from '@zandu/domain';
import { RECETTE_SMS_URL, SERVER_PICKER } from '../src/config';
import { apiUrl, recetteHeaders } from '../src/server';
import { displayPhone, isValidCongoPhone } from '../src/format';
import { t } from '../src/i18n/fr';
import { useSession } from '../src/session';
import { colors, font, radius, space, touchTarget } from '../src/theme';
import { Button } from '../src/ui/Button';
import { CodeInput } from '../src/ui/CodeInput';
import { ErrorText } from '../src/ui/Form';
import { Note } from '../src/ui/kit';
import { Screen } from '../src/ui/Layout';
import { Text, TextInput } from '../src/ui/Text';

/** Délai avant de pouvoir redemander un code (règle de l'API : un code par minute). */
const RESEND_SECONDS = 60;

/** Connexion par code SMS (maquette « Connexion ») : le numéro est l'identité, comme le Mobile Money. */
export default function LoginScreen() {
  const router = useRouter();
  const { next } = useLocalSearchParams<{ next?: string }>();
  const { signIn } = useSession();
  const [phone, setPhone] = useState('');
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [wait, setWait] = useState(0);
  const [testCode, setTestCode] = useState<string | null>(null);

  /** APK de test : le SMS ne part pas, on lit le code dans la boîte de test du serveur. */
  const readTestCode = async () => {
    setTestCode(null);
    try {
      const recipient = parseCongoMobile(phone).e164;
      const res = await fetch(
        `${apiUrl()}/dev/messages?recipient=${encodeURIComponent(recipient)}`,
        { headers: recetteHeaders() },
      );
      const { items } = (await res.json()) as {
        items: Array<{ template: string; variables: { code?: string } }>;
      };
      const found = items.find((m) => m.template === 'otp_code')?.variables.code;
      if (found) {
        setCode(found);
        setTestCode(t.auth.testCode(found));
      } else setTestCode(t.auth.noTestCode);
    } catch {
      setTestCode(t.auth.noTestCode);
    }
  };

  useEffect(() => {
    if (wait <= 0) return;
    const timer = setTimeout(() => setWait(wait - 1), 1000);
    return () => clearTimeout(timer);
  }, [wait]);

  const requestCode = async () => {
    setBusy(true);
    setError(null);
    try {
      const sent = unwrap(await api.POST('/v1/auth/otp/request', { body: { phone } }));
      setChallengeId(sent.challengeId);
      setCode('');
      setWait(RESEND_SECONDS);
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

  const codeStep = challengeId !== null;
  return (
    <Screen
      footer={
        codeStep ? (
          <Button
            label={t.auth.verify}
            onPress={() => void verify()}
            loading={busy}
            disabled={code.length !== 6}
            testID="login-verify"
          />
        ) : (
          <Button
            label={t.auth.sendCode}
            onPress={() => void requestCode()}
            loading={busy}
            disabled={!isValidCongoPhone(phone)}
            testID="login-send"
          />
        )
      }
    >
      <View style={styles.icon}>
        <Smartphone color={colors.onBrand} size={30} strokeWidth={1.8} />
      </View>
      <Text style={styles.title}>{codeStep ? t.auth.codeTitle : t.auth.phoneTitle}</Text>
      <Text style={styles.subtitle}>
        {codeStep ? t.auth.sentTo(displayPhone(phone)) : t.auth.subtitle}
      </Text>

      {codeStep ? (
        <>
          <CodeInput
            value={code}
            onChange={setCode}
            label={t.auth.codeDigits}
            testID="login-code"
          />
          <View style={styles.links}>
            {wait > 0 ? (
              <Text style={styles.wait}>
                {t.auth.resendIn(`0:${String(wait).padStart(2, '0')}`)}
              </Text>
            ) : (
              <Pressable onPress={() => void requestCode()} accessibilityRole="button">
                <Text style={styles.link}>{t.auth.resend}</Text>
              </Pressable>
            )}
            <Pressable
              onPress={() => {
                setChallengeId(null);
                setCode('');
                setError(null);
              }}
              accessibilityRole="button"
            >
              <Text style={styles.link}>{t.auth.changeNumber}</Text>
            </Pressable>
          </View>
          <ErrorText message={error} />
          {SERVER_PICKER ? (
            <>
              <Button
                label={t.auth.readTestCode}
                variant="ghost"
                onPress={() => void readTestCode()}
                testID="login-test-code"
              />
              {testCode ? <Text style={styles.testCode}>{testCode}</Text> : null}
            </>
          ) : null}
          {!SERVER_PICKER && RECETTE_SMS_URL && (
            <Button
              label={t.auth.readTestCode}
              variant="ghost"
              onPress={() =>
                void Linking.openURL(`${RECETTE_SMS_URL}?numero=${encodeURIComponent(phone)}`)
              }
            />
          )}
          <Note icon={ShieldCheck}>{t.auth.phoneNote}</Note>
        </>
      ) : (
        <>
          <View style={styles.phoneRow}>
            <View style={styles.prefix}>
              <Text style={styles.prefixText}>+242</Text>
            </View>
            <TextInput
              value={phone}
              onChangeText={setPhone}
              placeholder={t.auth.phonePlaceholder}
              keyboardType="phone-pad"
              autoComplete="tel"
              textContentType="telephoneNumber"
              autoFocus
              style={styles.phone}
              accessibilityLabel={t.auth.phoneLabel}
              testID="login-phone"
            />
          </View>
          <ErrorText message={error} />
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  testCode: { color: colors.text, textAlign: 'center', fontSize: font.small },
  icon: {
    width: 64,
    height: 64,
    borderRadius: radius.lg,
    backgroundColor: colors.brand,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: space.sm,
  },
  title: { fontSize: 24, fontWeight: '800', color: colors.text, lineHeight: 30 },
  subtitle: { fontSize: font.body, color: colors.muted, lineHeight: 22, marginTop: -space.sm },
  links: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  wait: { color: colors.muted, fontSize: font.small },
  link: { color: colors.brand, fontWeight: '700', fontSize: font.small },
  phoneRow: { flexDirection: 'row', gap: space.sm },
  prefix: {
    minHeight: Math.max(touchTarget, 52),
    paddingHorizontal: space.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    justifyContent: 'center',
  },
  prefixText: { color: colors.text, fontWeight: '700', fontSize: font.body },
  phone: {
    flex: 1,
    minHeight: Math.max(touchTarget, 52),
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: space.md,
    fontSize: font.body,
  },
});
