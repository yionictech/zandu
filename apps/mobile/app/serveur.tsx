import { useRouter } from 'expo-router';
import { Server } from 'lucide-react-native';
import { useState } from 'react';
import { StyleSheet } from 'react-native';
import { queryClient } from '../src/api';
import { t } from '../src/i18n/fr';
import { apiUrl, normalizeServerUrl, recetteKey, saveServer } from '../src/server';
import { useSession } from '../src/session';
import { colors, font } from '../src/theme';
import { Button } from '../src/ui/Button';
import { ErrorText, Field } from '../src/ui/Form';
import { Note } from '../src/ui/kit';
import { Screen } from '../src/ui/Layout';
import { Text } from '../src/ui/Text';

/**
 * APK de test seulement (docs/exploitation/apk-de-test.md) : le serveur Zandu à utiliser. On vérifie
 * qu'il répond (/health) avant de l'enregistrer ; changer de serveur ferme la session en cours.
 */
export default function ServerScreen() {
  const router = useRouter();
  const { user, signOut } = useSession();
  const [url, setUrl] = useState(apiUrl().startsWith('http://localhost') ? '' : apiUrl());
  const [key, setKey] = useState(recetteKey() ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setBusy(true);
    setError(null);
    const target = normalizeServerUrl(url);
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8_000);
      const res = await fetch(`${target}/health`, { signal: controller.signal });
      clearTimeout(timer);
      if (!res.ok) throw new Error(String(res.status));
    } catch {
      setError(t.server.unreachable);
      setBusy(false);
      return;
    }
    const changed = target !== apiUrl();
    if (changed && user) await signOut();
    await saveServer({ url: target, key: key.trim() || null });
    if (changed) queryClient.clear();
    setBusy(false);
    if (router.canGoBack()) router.back();
    else router.replace('/');
  };

  return (
    <Screen
      footer={
        <Button
          label={t.server.save}
          onPress={() => void save()}
          disabled={url.trim().length < 4}
          loading={busy}
          testID="server-save"
        />
      }
    >
      <Note icon={Server}>{t.server.intro}</Note>
      <Field
        label={t.server.url}
        value={url}
        onChangeText={setUrl}
        placeholder={t.server.urlPlaceholder}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        testID="server-url"
      />
      <Field
        label={t.server.key}
        value={key}
        onChangeText={setKey}
        autoCapitalize="none"
        autoCorrect={false}
        testID="server-key"
      />
      <Text style={styles.hint}>{t.server.keyHint}</Text>
      <ErrorText message={error} />
      <Text style={styles.hint}>{t.server.ok}</Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hint: { color: colors.muted, fontSize: font.small, lineHeight: 19 },
});
