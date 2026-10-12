"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { ApiError, errorMessage, onSessionChange, refreshSession, setSession } from "@/api/client";
import type { UserDto } from "@/api/contracts";
import { authApi } from "@/api/endpoints";

/* ───────────────────────────── Cache de consultas ───────────────────────────── */

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 15_000,
        // Erros do cliente (4xx) não melhoram repetindo; falhas de rede/5xx tentam mais uma vez
        retry: (count, error) => !(error instanceof ApiError && error.status < 500) && count < 1,
      },
      mutations: { retry: false },
    },
  });
}

/* ───────────────────────────── Sessão ───────────────────────────── */

export type AuthState =
  | { status: "loading" }
  | { status: "anonymous"; expired: boolean }
  | { status: "authenticated"; user: UserDto }
  /** Não foi possível verificar a sessão (rede, servidor ou limite de requisições) */
  | { status: "unavailable"; message: string };

interface AuthApi {
  state: AuthState;
  login: (email: string, password: string) => Promise<UserDto>;
  register: (name: string, email: string, password: string) => Promise<UserDto>;
  logout: () => Promise<void>;
  /** Tenta restaurar a sessão de novo após uma falha transitória */
  retry: () => void;
  /** Restaura a sessão (uma vez) nas telas que dependem dela; a landing e o link público não chamam */
  ensure: () => void;
}

const AuthContext = createContext<AuthApi | null>(null);

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth precisa estar dentro de <AppProviders>");
  return ctx;
}

/** Sessão para telas que dependem dela: dispara a restauração na primeira montagem. */
export function useSession() {
  const ctx = useAuth();
  const { ensure } = ctx;
  useEffect(() => ensure(), [ensure]);
  return ctx;
}

export function AppProviders({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(makeQueryClient);
  const [state, setState] = useState<AuthState>({ status: "loading" });

  const restore = useCallback(() => {
    refreshSession().catch((e) =>
      setState({ status: "unavailable", message: errorMessage(e, "Não foi possível verificar sua sessão.") }),
    );
  }, []);
  const retry = useCallback(() => {
    setState({ status: "loading" });
    restore();
  }, [restore]);

  useEffect(() => {
    const off = onSessionChange((session, reason) => {
      if (session) {
        setState({ status: "authenticated", user: session.user });
        return;
      }
      // Sessão encerrada (logout ou expiração): cancela polling e descarta dados privados
      void queryClient.cancelQueries();
      queryClient.clear();
      setState({ status: "anonymous", expired: reason === "expired" });
    });
    return () => {
      off();
    };
  }, [queryClient]);

  const started = useRef(false);
  const ensure = useCallback(() => {
    if (started.current) return;
    started.current = true;
    // Restaura a sessão a partir do cookie httpOnly (o access token só existe em memória)
    restore();
  }, [restore]);

  const login = useCallback(async (email: string, password: string) => {
    const session = await authApi.login({ email, password });
    queryClient.clear();
    setSession(session, "login");
    return session.user;
  }, [queryClient]);

  const register = useCallback(async (name: string, email: string, password: string) => {
    const session = await authApi.register({ name, email, password });
    queryClient.clear();
    setSession(session, "login");
    return session.user;
  }, [queryClient]);

  const logout = useCallback(async () => {
    try {
      await authApi.logout();
    } finally {
      // Mesmo sem resposta do servidor, a sessão local é descartada
      setSession(null, "logout");
    }
  }, []);

  const api = useMemo(() => ({ state, login, register, logout, retry, ensure }), [state, login, register, logout, retry, ensure]);

  return (
    <QueryClientProvider client={queryClient}>
      <AuthContext.Provider value={api}>{children}</AuthContext.Provider>
    </QueryClientProvider>
  );
}

/** Aceita só caminhos internos como destino após o login (evita redirecionamento aberto). */
export function safeNext(next: string | null | undefined, fallback = "/app") {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return fallback;
  return next;
}
