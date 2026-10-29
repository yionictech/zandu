import AsyncStorage from '@react-native-async-storage/async-storage';
import type { User } from '@zandu/api-client';
import {
  createDemoState,
  DEMO_ACCOUNTS,
  DemoApi,
  type DemoState,
  type EngineDeps,
} from '@zandu/demo';
import { randomUUID } from 'expo-crypto';
import { API_URL, DEMO } from './config';

/**
 * Démonstration locale (EXPO_PUBLIC_DEMO=1, docs/exploitation/demo-locale.md) : l'application
 * répond elle-même aux appels de l'API avec des données fictives gardées sur le téléphone
 * (@zandu/demo). Aucun serveur, aucune donnée réelle, aucun argent.
 */
const KEY = 'zandu.demo.v1';
const deps: EngineDeps = { now: () => new Date(), newId: () => randomUUID(), random: Math.random };
let engine: DemoApi | null = null;
let saving: ReturnType<typeof setTimeout> | null = null;

function api(): DemoApi {
  engine ??= new DemoApi(createDemoState(deps), deps);
  return engine;
}

/** Relit la démonstration enregistrée (ou la crée) avant le premier écran. */
export async function loadDemo(): Promise<void> {
  if (!DEMO) return;
  try {
    const raw = await AsyncStorage.getItem(KEY);
    const saved = raw ? (JSON.parse(raw) as DemoState) : null;
    engine = new DemoApi(saved?.version === 1 ? saved : createDemoState(deps), deps);
  } catch {
    engine = new DemoApi(createDemoState(deps), deps);
  }
}

/** Enregistre la démonstration : tout de suite après une action, un peu plus tard après une lecture. */
function save(now = false): void {
  if (saving) clearTimeout(saving);
  saving = null;
  const write = () =>
    void AsyncStorage.setItem(KEY, JSON.stringify(api().state)).catch(() => undefined);
  if (now) write();
  else saving = setTimeout(write, 300);
}

/** Remet toutes les données de démonstration dans leur état de départ. */
export async function resetDemo(): Promise<void> {
  engine = new DemoApi(createDemoState(deps), deps);
  await AsyncStorage.setItem(KEY, JSON.stringify(engine.state)).catch(() => undefined);
}

/** Les appels destinés à l'API sont traités dans le téléphone. */
export async function demoFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const request = input instanceof Request ? input : null;
  const url = new URL(
    typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
  );
  const method = (init?.method ?? request?.method ?? 'GET').toUpperCase();
  const headers = new Headers(init?.headers ?? request?.headers);
  const raw =
    init?.body ?? (request && method !== 'GET' && method !== 'HEAD' ? await request.text() : null);
  let body: unknown = null;
  if (typeof raw === 'string' && raw) {
    try {
      body = JSON.parse(raw);
    } catch {
      body = null;
    }
  }
  const token = headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? null;
  const path = url.href.startsWith(API_URL)
    ? url.href.slice(API_URL.length).split('?')[0]!
    : url.pathname;
  const result = api().handle({ method, path, query: url.searchParams, token, body });
  // Même une lecture peut faire avancer la démonstration (PIN validé, délai écoulé) : on enregistre.
  save(method !== 'GET');
  // Un vrai réseau n'est jamais instantané : un court délai garde les écrans d'attente visibles.
  await new Promise((resolve) => setTimeout(resolve, 120));
  return result.status === 204 || result.body === null
    ? new Response(null, { status: result.status })
    : new Response(JSON.stringify(result.body), {
        status: result.status,
        headers: { 'content-type': 'application/json' },
      });
}

/** Photo choisie dans la démonstration : gardée sur le téléphone, rattachée à la réservation. */
export function registerDemoUpload(uploadId: string, uri: string): void {
  api().state.uploads[uploadId] = uri;
  save(true);
}

export type DemoRole = keyof typeof DEMO_ACCOUNTS;
export const DEMO_ROLES = DEMO_ACCOUNTS;

/** Entrer dans la démonstration avec l'un des comptes fictifs, sans code SMS. */
export function demoSignIn(role: DemoRole): { token: string; user: User } {
  const engine = api();
  const user = engine.state.users.find((u) => u.phone === DEMO_ACCOUNTS[role].phone)!;
  const token = engine.signIn(user);
  save(true);
  return { token, user: engine.userView(user) };
}
