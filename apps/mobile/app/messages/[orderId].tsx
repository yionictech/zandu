import { useMutation, useQuery } from '@tanstack/react-query';
import { Stack, useLocalSearchParams } from 'expo-router';
import { Image } from 'expo-image';
import { Camera, Phone, SendHorizontal } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { components } from '@zandu/api-client';
import { useStartCall } from '../../src/call/useStartCall';
import { pickImage, uploadImage, type LocalImage } from '../../src/upload';
import { api, errorMessage, queryClient, unwrap } from '../../src/api';
import { t } from '../../src/i18n/fr';
import { colors, font, radius, space } from '../../src/theme';
import { ErrorText } from '../../src/ui/Form';
import { Failure, Loading } from '../../src/ui/Layout';
import { RequireSignIn } from '../../src/ui/RequireRole';
import { Text, TextInput } from '../../src/ui/Text';

type Message = components['schemas']['OrderMessage'];

/** « 2 min 05 », « 45 s ». */
function duration(seconds: number | null): string {
  if (!seconds) return '0 s';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m ? `${m} min ${String(s).padStart(2, '0')}` : `${s} s`;
}

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
  const [viewing, setViewing] = useState<string | null>(null);
  const send = useMutation({
    mutationFn: async (input: { body?: string; photo?: LocalImage }) => {
      const photoUploadId = input.photo
        ? await uploadImage('message_photo', input.photo)
        : undefined;
      return unwrap(
        await api.POST('/v1/orders/{id}/messages', {
          params: { path: { id: orderId } },
          body: { body: input.body ?? '', ...(photoUploadId ? { photoUploadId } : {}) },
        }),
      );
    },
    onSuccess: (_sent, input) => {
      if (input.body === draft.trim()) setDraft('');
      void queryClient.invalidateQueries({ queryKey: key });
      void queryClient.invalidateQueries({ queryKey: ['conversations'] });
    },
  });
  const startCall = useStartCall(orderId);
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
    if (body && !send.isPending) send.mutate({ body });
  };
  const sendPhoto = async (source: 'camera' | 'library') => {
    try {
      const photo = await pickImage(source);
      if (photo) send.mutate({ photo });
    } catch (error) {
      Alert.alert(t.messages.photo, errorMessage(error));
    }
  };
  const askPhoto = () =>
    Platform.OS === 'web'
      ? void sendPhoto('library')
      : Alert.alert(t.messages.photo, undefined, [
          { text: t.messages.takePhoto, onPress: () => void sendPhoto('camera') },
          { text: t.messages.choosePhoto, onPress: () => void sendPhoto('library') },
          { text: t.calls.cancel, style: 'cancel' },
        ]);
  // « Vu » sous mon dernier message lu par quelqu'un.
  const lastSeen = [...c.items].reverse().find((m) => m.kind === 'message' && m.mine)?.id;
  const quick = c.me in t.messages.quick ? t.messages.quick[c.me] : [];

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <Stack.Screen
        options={{
          title: t.messages.title(c.publicRef),
          headerRight: () =>
            c.canWrite && c.participants.length ? (
              <Pressable
                onPress={() => {
                  const [only] = c.participants;
                  if (c.participants.length === 1 && only) return startCall.mutate(only.role);
                  Alert.alert(t.calls.chooseTitle, undefined, [
                    ...c.participants.map((p) => ({
                      text: t.calls.callWho(p.name, t.messages.roles[p.role]),
                      onPress: () => startCall.mutate(p.role),
                    })),
                    { text: t.calls.cancel, style: 'cancel' as const },
                  ]);
                }}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel={t.calls.call}
                testID="messages-call"
                style={styles.headerCall}
              >
                <Phone color={colors.brand} size={22} strokeWidth={2} />
              </Pressable>
            ) : null,
        }}
      />
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
          renderItem={({ item: m }) =>
            m.kind === 'call' && m.call ? (
              <View style={styles.callLine} testID="message-call">
                <Phone
                  color={m.call.status === 'ended' ? colors.muted : colors.danger}
                  size={14}
                  strokeWidth={2}
                />
                <Text style={styles.callText}>
                  {m.call.status === 'ended'
                    ? t.messages.call.ended(duration(m.call.durationSeconds))
                    : m.call.status === 'declined'
                      ? t.messages.call.declined(m.mine)
                      : t.messages.call.missed(m.name, m.mine)}
                  {' · '}
                  {time.format(new Date(m.createdAt))}
                </Text>
              </View>
            ) : (
              <View
                style={[styles.bubble, m.mine ? styles.mine : styles.theirs]}
                testID={m.mine ? 'message-mine' : 'message-theirs'}
              >
                {m.mine ? null : (
                  <Text style={[styles.author, m.role === 'support' && styles.support]}>
                    {m.name} · {t.messages.roles[m.role]}
                  </Text>
                )}
                {m.photoUrl ? (
                  <Pressable
                    onPress={() => setViewing(m.photoUrl)}
                    accessibilityRole="imagebutton"
                    testID="message-photo"
                  >
                    <Image source={{ uri: m.photoUrl }} style={styles.photo} contentFit="cover" />
                  </Pressable>
                ) : null}
                {m.body ? (
                  <Text style={[styles.body, m.mine && styles.bodyMine]}>{m.body}</Text>
                ) : null}
                <Text style={[styles.time, m.mine && styles.timeMine]}>
                  {time.format(new Date(m.createdAt))}
                  {m.id === lastSeen && m.seen ? ` · ${t.messages.seen}` : ''}
                </Text>
              </View>
            )
          }
        />
        <ErrorText message={send.error ? errorMessage(send.error) : null} />
        {c.canWrite && quick.length ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.quickBar}
            contentContainerStyle={styles.quick}
            keyboardShouldPersistTaps="handled"
          >
            {quick.map((text) => (
              <Pressable
                key={text}
                onPress={() => send.mutate({ body: text })}
                disabled={send.isPending}
                accessibilityRole="button"
                style={styles.chip}
                testID="message-quick"
              >
                <Text style={styles.chipText}>{text}</Text>
              </Pressable>
            ))}
          </ScrollView>
        ) : null}
        {c.canWrite ? (
          <View style={styles.composer}>
            <Pressable
              onPress={askPhoto}
              disabled={send.isPending}
              accessibilityRole="button"
              accessibilityLabel={t.messages.photo}
              style={styles.attach}
              testID="message-photo-button"
            >
              {send.isPending ? (
                <ActivityIndicator color={colors.brand} />
              ) : (
                <Camera color={colors.brand} size={22} strokeWidth={2} />
              )}
            </Pressable>
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
      <Modal
        visible={!!viewing}
        transparent
        animationType="fade"
        onRequestClose={() => setViewing(null)}
      >
        <Pressable
          style={styles.viewer}
          onPress={() => setViewing(null)}
          accessibilityLabel={t.messages.close}
        >
          {viewing ? (
            <Image source={{ uri: viewing }} style={styles.full} contentFit="contain" />
          ) : null}
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  headerCall: { paddingHorizontal: space.sm },
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
  attach: { width: 40, height: 44, alignItems: 'center', justifyContent: 'center' },
  photo: { width: 220, height: 220, borderRadius: radius.md, marginVertical: 2 },
  viewer: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.92)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  full: { width: '100%', height: '80%' },
  quickBar: { flexGrow: 0, flexShrink: 0 },
  quick: {
    gap: space.sm,
    paddingHorizontal: space.sm,
    paddingVertical: space.sm,
    alignItems: 'center',
  },
  chip: {
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.brandBorder,
    backgroundColor: colors.brandSoft,
    paddingHorizontal: space.md,
    paddingVertical: 8,
  },
  chipText: { color: colors.brand, fontSize: font.small, fontWeight: '700' },
  callLine: {
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    paddingHorizontal: space.md,
    paddingVertical: 6,
  },
  callText: { color: colors.muted, fontSize: font.small },
  closed: { color: colors.muted, textAlign: 'center', padding: space.md, fontSize: font.small },
});
