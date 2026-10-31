import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { ChevronRight, MessageCircle } from 'lucide-react-native';
import { Pressable, StyleSheet, View } from 'react-native';
import { api, unwrap } from '../api';
import { t } from '../i18n/fr';
import { useSession } from '../session';
import { colors, font, radius, space } from '../theme';
import { Text } from './Text';

/** Conversations non lues de la personne connectée, partagées par tous les boutons « Messages ». */
export function useConversations() {
  const { user } = useSession();
  return useQuery({
    queryKey: ['conversations'],
    queryFn: async () => unwrap(await api.GET('/v1/me/conversations')),
    refetchInterval: 30_000,
    enabled: !!user,
  });
}

/** Pastille des onglets : nombre de messages non lus, toutes commandes confondues. */
export function useUnreadMessages(): number {
  return useConversations().data?.totalUnread ?? 0;
}

/** Ouvre la conversation de la commande ; pastille avec le nombre de messages non lus. */
export function MessagesButton({ orderId }: { orderId: string }) {
  const router = useRouter();
  const unread = useConversations().data?.items.find((c) => c.orderId === orderId)?.unread ?? 0;
  return (
    <Pressable
      onPress={() => router.push(`/messages/${orderId}`)}
      accessibilityRole="button"
      accessibilityLabel={unread ? `${t.messages.open}, ${unread} non lus` : t.messages.open}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
      testID="open-messages"
    >
      <View style={styles.icon}>
        <MessageCircle color={colors.brand} size={20} strokeWidth={2} />
      </View>
      <View style={styles.flex}>
        <Text style={styles.title}>{t.messages.open}</Text>
        <Text style={styles.hint}>{t.messages.openHint}</Text>
      </View>
      {unread ? (
        <View style={styles.badge} testID="messages-unread">
          <Text style={styles.badgeText}>{unread}</Text>
        </View>
      ) : null}
      <ChevronRight color={colors.muted} size={18} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm + 4,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space.md,
  },
  pressed: { opacity: 0.8 },
  icon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.brandSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  flex: { flex: 1 },
  title: { color: colors.text, fontWeight: '700', fontSize: font.body },
  hint: { color: colors.muted, fontSize: font.small },
  badge: {
    minWidth: 24,
    height: 24,
    borderRadius: 12,
    paddingHorizontal: 6,
    backgroundColor: colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { color: colors.onBrand, fontWeight: '800', fontSize: font.small },
});
