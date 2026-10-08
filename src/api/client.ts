import type { ApiErrorBody, AuthResponseDto } from "./contracts";

/**
 * Cliente HTTP único do BoraAli. Centraliza URL base, autenticação, renovação de
 * sessão e o formato de erro da API ({ code, message, details, requestId }).
 *
 * Sessão (estratégia do backend):
 * - access token só em memória (nunca em localStorage/sessionStorage);
 * - refresh token em cookie httpOnly, enviado apenas para /auth/* com credentials: "include";
 * - um 401 dispara no máximo UMA renovação, compartilhada por requisições simultâneas.
 */

export const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3333/api/v1").replace(/\/+$/, "");

/** Erro devolvido pela API. Decida pelo `code`, nunca pela mensagem. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: Record<string, unknown> = {},
    readonly requestId?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** Falha de rede: servidor fora do ar, sem conexão, CORS. */
export class NetworkError extends Error {
  constructor() {
    super("Não foi possível falar com o servidor. Confira sua conexão e tente novamente.");
    this.name = "NetworkError";
  }
}

export const isApiError = (e: unknown, code?: string): e is ApiError =>
  e instanceof ApiError && (code === undefined || e.code === code);

/** Mensagem pronta para a interface a partir de qualquer erro. */
export function errorMessage(e: unknown, fallback = "Algo deu errado. Tente novamente.") {
  if (e instanceof ApiError || e instanceof NetworkError) return e.message;
  return fallback;
}

/* ───────────────────────────── Sessão em memória ───────────────────────────── */

type SessionListener = (session: AuthResponseDto | null, reason: "login" | "refresh" | "logout" | "expired") => void;

let accessToken: string | null = null;
let refreshing: Promise<AuthResponseDto | null> | null = null;
const listeners = new Set<SessionListener>();

export function onSessionChange(listener: SessionListener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emit(session: AuthResponseDto | null, reason: Parameters<SessionListener>[1]) {
  listeners.forEach((l) => l(session, reason));
}

export function setSession(session: AuthResponseDto | null, reason: Parameters<SessionListener>[1]) {
  accessToken = session?.accessToken ?? null;
  emit(session, reason);
}

export const hasAccessToken = () => accessToken !== null;

/**
 * Renova a sessão a partir do cookie. Chamadas simultâneas recebem a mesma
 * promessa; uma falha encerra a sessão (sem novas tentativas em laço).
 */
export function refreshSession(): Promise<AuthResponseDto | null> {
  if (!refreshing) {
    refreshing = (async () => {
      try {
        const res = await rawFetch("/auth/refresh", { method: "POST", credentials: "include" });
        if (res.status === 401) {
          // Cookie ausente, expirado ou revogado: a sessão acabou
          const hadSession = accessToken !== null;
          setSession(null, hadSession ? "expired" : "logout");
          return null;
        }
        // 429/5xx são transitórios: não encerram a sessão; quem chamou decide tentar de novo
        if (!res.ok) throw await toApiError(res);
        const session = (await res.json()) as AuthResponseDto;
        setSession(session, "refresh");
        return session;
      } finally {
        refreshing = null;
      }
    })();
  }
  return refreshing;
}

/* ───────────────────────────── Requisições ───────────────────────────── */

async function rawFetch(path: string, init: RequestInit) {
  try {
    return await fetch(`${API_URL}${path}`, init);
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") throw e;
    throw new NetworkError();
  }
}

async function toApiError(res: Response): Promise<ApiError> {
  let body: Partial<ApiErrorBody> = {};
  try {
    body = (await res.json()) as ApiErrorBody;
  } catch {
    /* corpo vazio ou não-JSON */
  }
  return new ApiError(
    res.status,
    body.code ?? (res.status >= 500 ? "INTERNAL_ERROR" : "UNKNOWN"),
    body.message ?? "Algo deu errado. Tente novamente.",
    body.details ?? {},
    body.requestId,
  );
}

export interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  /** false para rotas públicas: não envia token e não tenta renovar a sessão */
  auth?: boolean;
  /** Para /auth/*: envia o cookie de refresh */
  withCredentials?: boolean;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = "GET", body, auth = true, withCredentials, headers = {}, signal } = options;

  let usedToken: string | null = null;
  const send = () => {
    usedToken = auth ? accessToken : null;
    return rawFetch(path, {
      method,
      signal,
      cache: "no-store",
      credentials: withCredentials ? "include" : "omit",
      headers: {
        Accept: "application/json",
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(usedToken ? { Authorization: `Bearer ${usedToken}` } : {}),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  };
  const expired = () => new ApiError(401, "SESSION_EXPIRED", "Sua sessão expirou. Entre novamente.");

  // Sem token em memória (ex.: página recarregada): restaura pelo cookie antes de chamar
  let refreshed = false;
  if (auth && !accessToken) {
    refreshed = true;
    if (!(await refreshSession())) throw expired();
  }

  let res = await send();
  if (auth && res.status === 401) {
    const error = await toApiError(res);
    if (error.code !== "UNAUTHENTICATED") throw error;
    if (accessToken && accessToken !== usedToken) {
      // Outra requisição já renovou a sessão enquanto esta estava em andamento
    } else if (refreshed || !(await refreshSession())) {
      // Nunca renova duas vezes para a mesma requisição (evita laços)
      if (accessToken) setSession(null, "expired");
      throw expired();
    }
    res = await send();
  }

  if (!res.ok) throw await toApiError(res);
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}
