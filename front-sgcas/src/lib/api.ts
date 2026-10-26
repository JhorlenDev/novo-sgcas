"use client";

type ApiOptions = RequestInit & {
  skipAuthRedirect?: boolean;
};

const logoutMarker = "sgcas-logged-out";

function getCsrfToken(): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(/(?:^|;\s*)csrftoken=([^;]*)/);
  return match ? decodeURIComponent(match[1]) : null;
}

export class ApiError extends Error {
  status: number;
  data: unknown;

  constructor(status: number, data: unknown) {
    const detail = data && typeof data === "object"
      ? (data as Record<string, unknown>).detalhe ?? (data as Record<string, unknown>).detail
      : data;
    super(typeof detail === "string" ? detail : `Erro ${status}`);
    this.status = status;
    this.data = data;
  }
}

export function clearLogoutMarker() {
  window.localStorage.removeItem(logoutMarker);
}

export function markLoggedOut() {
  window.localStorage.setItem(logoutMarker, "true");
}

export function isMarkedLoggedOut() {
  return window.localStorage.getItem(logoutMarker) === "true";
}

function redirectToLogin() {
  if (window.location.pathname !== "/login") {
    window.location.replace("/login");
  }
}

export async function api<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const method = (options.method ?? "GET").toUpperCase();
  const isMutating = method !== "GET" && method !== "HEAD";

  // Com FormData (envio de arquivo) o navegador define o Content-Type sozinho,
  // com a fronteira do multipart; forçar JSON aqui quebraria o envio.
  const isForm = typeof FormData !== "undefined" && options.body instanceof FormData;
  const headers: Record<string, string> = {
    ...(isForm ? {} : { "Content-Type": "application/json" }),
    ...options.headers as Record<string, string>,
  };

  if (isMutating) {
    const csrf = getCsrfToken();
    if (csrf) {
      headers["X-CSRFToken"] = csrf;
    }
  }

  const response = await fetch(`/api${path}`, {
    ...options,
    credentials: "include",
    headers,
  });

  const text = await response.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    throw new ApiError(response.status, "O servidor retornou uma resposta inválida. Tente novamente.");
  }

  if (!response.ok) {
    if (response.status === 401 && !options.skipAuthRedirect) {
      redirectToLogin();
    }
    throw new ApiError(response.status, data);
  }

  return data as T;
}

export function loginWithTefeCidadao() {
  clearLogoutMarker();
  window.location.href = "/api/auth/keycloak/login";
}
