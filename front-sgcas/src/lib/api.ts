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

/**
 * O texto de um erro da API para mostrar ao usuário: o `detalhe` quando há, senão a
 * primeira mensagem de campo (`{ campo: "mensagem" }` ou `{ campo: ["mensagem"] }`).
 */
export function mensagemDaApi(error: unknown, padrao: string): string {
  if (!(error instanceof ApiError)) return padrao;
  if (error.data && typeof error.data === "object") {
    const corpo = error.data as Record<string, unknown>;
    if (typeof corpo.detalhe === "string" && corpo.detalhe) return corpo.detalhe;
    for (const valor of Object.values(corpo)) {
      const texto = Array.isArray(valor) ? valor[0] : valor;
      if (typeof texto === "string" && texto) return texto;
    }
  }
  return error.message && !/^Erro \d+$/.test(error.message) ? error.message : padrao;
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

/**
 * Leitura que não derruba a tela: se falhar, devolve `padrao`.
 *
 * Antes, cada tela fazia `.catch(() => [])`, e uma falha de rede, um erro do servidor
 * ou uma rota errada viravam uma lista vazia, igual a "não há nada". Agora a falha é
 * passada a `aoFalhar`, para a tela avisar. Duas respostas continuam silenciosas:
 * 403, porque é o perfil que não vê aquele dado (o coordenador abre Usuários, mas os
 * pedidos de acesso são só do administrador), e 401, que o `api` já leva ao login.
 */
export async function lerOuPadrao<T>(
  caminho: string,
  padrao: T,
  aoFalhar: (erro: unknown) => void,
): Promise<T> {
  try {
    return await api<T>(caminho);
  } catch (erro) {
    if (!(erro instanceof ApiError && (erro.status === 401 || erro.status === 403))) {
      aoFalhar(erro);
    }
    return padrao;
  }
}

/** O aviso de uma carga que falhou, dizendo o quê: "os casos" ou "as unidades e os serviços". */
export function avisoDeCarga(oQueFalhou: string[]): string {
  if (oQueFalhou.length === 0) return "";
  const lista = oQueFalhou.length === 1
    ? oQueFalhou[0]
    : `${oQueFalhou.slice(0, -1).join(", ")} e ${oQueFalhou[oQueFalhou.length - 1]}`;
  return `Não foi possível carregar ${lista}. Atualize a página para tentar de novo.`;
}

export function loginWithTefeCidadao() {
  clearLogoutMarker();
  // Navegação completa de propósito: é a rota da API que redireciona ao Tefé Cidadão,
  // não uma página do Next, e o roteador do Next não a alcançaria.
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination
  window.location.href = "/api/auth/keycloak/login";
}
