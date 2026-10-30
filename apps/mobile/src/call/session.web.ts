import { joinRoom, type CallEvents, type CallSession } from './room';

/** Navigateur : WebRTC est déjà là. */
export function setupCalls(): void {}

export function joinCall(
  access: { url: string; token: string },
  events: CallEvents,
): Promise<CallSession> {
  return joinRoom(access, events);
}
