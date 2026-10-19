import { onlineManager } from '@tanstack/react-query';
import * as Notifications from 'expo-notifications';
import { useRouter, type Href } from 'expo-router';
import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import { api, queryClient } from './api';
import { EAS_PROJECT_ID } from './config';
import { useSession } from './session';
import { saveJson } from './storage';
import { PUSH_TOKEN_KEY } from './pushDevice';

/**
 * Notifications de l'application (ADR-0018) : le téléphone s'enregistre auprès de l'API pour la
 * session en cours ; une notification reçue application ouverte, ou touchée, est signalée à
 * l'API (elle ne sera pas doublée par WhatsApp/SMS) et ouvre l'écran concerné.
 */
const supported = Platform.OS === 'android' && EAS_PROJECT_ID !== null;

if (supported) {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
}

/** Jeton de ce téléphone, ou null (refus de l'utilisateur, version web, projet non configuré). */
async function pushToken(): Promise<string | null> {
  if (!supported) return null;
  await Notifications.setNotificationChannelAsync('commandes', {
    name: 'Commandes et livraisons',
    importance: Notifications.AndroidImportance.HIGH,
    lightColor: '#C2410C',
  });
  let { status } = await Notifications.getPermissionsAsync();
  if (status !== 'granted') ({ status } = await Notifications.requestPermissionsAsync());
  if (status !== 'granted') return null;
  const { data } = await Notifications.getExpoPushTokenAsync({ projectId: EAS_PROJECT_ID! });
  return data;
}

async function register(): Promise<void> {
  const token = await pushToken();
  if (!token) return;
  await saveJson(PUSH_TOKEN_KEY, token);
  await api.PUT('/v1/me/devices', { body: { token, platform: 'android' } });
}

function ack(notification: Notifications.Notification): void {
  const id = notification.request.content.data?.notificationId;
  if (typeof id === 'string')
    void api
      .POST('/v1/me/notifications/{id}/ack', { params: { path: { id } } })
      .catch(() => undefined);
}

/**
 * Monté une fois, sous la session : enregistrement, accusés, ouverture de l'écran visé.
 * Rien sur la version web ni sans projet Expo (les crochets natifs n'y existent pas).
 */
export function PushNotifications() {
  return supported ? <NativePushNotifications /> : null;
}

function NativePushNotifications() {
  const { user } = useSession();
  const router = useRouter();
  const lastOpened = useRef<string | null>(null);
  const response = Notifications.useLastNotificationResponse();

  // Enregistré à chaque connexion et à chaque retour du réseau (jeton éventuellement renouvelé).
  useEffect(() => {
    if (!user) return;
    void register().catch(() => undefined);
    return onlineManager.subscribe((online) => {
      if (online) void register().catch(() => undefined);
    });
  }, [user?.id]);

  // Reçue application ouverte : les écrans se mettent à jour, pas besoin de la doubler.
  useEffect(() => {
    const sub = Notifications.addNotificationReceivedListener((notification) => {
      ack(notification);
      void queryClient.invalidateQueries();
    });
    return () => sub.remove();
  }, []);

  // Touchée (application ouverte, en arrière-plan ou fermée) : l'écran de la commande.
  useEffect(() => {
    if (!response || !user) return;
    const { notification } = response;
    if (lastOpened.current === notification.request.identifier) return;
    lastOpened.current = notification.request.identifier;
    ack(notification);
    const url = notification.request.content.data?.url;
    if (typeof url === 'string' && url.startsWith('/')) router.push(url as Href);
  }, [response, user, router]);

  return null;
}
