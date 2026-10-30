import { DMSans_400Regular } from '@expo-google-fonts/dm-sans/400Regular';
import { DMSans_500Medium } from '@expo-google-fonts/dm-sans/500Medium';
import { DMSans_700Bold } from '@expo-google-fonts/dm-sans/700Bold';
import { Unbounded_700Bold } from '@expo-google-fonts/unbounded/700Bold';
import { Unbounded_800ExtraBold } from '@expo-google-fonts/unbounded/800ExtraBold';
import { QueryClientProvider } from '@tanstack/react-query';
import { useFonts } from 'expo-font';
import { Stack, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { queryClient } from '../src/api';
import { CartProvider } from '../src/cart';
import { t } from '../src/i18n/fr';
import { SessionProvider } from '../src/session';
import { colors } from '../src/theme';
import { darkHeader } from '../src/ui/navigation';
import { OfflineBar } from '../src/ui/OfflineBar';
import { OutboxRunner } from '../src/seller/outbox';
import { PushNotifications } from '../src/notifications';
import { loadDemo } from '../src/demo';
import { loadServer, needsServer } from '../src/server';

// Un lien direct (notification, partage) garde l'accueil en dessous : le bouton retour y ramène.
export const unstable_settings = { initialRouteName: '(tabs)' };

export default function RootLayout() {
  // Polices comprises dans l'application (aucun téléchargement) ; l'écran attend leur chargement.
  const [fontsLoaded, fontError] = useFonts({
    DMSans_400Regular,
    DMSans_500Medium,
    DMSans_700Bold,
    Unbounded_700Bold,
    Unbounded_800ExtraBold,
  });
  // APK de test : le serveur choisi est relu avant le premier appel à l'API ; démonstration :
  // les données fictives enregistrées sur le téléphone.
  const [serverLoaded, setServerLoaded] = useState(false);
  useEffect(() => {
    void Promise.all([loadServer(), loadDemo()]).finally(() => setServerLoaded(true));
  }, []);
  if ((!fontsLoaded && !fontError) || !serverLoaded) return null;
  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <SessionProvider>
          <CartProvider>
            <StatusBar style="light" />
            <ServerGate />
            <OutboxRunner />
            <PushNotifications />
            <OfflineBar>
              <Stack
                screenOptions={{
                  ...darkHeader,
                  headerBackTitle: t.common.back,
                  contentStyle: { backgroundColor: colors.background },
                }}
              >
                <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
                <Stack.Screen name="produit/[id]" options={{ title: '' }} />
                <Stack.Screen name="notifications" options={{ title: t.inbox.title }} />
                <Stack.Screen name="serveur" options={{ title: t.server.title }} />
                <Stack.Screen name="supprimer-compte" options={{ title: t.deletion.title }} />
                <Stack.Screen name="messages/[orderId]" options={{ title: t.messages.open }} />
                <Stack.Screen
                  name="connexion"
                  options={{ title: t.auth.title, presentation: 'modal' }}
                />
                <Stack.Screen name="commande/livraison" options={{ title: t.checkout.title }} />
                <Stack.Screen name="paiement/[checkoutId]" options={{ title: t.payment.title }} />
                <Stack.Screen name="commande/[id]" options={{ title: t.orders.order }} />
                <Stack.Screen name="litige/[orderId]" options={{ title: t.dispute.title }} />
                <Stack.Screen name="vendeur/ouvrir" options={{ title: t.seller.openTitle }} />
                <Stack.Screen name="vendeur/(onglets)" options={{ headerShown: false }} />
                <Stack.Screen name="vendeur/compte" options={{ title: t.seller.openTitle }} />
                <Stack.Screen name="vendeur/boutique" options={{ title: t.vendor.myShop }} />
                <Stack.Screen name="vendeur/avis" options={{ title: t.vendor.reviewsTitle }} />
                <Stack.Screen name="vendeur/horaires" options={{ title: t.vendor.hours }} />
                <Stack.Screen name="vendeur/retrait" options={{ title: t.vendor.withdrawTitle }} />
                <Stack.Screen name="vendeur/commande/[id]" options={{ title: t.orders.order }} />
                <Stack.Screen
                  name="vendeur/produit/nouveau"
                  options={{ title: t.seller.newProduct }}
                />
                <Stack.Screen
                  name="vendeur/produit/[id]"
                  options={{ title: t.seller.editProduct }}
                />
                <Stack.Screen
                  name="vendeur/verification"
                  options={{ title: t.seller.verificationTitle }}
                />
                <Stack.Screen name="livreur/(onglets)" options={{ headerShown: false }} />
                <Stack.Screen name="livreur/[orderId]" options={{ title: t.rider.title }} />
                <Stack.Screen
                  name="livreur/incident/[orderId]"
                  options={{ title: t.rider.incidentTitle }}
                />
              </Stack>
            </OfflineBar>
          </CartProvider>
        </SessionProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}

/** APK de test sans serveur choisi : l'écran « Serveur de test » s'ouvre d'abord. */
function ServerGate() {
  const router = useRouter();
  useEffect(() => {
    if (needsServer()) router.push('/serveur');
  }, [router]);
  return null;
}
