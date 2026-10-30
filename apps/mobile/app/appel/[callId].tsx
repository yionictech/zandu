import { useMutation, useQuery } from '@tanstack/react-query';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Mic, MicOff, Phone, PhoneOff, Volume2 } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Vibration, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api, errorMessage, queryClient, unwrap } from '../../src/api';
import { joinCall } from '../../src/call/session';
import type { CallSession } from '../../src/call/room';
import { accessFor, forgetAccess, rememberAccess } from '../../src/call/store';
import { t } from '../../src/i18n/fr';
import { colors, font, space } from '../../src/theme';
import { Failure, Loading } from '../../src/ui/Layout';
import { RequireSignIn } from '../../src/ui/RequireRole';
import { Text } from '../../src/ui/Text';

type Phase = 'idle' | 'connecting' | 'waiting' | 'talking' | 'over';

/**
 * Appel internet entre participants d'une commande (LiveKit) : sonnerie, décroché, micro,
 * haut-parleur, raccrocher. Aucun numéro n'est montré ; rien n'est enregistré.
 */
export default function CallScreen() {
  return (
    <RequireSignIn>
      <Call />
    </RequireSignIn>
  );
}

function Call() {
  const { callId } = useLocalSearchParams<{ callId: string }>();
  const router = useRouter();
  const session = useRef<CallSession | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [reconnecting, setReconnecting] = useState(false);
  const [muted, setMuted] = useState(false);
  const [speaker, setSpeaker] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [talkingSince, setTalkingSince] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());

  const call = useQuery({
    queryKey: ['call', callId],
    queryFn: async () =>
      unwrap(await api.GET('/v1/calls/{id}', { params: { path: { id: callId } } })),
    refetchInterval: phase === 'over' ? false : 2_000,
  });
  const c = call.data;
  const status = c?.status;
  const incomingRinging = c?.direction === 'incoming' && status === 'ringing' && phase === 'idle';

  const hangUp = async (notify = true) => {
    const s = session.current;
    session.current = null;
    setPhase('over');
    Vibration.cancel();
    forgetAccess(callId);
    if (s) await s.leave().catch(() => undefined);
    if (notify)
      await api
        .POST('/v1/calls/{id}/end', { params: { path: { id: callId } } })
        .catch(() => undefined);
    void queryClient.invalidateQueries({ queryKey: ['call', callId] });
  };

  const join = async (access: { url: string; token: string }) => {
    setPhase('connecting');
    try {
      session.current = await joinCall(access, {
        onPeer: (present) => {
          if (present) {
            setPhase('talking');
            setTalkingSince((since) => since ?? Date.now());
          } else if (session.current) {
            void hangUp(); // l'autre a raccroché
          }
        },
        onReconnecting: setReconnecting,
        onDisconnected: () => {
          if (session.current) void hangUp();
        },
      });
      setPhase((p) => (p === 'connecting' ? 'waiting' : p));
    } catch (error) {
      setProblem(String(error).includes('ermission') ? t.calls.micDenied : errorMessage(error));
      await hangUp();
    }
  };

  // Appelant : il entre dans la salle tout de suite et attend que l'autre décroche.
  useEffect(() => {
    const access = accessFor(callId);
    if (c?.direction === 'outgoing' && access && phase === 'idle' && status === 'ringing')
      void join(access);
  }, [c?.direction, status]);

  // Fin vue par le serveur (refus, sans réponse, raccroché ailleurs).
  useEffect(() => {
    if (status && ['declined', 'missed', 'ended'].includes(status) && phase !== 'over')
      void hangUp(false);
  }, [status]);

  // Sonnerie (vibration) tant qu'un appel entrant attend.
  useEffect(() => {
    if (!incomingRinging) return;
    Vibration.vibrate([0, 900, 700], true);
    return () => Vibration.cancel();
  }, [incomingRinging]);

  // Fermer l'écran peu après la fin ; raccrocher si l'on quitte l'écran en cours d'appel.
  useEffect(() => {
    if (phase !== 'over') return;
    const timer = setTimeout(
      () => (router.canGoBack() ? router.back() : router.replace('/')),
      1800,
    );
    return () => clearTimeout(timer);
  }, [phase]);
  useEffect(() => () => void hangUp(), []);
  useEffect(() => {
    if (phase !== 'talking') return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [phase]);

  const accept = useMutation({
    mutationFn: async () =>
      unwrap(await api.POST('/v1/calls/{id}/accept', { params: { path: { id: callId } } })),
    onSuccess: (accepted) => {
      Vibration.cancel();
      rememberAccess(callId, accepted.livekit);
      void join(accepted.livekit);
    },
    onError: (error) => setProblem(errorMessage(error)),
  });
  const decline = async () => {
    Vibration.cancel();
    await api
      .POST('/v1/calls/{id}/decline', { params: { path: { id: callId } } })
      .catch(() => undefined);
    await hangUp(false);
  };

  if (call.isPending) return <Loading />;
  if (call.isError || !c)
    return <Failure message={errorMessage(call.error)} onRetry={() => void call.refetch()} />;

  const role = t.messages.roles[c.peer.role];
  const elapsed = talkingSince ? Math.max(0, Math.floor((now - talkingSince) / 1000)) : 0;
  const line =
    phase === 'over' || ['declined', 'missed', 'ended'].includes(c.status)
      ? (problem ??
        (c.status === 'declined'
          ? t.calls.declined
          : c.status === 'missed' && !talkingSince
            ? t.calls.missed
            : t.calls.ended))
      : reconnecting
        ? t.calls.reconnecting
        : phase === 'talking'
          ? `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, '0')}`
          : incomingRinging
            ? t.calls.incoming
            : phase === 'connecting'
              ? t.calls.connecting
              : t.calls.ringing;

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <Stack.Screen options={{ headerShown: false, gestureEnabled: false }} />
      <View style={styles.top}>
        <View style={styles.avatar}>
          <Text style={styles.initial}>{c.peer.name.slice(0, 1).toUpperCase()}</Text>
        </View>
        <Text style={styles.name} testID="call-peer">
          {c.peer.name}
        </Text>
        <Text style={styles.role}>
          {c.peer.name.toLowerCase() === role ? '' : `${role} · `}
          {t.calls.order(c.publicRef)}
        </Text>
        <Text style={styles.status} testID="call-status">
          {line}
        </Text>
      </View>
      <Text style={styles.note}>{t.calls.data}</Text>
      {incomingRinging ? (
        <View style={styles.row}>
          <Round
            label={t.calls.decline}
            color={colors.danger}
            onPress={() => void decline()}
            testID="call-decline"
          >
            <PhoneOff color="#fff" size={28} />
          </Round>
          <Round
            label={t.calls.accept}
            color={colors.brand}
            onPress={() => accept.mutate()}
            testID="call-accept"
          >
            <Phone color={colors.onBrand} size={28} />
          </Round>
        </View>
      ) : phase === 'over' ? null : (
        <View style={styles.row}>
          <Round
            label={muted ? t.calls.unmute : t.calls.mute}
            color={muted ? colors.text : colors.surfaceRaised}
            onPress={() => {
              setMuted(!muted);
              void session.current?.setMuted(!muted);
            }}
            testID="call-mute"
          >
            {muted ? (
              <MicOff color={colors.background} size={24} />
            ) : (
              <Mic color={colors.text} size={24} />
            )}
          </Round>
          <Round
            label={t.calls.hangUp}
            color={colors.danger}
            onPress={() => void hangUp()}
            testID="call-hang-up"
          >
            <PhoneOff color="#fff" size={28} />
          </Round>
          <Round
            label={speaker ? t.calls.earpiece : t.calls.speaker}
            color={speaker ? colors.text : colors.surfaceRaised}
            onPress={() => {
              setSpeaker(!speaker);
              void session.current?.setSpeaker(!speaker);
            }}
            testID="call-speaker"
          >
            <Volume2 color={speaker ? colors.background : colors.text} size={24} />
          </Round>
        </View>
      )}
    </SafeAreaView>
  );
}

