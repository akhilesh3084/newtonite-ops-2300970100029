const TOKEN_KEY = 'ops_token';

export type ApiError = {
  status: number;
  code: string;
  message: string;
  details?: unknown;
};

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export async function api<T>(
  path: string,
  options: RequestInit & { idempotencyKey?: string } = {},
): Promise<T> {
  const headers = new Headers(options.headers);
  if (!headers.has('Content-Type') && options.body) {
    headers.set('Content-Type', 'application/json');
  }
  const token = getToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (options.idempotencyKey) {
    headers.set('Idempotency-Key', options.idempotencyKey);
  }

  const res = await fetch(path, { ...options, headers });
  const json = await res.json().catch(() => ({}));

  if (res.status === 401) {
    setToken(null);
    if (!path.includes('/auth/login')) {
      window.location.href = '/login';
    }
  }

  if (!res.ok || json.success === false) {
    const err: ApiError = {
      status: res.status,
      code: json?.error?.code ?? 'INTERNAL_ERROR',
      message: json?.error?.message ?? 'Request failed',
      details: json?.error?.details,
    };
    throw err;
  }

  return json.data as T;
}
