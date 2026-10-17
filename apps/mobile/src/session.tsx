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
import { api, bindSession, queryClient, unwrap } from './api';
import { secureStorage } from './storage';

const TOKEN_KEY = 'zandu.session';

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
    await secureStorage.remove(TOKEN_KEY);
    if (hadToken) queryClient.clear();
  }, [token]);

  useEffect(() => {
    bindSession(token, () => void signOut());
  }, [token, signOut]);

  // Au démarrage : reprendre la session enregistrée et vérifier qu'elle est toujours valide.
  useEffect(() => {
    void (async () => {
      const saved = await secureStorage.get(TOKEN_KEY);
      if (saved) {
        bindSession(saved, () => undefined);
        try {
          setUser(unwrap(await api.GET('/v1/me')));
          setToken(saved);
        } catch {
          await secureStorage.remove(TOKEN_KEY);
          bindSession(null, () => undefined);
        }
      }
      setReady(true);
    })();
  }, []);

  const signIn = useCallback(async (newToken: string, newUser: User) => {
    await secureStorage.set(TOKEN_KEY, newToken);
    bindSession(newToken, () => undefined);
    setToken(newToken);
    setUser(newUser);
  }, []);

  const refresh = useCallback(async () => {
    setUser(unwrap(await api.GET('/v1/me')));
  }, []);

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
