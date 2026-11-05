/** Calls apps/api with the signed-in user's access token. */

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(`API ${status}: ${code}`);
  }
}

export function apiGet<T>(path: string, accessToken: string): Promise<T> {
  return request<T>(path, accessToken, { method: 'GET' });
}

export function apiPost<T>(path: string, accessToken: string, body: unknown): Promise<T> {
  return request<T>(path, accessToken, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function request<T>(path: string, accessToken: string, init: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      ...init,
      headers: { ...init.headers, authorization: `Bearer ${accessToken}` },
    });
  } catch {
    throw new ApiError(0, 'network');
  }
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new ApiError(response.status, body.error ?? 'error');
  }
  return (await response.json()) as T;
}
