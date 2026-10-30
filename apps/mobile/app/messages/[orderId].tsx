import { useMutation, useQuery } from '@tanstack/react-query';
import { Stack, useLocalSearchParams } from 'expo-router';
import { SendHorizontal } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { components } from '@zandu/api-client';
import { api, errorMessage, queryClient, unwrap } from '../../src/api';
import { t } from '../../src/i18n/fr';
import { colors, font, radius, space } from '../../src/theme';
import { ErrorText } from '../../src/ui/Form';
import { Failure, Loading } from '../../src/ui/Layout';
import { RequireSignIn } from '../../src/ui/RequireRole';
import { Text, TextInput } from '../../src/ui/Text';

type Message = components['schemas']['OrderMessage'];

const time = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' });

/**
 * Conversation de la commande : acheteur, vendeur et livreur s'écrivent sans échanger leur
 * numéro. Rafraîchie toutes les 4 s tant que l'écran est ouvert (une notification prévient sinon).
 */
export default function MessagesScreen() {
  return (
    <RequireSignIn>
      <Conversation />
    </RequireSignIn>
  );
}

function Conversation() {
  const { orderId } = useLocalSearchParams<{ orderId: string }>();
  const [draft, setDraft] = useState('');
  const list = useRef<FlatList<Message>>(null);
  const key = ['order', orderId, 'messages'];
  const conversation = useQuery({
    queryKey: key,
    queryFn: async () =>
      unwrap(await api.GET('/v1/orders/{id}/messages', { params: { path: { id: orderId } } })),
    refetchInterval: 4_000,
  });
  const send = useMutation({
    mutationFn: async (body: string) =>
      unwrap(
        await api.POST('/v1/orders/{id}/messages', {
          params: { path: { id: orderId } },
          body: { body },
        }),
      ),
    onSuccess: () => {
      setDraft('');
      void queryClient.invalidateQueries({ queryKey: key });
      void queryClient.invalidateQueries({ queryKey: ['conversations'] });
    },
  });
  const count = conversation.data?.items.length ?? 0;
  useEffect(() => {
    if (count) setTimeout(() => list.current?.scrollToEnd({ animated: true }), 50);
  }, [count]);

  if (conversation.isPending) return <Loading />;
  if (conversation.isError)
    return (
      <Failure
        message={errorMessage(conversation.error)}
        onRetry={() => void conversation.refetch()}
      />
    );
  const c = conversation.data;
  const others = c.participants.map((p) => `${p.name} (${t.messages.roles[p.role]})`).join(', ');
  const submit = () => {
    const body = draft.trim();
    if (body && !send.isPending) send.mutate(body);
  };

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <Stack.Screen options={{ title: t.messages.title(c.publicRef) }} />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={90}
      >
        <Text style={styles.with} numberOfLines={2}>
          {others ? t.messages.with(others) : t.messages.alone}
        </Text>
        <FlatList
          ref={list}
          data={c.items}
          keyExtractor={(m) => m.id}
          contentContainerStyle={styles.list}
          ListEmptyComponent={<Text style={styles.empty}>{t.messages.empty}</Text>}
          renderItem={({ item: m }) => (
            <View
              style={[styles.bubble, m.mine ? styles.mine : styles.theirs]}
              testID={m.mine ? 'message-mine' : 'message-theirs'}
            >
              {m.mine ? null : (
                <Text style={[styles.author, m.role === 'support' && styles.support]}>
                  {m.name} · {t.messages.roles[m.role]}
                </Text>
              )}
              <Text style={[styles.body, m.mine && styles.bodyMine]}>{m.body}</Text>
              <Text style={[styles.time, m.mine && styles.timeMine]}>
                {time.format(new Date(m.createdAt))}
              </Text>
            </View>
          )}
        />
        <ErrorText message={send.error ? errorMessage(send.error) : null} />
        {c.canWrite ? (
          <View style={styles.composer}>
            <TextInput
              value={draft}
              onChangeText={setDraft}
              placeholder={t.messages.placeholder}
              placeholderTextColor={colors.faint}
              style={styles.input}
              multiline
              maxLength={1000}
              accessibilityLabel={t.messages.placeholder}
              testID="message-input"
            />
            <Pressable
              onPress={submit}
              disabled={!draft.trim() || send.isPending}
              accessibilityRole="button"
              accessibilityLabel={t.messages.send}
              style={[styles.send, (!draft.trim() || send.isPending) && styles.sendDisabled]}
              testID="message-send"
            >
              <SendHorizontal color={colors.onBrand} size={20} strokeWidth={2} />
            </Pressable>
          </View>
        ) : (
          <Text style={styles.closed}>{t.messages.closed}</Text>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  with: {
    color: colors.muted,
    fontSize: font.small,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  list: { padding: space.md, gap: space.sm, flexGrow: 1 },
  empty: { color: colors.muted, textAlign: 'center', marginTop: space.xl, lineHeight: 20 },
  bubble: { maxWidth: '82%', borderRadius: radius.lg, padding: space.sm + 2, gap: 2 },
  mine: { alignSelf: 'flex-end', backgroundColor: colors.brand, borderBottomRightRadius: 4 },
  theirs: { alignSelf: 'flex-start', backgroundColor: colors.surface, borderBottomLeftRadius: 4 },
  author: { color: colors.waiting, fontSize: font.small, fontWeight: '700' },
  support: { color: colors.brand },
  body: { color: colors.text, fontSize: font.body, lineHeight: 21 },
  bodyMine: { color: colors.onBrand },
  time: { color: colors.faint, fontSize: 11, alignSelf: 'flex-end' },
  timeMine: { color: colors.onBrand, opacity: 0.6 },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: space.sm,
    padding: space.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.bar,
  },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 120,
    color: colors.text,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    paddingHorizontal: space.md,
    paddingVertical: 10,
    fontSize: font.body,
  },
  send: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.brand,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendDisabled: { opacity: 0.4 },
  closed: { color: colors.muted, textAlign: 'center', padding: space.md, fontSize: font.small },
});
