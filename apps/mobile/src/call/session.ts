import { AndroidAudioTypePresets, AudioSession, registerGlobals } from '@livekit/react-native';
import { Platform } from 'react-native';
import { joinRoom, type CallEvents, type CallSession } from './room';

let ready = false;

/** WebRTC natif : à appeler une fois au démarrage de l'application. */
export function setupCalls(): void {
  if (ready) return;
  registerGlobals();
  ready = true;
}

/**
 * Rejoint la salle de l'appel, micro ouvert, son dans l'écouteur (haut-parleur au choix), comme
 * un appel téléphonique.
 */
export async function joinCall(
  access: { url: string; token: string },
  events: CallEvents,
): Promise<CallSession> {
  setupCalls();
  await AudioSession.configureAudio({
    android: {
      preferredOutputList: ['headset', 'bluetooth', 'earpiece', 'speaker'],
      audioTypeOptions: AndroidAudioTypePresets.communication,
    },
    ios: { defaultOutput: 'earpiece' },
  });
  await AudioSession.startAudioSession();
  try {
    const session = await joinRoom(access, events);
    return {
      ...session,
      setSpeaker: (on) =>
        AudioSession.selectAudioOutput(
          on
            ? Platform.OS === 'ios'
              ? 'force_speaker'
              : 'speaker'
            : Platform.OS === 'ios'
              ? 'default'
              : 'earpiece',
        ),
      leave: async () => {
        await session.leave();
        await AudioSession.stopAudioSession();
      },
    };
  } catch (error) {
    await AudioSession.stopAudioSession();
    throw error;
  }
}
