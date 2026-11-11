import { Component, type ReactNode } from 'react';

/**
 * Keeps one page's error from blanking the whole portal: the menu stays, and the page says so in
 * plain words with a way to try again. Nothing is retried or sent; the error is only logged.
 * Changing page clears it (the boundary is keyed by the address).
 */
export class PageErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override componentDidCatch(error: unknown): void {
    console.error('page error', error);
  }

  override render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="page page--narrow">
        <div className="notice" role="alert">
          <p>This page hit a problem. Nothing has changed; this is only the view.</p>
          <button className="button" type="button" onClick={() => window.location.reload()}>
            Reload
          </button>
        </div>
      </div>
    );
  }
}
