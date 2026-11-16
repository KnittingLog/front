import { API_BASE_URL, API_TIMEOUT_MS } from './config';
import { getToken } from './token';

export type ApiErrorKind = 'network' | 'timeout' | 'http';

export class ApiError extends Error {
  constructor(
    readonly kind: ApiErrorKind,
    message: string,
    /** HTTP 상태 코드 (서버에 닿지 못했으면 0) */
    readonly status = 0,
    /** 서버가 보낸 에러 본문 */
    readonly body?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

type QueryValue = string | number | boolean | null | undefined;

export interface RequestOptions {
  query?: Record<string, QueryValue>;
  /** 객체는 JSON으로, FormData는 그대로(파일 업로드) 보낸다 */
  body?: unknown;
  headers?: Record<string, string>;
  /** false면 Authorization 헤더를 붙이지 않는다 (로그인·회원가입) */
  auth?: boolean;
  timeoutMs?: number;
  signal?: AbortSignal;
}

let onUnauthorized: (() => void) | undefined;

/** 401(토큰 만료 등)을 받았을 때 할 일 — 보통 로그아웃 처리 */
export function setUnauthorizedHandler(handler: (() => void) | undefined) {
  onUnauthorized = handler;
}

function buildUrl(path: string, query?: RequestOptions['query']) {
  const url = /^https?:\/\//.test(path) ? path : `${API_BASE_URL}${path.startsWith('/') ? '' : '/'}${path}`;
  const params = Object.entries(query ?? {})
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  if (params.length === 0) return url;
  return `${url}${url.includes('?') ? '&' : '?'}${params.join('&')}`;
}

/** 서버 에러 본문에서 사람이 읽을 메시지를 꺼낸다 ({detail}, {message}, {error} 형태 지원) */
function errorMessage(status: number, body: unknown) {
  if (typeof body === 'string' && body) return body;
  if (body && typeof body === 'object') {
    const b = body as Record<string, unknown>;
    for (const key of ['detail', 'message', 'error']) {
      if (typeof b[key] === 'string') return b[key];
    }
  }
  return `요청에 실패했어요 (${status})`;
}

async function parseBody(res: Response): Promise<unknown> {
  if (res.status === 204) return undefined;
  const text = await res.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export async function request<T = unknown>(method: string, path: string, options: RequestOptions = {}): Promise<T> {
  const { query, body, auth = true, timeoutMs = API_TIMEOUT_MS, signal } = options;

  const headers: Record<string, string> = { Accept: 'application/json', ...options.headers };
  const isForm = typeof FormData !== 'undefined' && body instanceof FormData;
  // FormData는 fetch가 boundary를 포함한 Content-Type을 직접 붙인다
  if (body !== undefined && !isForm) headers['Content-Type'] = 'application/json';
  if (auth) {
    const token = await getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const abort = () => controller.abort();
  if (signal?.aborted) abort();
  signal?.addEventListener('abort', abort);

  try {
    let res: Response;
    try {
      res = await fetch(buildUrl(path, query), {
        method,
        headers,
        body: body === undefined ? undefined : isForm ? (body as FormData) : JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (e) {
      if (timedOut) throw new ApiError('timeout', '서버 응답이 너무 늦어요. 잠시 후 다시 시도해 주세요.');
      // 호출한 쪽에서 직접 취소한 경우는 그대로 넘긴다
      if (signal?.aborted) throw e;
      throw new ApiError('network', '서버에 연결할 수 없어요. 네트워크 상태를 확인해 주세요.');
    }

    const data = await parseBody(res);
    if (!res.ok) {
      if (res.status === 401 && auth) onUnauthorized?.();
      throw new ApiError('http', errorMessage(res.status, data), res.status, data);
    }
    return data as T;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}

type BodylessOptions = Omit<RequestOptions, 'body'>;

export const api = {
  get: <T = unknown>(path: string, options?: BodylessOptions) => request<T>('GET', path, options),
  post: <T = unknown>(path: string, body?: unknown, options?: BodylessOptions) =>
    request<T>('POST', path, { ...options, body }),
  put: <T = unknown>(path: string, body?: unknown, options?: BodylessOptions) =>
    request<T>('PUT', path, { ...options, body }),
  patch: <T = unknown>(path: string, body?: unknown, options?: BodylessOptions) =>
    request<T>('PATCH', path, { ...options, body }),
  delete: <T = unknown>(path: string, options?: BodylessOptions) => request<T>('DELETE', path, options),
};

/** 백엔드에 닿는지만 확인한다 (응답 코드와 무관하게 응답이 오면 true) */
export async function pingServer(path = '/') {
  try {
    await request('GET', path, { auth: false, timeoutMs: 3000 });
    return true;
  } catch (e) {
    return e instanceof ApiError && e.kind === 'http';
  }
}
