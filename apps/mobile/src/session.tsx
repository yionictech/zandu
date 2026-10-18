import type { User } from '@zandu/api-client';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { onlineManager } from '@tanstack/react-query';
import { api, bindSession, isNetworkError, queryClient, unwrap } from './api';
import { forgetCache, persistCache, restoreCache } from './offlineCache';
import { loadJson, saveJson, secureStorage } from './storage';

const TOKEN_KEY = 'zandu.session';
/** Profil gardé pour ouvrir l'application sans réseau (nom, rôles ; rien de secret). */
const PROFILE_KEY = 'zandu.profile';

interface SessionValue {
  ready: boolean;
  user: User | null;
  signIn(token: string, user: User): Promise<void>;
  signOut(): Promise<void>;
  /** Relit le profil (rôles) : après l'ouverture d'une boutique, par exemple. */
  refresh(): Promise<void>;
}

const SessionContext = createContext<SessionValue | null>(null);

/** Session révocable (ADR-0008) : jeton opaque gardé dans le coffre chiffré du téléphone. */
export function SessionProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);

  const signOut = useCallback(async () => {
    const hadToken = token !== null;
    setToken(null);
    setUser(null);
    bindSession(null, () => undefined);
    await Promise.all([
      secureStorage.remove(TOKEN_KEY),
      saveJson(PROFILE_KEY, null),
      forgetCache(),
    ]);
    if (hadToken) queryClient.clear();
  }, [token]);

  useEffect(() => {
    bindSession(token, () => void signOut());
  }, [token, signOut]);

  // Au démarrage : reprendre la session enregistrée et vérifier qu'elle est toujours valide.
  // Sans réseau, elle est gardée telle quelle (seul un refus de l'API la ferme) et vérifiée au
  // retour du réseau ; les données enregistrées sur le téléphone sont reprises.
  useEffect(() => {
    void (async () => {
      const saved = await secureStorage.get(TOKEN_KEY);
      let account: User | null = null;
      if (saved) {
        bindSession(saved, () => undefined);
        try {
          account = unwrap(await api.GET('/v1/me'));
          void saveJson(PROFILE_KEY, account);
          setToken(saved);
        } catch (error) {
          if (isNetworkError(error)) {
            account = await loadJson<User | null>(PROFILE_KEY, null);
            setToken(saved);
          } else {
            await secureStorage.remove(TOKEN_KEY);
            bindSession(null, () => undefined);
          }
        }
      }
      await restoreCache(queryClient, account?.id ?? null);
      setUser(account);
      setReady(true);
    })();
  }, []);

  // La copie enregistrée suit le compte connecté.
  useEffect(() => {
    if (!ready) return;
    return persistCache(queryClient, user?.id ?? null);
  }, [ready, user?.id]);

  const signIn = useCallback(async (newToken: string, newUser: User) => {
    await secureStorage.set(TOKEN_KEY, newToken);
    void saveJson(PROFILE_KEY, newUser);
    bindSession(newToken, () => undefined);
    setToken(newToken);
    setUser(newUser);
  }, []);

  const refresh = useCallback(async () => {
    const account = unwrap(await api.GET('/v1/me'));
    void saveJson(PROFILE_KEY, account);
    setUser(account);
  }, []);

  // Session reprise sans réseau : vérifiée dès que l'API répond (une session révoquée se ferme).
  useEffect(() => {
    if (!token) return;
    return onlineManager.subscribe((online) => {
      if (online) refresh().catch(() => undefined);
    });
  }, [token, refresh]);

  const value = useMemo(
    () => ({ ready, user, signIn, signOut, refresh }),
    [ready, user, signIn, signOut, refresh],
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession hors de SessionProvider');
  return value;
}
