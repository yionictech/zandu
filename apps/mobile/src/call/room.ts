import { Room, RoomEvent } from 'livekit-client';

export interface CallEvents {
  /** L'autre personne est dans la salle (true) ou l'a quittée (false). */
  onPeer: (present: boolean) => void;
  /** Connexion perdue et en cours de reprise (true), ou rétablie (false). */
  onReconnecting: (reconnecting: boolean) => void;
  /** Appel coupé (réseau perdu pour de bon, salle fermée). */
  onDisconnected: () => void;
}

export interface CallSession {
  setMuted: (muted: boolean) => Promise<unknown>;
  setSpeaker: (on: boolean) => Promise<unknown>;
  leave: () => Promise<void>;
}

/** Salle LiveKit en audio seul (pas de vidéo : économise les données mobiles). */
export async function joinRoom(
  access: { url: string; token: string },
  events: CallEvents,
): Promise<CallSession> {
  const room = new Room({ adaptiveStream: false, dynacast: false });
  room
    .on(RoomEvent.ParticipantConnected, () => events.onPeer(true))
    .on(RoomEvent.ParticipantDisconnected, () => events.onPeer(room.remoteParticipants.size > 0))
    .on(RoomEvent.Reconnecting, () => events.onReconnecting(true))
    .on(RoomEvent.Reconnected, () => events.onReconnecting(false))
    .on(RoomEvent.Disconnected, () => events.onDisconnected());
  await room.connect(access.url, access.token, { autoSubscribe: true });
  await room.localParticipant.setMicrophoneEnabled(true);
  if (room.remoteParticipants.size > 0) events.onPeer(true);
  return {
    setMuted: (muted) => room.localParticipant.setMicrophoneEnabled(!muted),
    setSpeaker: async () => {},
    leave: async () => {
      room.removeAllListeners();
      await room.disconnect();
    },
  };
}
