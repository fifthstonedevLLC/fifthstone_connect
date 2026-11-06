import { useCallback, useEffect, useState } from 'react';
import { ApiError, apiGet } from './api';

export type ApiState<T> =
  { status: 'loading' } | { status: 'ready'; data: T } | { status: 'error'; error: ApiError };

/**
 * Loads an API path for the signed-in user. Shows exactly what the server returned: there is no
 * cached or optimistic copy (decision 24). `reload` fetches again.
 */
export function useApi<T>(path: string, accessToken: string) {
  const [state, setState] = useState<ApiState<T>>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    apiGet<T>(path, accessToken).then(
      (data) => !cancelled && setState({ status: 'ready', data }),
      (error: unknown) =>
        !cancelled &&
        setState({
          status: 'error',
          error: error instanceof ApiError ? error : new ApiError(0, 'unexpected'),
        }),
    );
    return () => {
      cancelled = true;
    };
  }, [path, accessToken, attempt]);

  const reload = useCallback(() => {
    setState({ status: 'loading' });
    setAttempt((n) => n + 1);
  }, []);

  /** Show a response the server just returned (after an action), without fetching again. */
  const replace = useCallback((data: T) => setState({ status: 'ready', data }), []);

  return [state, reload, replace] as const;
}
