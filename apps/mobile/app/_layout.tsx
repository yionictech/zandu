import { QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { queryClient } from '../src/api';
import { CartProvider } from '../src/cart';
import { t } from '../src/i18n/fr';
import { SessionProvider } from '../src/session';
import { colors } from '../src/theme';
import { OfflineBar } from '../src/ui/OfflineBar';
import { OutboxRunner } from '../src/seller/outbox';
import { PushNotifications } from '../src/notifications';

// Un lien direct (notification, partage) garde l'accueil en dessous : le bouton retour y ramène.
export const unstable_settings = { initialRouteName: '(tabs)' };

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <SessionProvider>
          <CartProvider>
            <StatusBar style="dark" />
            <OutboxRunner />
            <PushNotifications />
            <OfflineBar>
              <Stack
                screenOptions={{
                  headerTintColor: colors.text,
                  headerTitleStyle: { fontWeight: '700' },
                  headerBackTitle: t.common.back,
                  contentStyle: { backgroundColor: colors.background },
                }}
              >
                <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
                <Stack.Screen name="produit/[id]" options={{ title: '' }} />
                <Stack.Screen
                  name="connexion"
                  options={{ title: t.auth.title, presentation: 'modal' }}
                />
                <Stack.Screen name="commande/livraison" options={{ title: t.checkout.title }} />
                <Stack.Screen name="paiement/[checkoutId]" options={{ title: t.payment.title }} />
                <Stack.Screen name="commande/[id]" options={{ title: t.orders.order }} />
                <Stack.Screen name="litige/[orderId]" options={{ title: t.dispute.title }} />
                <Stack.Screen name="vendeur/ouvrir" options={{ title: t.seller.openTitle }} />
                <Stack.Screen name="vendeur/index" options={{ title: t.account.sellerSpace }} />
                <Stack.Screen name="vendeur/commandes" options={{ title: t.seller.orders }} />
                <Stack.Screen name="vendeur/commande/[id]" options={{ title: t.orders.order }} />
                <Stack.Screen name="vendeur/produits" options={{ title: t.seller.products }} />
                <Stack.Screen
                  name="vendeur/produit/nouveau"
                  options={{ title: t.seller.newProduct }}
                />
                <Stack.Screen
                  name="vendeur/produit/[id]"
                  options={{ title: t.seller.editProduct }}
                />
                <Stack.Screen name="vendeur/argent" options={{ title: t.seller.money }} />
                <Stack.Screen
                  name="vendeur/verification"
                  options={{ title: t.seller.verificationTitle }}
                />
                <Stack.Screen name="livreur/index" options={{ title: t.rider.title }} />
                <Stack.Screen name="livreur/[orderId]" options={{ title: t.rider.codeTitle }} />
              </Stack>
            </OfflineBar>
          </CartProvider>
        </SessionProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