function Round({
  label,
  color,
  onPress,
  children,
  testID,
}: {
  label: string;
  color: string;
  onPress: () => void;
  children: React.ReactNode;
  testID: string;
}) {
  return (
    <View style={styles.roundBox}>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={label}
        style={({ pressed }) => [
          styles.round,
          { backgroundColor: color },
          pressed && styles.pressed,
        ]}
        testID={testID}
      >
        {children}
      </Pressable>
      <Text style={styles.roundLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background, justifyContent: 'space-between' },
  top: { alignItems: 'center', gap: space.sm, paddingTop: space.xl * 2 },
  avatar: {
    width: 104,
    height: 104,
    borderRadius: 52,
    backgroundColor: colors.brandSoft,
    borderWidth: 2,
    borderColor: colors.brandBorder,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space.md,
  },
  initial: { color: colors.brand, fontSize: 44, fontWeight: '800' },
  name: { color: colors.text, fontSize: 26, fontWeight: '800', textAlign: 'center' },
  role: { color: colors.muted, fontSize: font.body },
  status: { color: colors.waiting, fontSize: font.body, fontWeight: '700', marginTop: space.sm },
  note: {
    color: colors.faint,
    fontSize: font.small,
    textAlign: 'center',
    paddingHorizontal: space.xl,
  },
  row: { flexDirection: 'row', justifyContent: 'space-evenly', paddingBottom: space.xl * 1.5 },
  roundBox: { alignItems: 'center', gap: space.sm, width: 96 },
  round: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { opacity: 0.8 },
  roundLabel: { color: colors.muted, fontSize: font.small, textAlign: 'center' },
});
