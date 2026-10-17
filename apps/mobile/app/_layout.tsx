import { QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { queryClient } from '../src/api';
import { CartProvider } from '../src/cart';
import { t } from '../src/i18n/fr';
import { SessionProvider } from '../src/session';
import { colors } from '../src/theme';

// Un lien direct (notification, partage) garde l'accueil en dessous : le bouton retour y ramène.
export const unstable_settings = { initialRouteName: '(tabs)' };

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <SessionProvider>
          <CartProvider>
            <StatusBar style="dark" />
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
            </Stack>
          </CartProvider>
        </SessionProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
