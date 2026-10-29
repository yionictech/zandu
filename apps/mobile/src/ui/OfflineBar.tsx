import type { ReactNode } from 'react';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from './Text';
import { SafeAreaInsetsContext, useSafeAreaInsets } from 'react-native-safe-area-context';
import { t } from '../i18n/fr';
import { DEMO } from '../config';
import { useOnline } from '../network';
import { needsServer } from '../server';
import { colors, font, space } from '../theme';

/**
 * Bandeau « hors connexion » en haut de chaque écran. Il prend la place de la barre d'état :
 * les en-têtes en dessous ne la comptent plus (marge haute remise à zéro).
 */
export function OfflineBar({ children }: { children: ReactNode }) {
  // APK de test sans serveur choisi : rien n'est « hors connexion », il n'y a pas encore de serveur.
  const online = useOnline() || needsServer();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  if (DEMO)
    return (
      <View style={styles.fill}>
        <Pressable
          onPress={() => router.push('/compte')}
          accessibilityRole="button"
          style={[styles.bar, styles.demo, { paddingTop: insets.top + space.xs }]}
          testID="demo-banner"
        >
          <Text style={[styles.text, styles.demoText]}>{t.demo.banner}</Text>
        </Pressable>
        <SafeAreaInsetsContext.Provider value={{ ...insets, top: 0 }}>
          {children}
        </SafeAreaInsetsContext.Provider>
      </View>
    );
  // Même arbre en ligne et hors ligne : la navigation n'est pas remise à zéro au changement.
  return (
    <View style={styles.fill}>
      {online ? null : (
        <View style={[styles.bar, { paddingTop: insets.top + space.sm }]} testID="offline-banner">
          <Text style={styles.text}>{t.offline.banner}</Text>
        </View>
      )}
      <SafeAreaInsetsContext.Provider value={online ? insets : { ...insets, top: 0 }}>
        {children}
      </SafeAreaInsetsContext.Provider>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  bar: { backgroundColor: colors.text, paddingHorizontal: space.md, paddingBottom: space.sm },
  text: { color: colors.surface, fontSize: font.small, fontWeight: '600', lineHeight: 18 },
  demo: { backgroundColor: colors.brand, paddingBottom: space.xs },
  demoText: { color: colors.onBrand, textAlign: 'center', fontSize: 12 },
});
