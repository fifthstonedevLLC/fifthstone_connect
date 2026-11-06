import type { ReactNode } from 'react';
import { NavLink } from 'react-router';
import { serviceLabel } from './format';
import { Icon, type IconName } from './icons';
import type { Me, ServiceState } from './types';

/** Screens not built yet are listed but disabled, with a reason, rather than hidden. */
const NAV: { label: string; icon: IconName; to?: string }[] = [
  { label: 'Today', icon: 'today', to: '/' },
  { label: 'Leads', icon: 'leads' },
  { label: 'Calendar', icon: 'calendar' },
  { label: 'Templates & AI', icon: 'templates', to: '/templates' },
  { label: 'Settings', icon: 'settings' },
];

function ServiceRow({
  label,
  state,
}: {
  label: string;
  state: ServiceState | 'connected' | 'revoked' | 'disconnected';
}) {
  const live = state === 'approved' || state === 'connected';
  const text =
    state === 'connected'
      ? 'Connected'
      : state === 'revoked'
        ? 'Reconnect needed'
        : state === 'disconnected'
          ? 'Not connected'
          : serviceLabel(state);
  return (
    <li className="service">
      <Icon
        name={live ? 'check' : 'clock'}
        size={16}
        className={live ? 'service__icon--live' : 'service__icon'}
      />
      <span>{label}</span>
      <span className="service__state">{text}</span>
    </li>
  );
}

export function Shell({
  me,
  onSignOut,
  children,
}: {
  me: Me;
  onSignOut: () => void;
  children: ReactNode;
}) {
  const initials = me.displayName
    .split(/\s+/)
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="shell">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <aside className="sidebar" aria-label="Sidebar">
        <div className="brand">
          <span className="brand__tile">
            <img src="/fifth-stone-dev-icon.png" alt="" width={427} height={355} />
          </span>
          <span className="brand__text">
            <span className="brand__name">Fifth Stone Connect</span>
            <span className="brand__sub">{me.tenant.name}</span>
          </span>
        </div>

        <nav aria-label="Portal">
          <ul className="nav">
            {NAV.map((item) =>
              item.to ? (
                <li key={item.label}>
                  <NavLink to={item.to} end className="nav__link">
                    <Icon name={item.icon} />
                    {item.label}
                  </NavLink>
                </li>
              ) : (
                <li key={item.label}>
                  <span className="nav__link nav__link--soon" aria-disabled="true">
                    <Icon name={item.icon} />
                    {item.label}
                    <span className="nav__soon">Soon</span>
                  </span>
                </li>
              ),
            )}
          </ul>
        </nav>

        <div className="sidebar__footer">
          <h2 className="sidebar__heading">Services</h2>
          <ul className="services">
            <ServiceRow label="Texting" state={me.services.texting} />
            <ServiceRow label="Email" state={me.services.email} />
            <ServiceRow label="Calendar" state={me.calendar?.status ?? 'disconnected'} />
          </ul>
          <div className="account">
            <span className="account__avatar" aria-hidden="true">
              {initials}
            </span>
            <span className="account__text">
              <span className="account__name">{me.displayName}</span>
              <span className="account__role">{me.role === 'owner' ? 'Owner' : 'Staff'}</span>
            </span>
            <button className="icon-button" type="button" onClick={onSignOut} aria-label="Sign out">
              <Icon name="signOut" />
            </button>
          </div>
        </div>
      </aside>
      <main id="main" className="main" tabIndex={-1}>
        {children}
      </main>
    </div>
  );
}
