import { useCallback, useEffect, useState } from 'react';
import { ApiError, apiGet } from './api';

export type ApiState<T> =
  { status: 'loading' } | { status: 'ready'; data: T } | { status: 'error'; error: ApiError };

export interface ApiOptions {
  /**
   * Fetch again in the background this often (ms) while the tab is visible, and whenever it
   * becomes visible again, so work done elsewhere (the worker booking a lead, a teammate's
   * approval) shows up without a reload.
   */
  refreshEvery?: number;
}

/**
 * Loads an API path for the signed-in user. Shows exactly what the server returned: there is no
 * cached or optimistic copy (decision 24). `reload` fetches again from a loading state; `refresh`
 * fetches again while the current view stays on screen, and keeps it if the refresh fails.
 */
export function useApi<T>(path: string, accessToken: string, options: ApiOptions = {}) {
  const [state, setState] = useState<ApiState<T>>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const { refreshEvery } = options;

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

  /** Resolves to the fresh data, or null when the refresh failed. */
  const refresh = useCallback(async (): Promise<T | null> => {
    try {
      const data = await apiGet<T>(path, accessToken);
      setState({ status: 'ready', data });
      return data;
    } catch {
      // A background refresh that fails leaves the last confirmed view in place.
      return null;
    }
  }, [path, accessToken]);

  useEffect(() => {
    if (!refreshEvery) return;
    const tick = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    const timer = window.setInterval(tick, refreshEvery);
    document.addEventListener('visibilitychange', tick);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [refresh, refreshEvery]);

  /** Show a response the server just returned (after an action), without fetching again. */
  const replace = useCallback((data: T) => setState({ status: 'ready', data }), []);

  return [state, reload, replace, refresh] as const;
}
