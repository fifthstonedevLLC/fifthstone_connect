import { useState } from 'react';
import { ApiError, apiPut } from './api';
import { formatPhone } from './format';
import type { BusinessSettings, Capability, Me } from './types';
import { useApi } from './useApi';

/**
 * Settings (Iteration 1, ROADMAP.md): who is on the team, what staff can do (decision 40),
 * replies in your own words (decision 39) and when a lead goes to Act now (decision 37). Everyone
 * can read it; only the owner changes it, and the server checks that too. The page shows what the
 * server confirmed (decision 24).
 */

const CAPABILITY_TEXT: Record<Capability, { label: string; detail: string }> = {
  act_on_leads: {
    label: 'Act on contacts',
    detail: 'Approve times, suggest another time, nudge and close.',
  },
  reply_templates: {
    label: 'Reply with templates',
    detail: 'Send the reply templates you approved.',
  },
  reply_free_text: {
    label: 'Reply in their own words',
    detail: 'Type their own replies, where you switch that on below.',
  },
  edit_templates: {
    label: 'Edit templates and AI instructions',
    detail: 'Change the wording customers get and what the AI asks.',
  },
};
const CAPABILITY_ORDER: Capability[] = [
  'act_on_leads',
  'reply_templates',
  'reply_free_text',
  'edit_templates',
];

const ACT_NOW_CHOICES = [2, 4, 8, 12, 24, 48, 72];
const hoursLabel = (h: number) =>
  h === 24 ? '1 day' : h % 24 === 0 ? `${h / 24} days` : h === 1 ? '1 hour' : `${h} hours`;

const ERROR: Record<string, string> = {
  owner_only: 'Only the owner can change settings.',
  owner_stays_active: 'The owner always keeps access.',
  not_found: 'That person is no longer on your team. The latest team is shown.',
  network: "We couldn't reach the server. Nothing was saved; try again.",
};

export function BusinessSettingsPage({ accessToken }: { me: Me; accessToken: string }) {
  const [settings, reload, replace] = useApi<BusinessSettings>('/portal/business', accessToken);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function save(path: string, body: unknown, done: string) {
    setBusy(true);
    setMessage(null);
    try {
      replace(await apiPut<BusinessSettings>(`/portal/business/${path}`, accessToken, body));
      setMessage({ ok: true, text: done });
    } catch (e) {
      const code = e instanceof ApiError ? e.code : 'error';
      setMessage({ ok: false, text: ERROR[code] ?? "That didn't save. Try again." });
      if (e instanceof ApiError && e.status === 409) reload();
    } finally {
      setBusy(false);
    }
  }

  if (settings.status === 'loading') {
    return (
      <p className="page__note" role="status">
        Loading settings…
      </p>
    );
  }
  if (settings.status === 'error') {
    return (
      <div className="notice" role="alert">
        <p>We couldn't load settings. Nothing has changed.</p>
        <button className="button" type="button" onClick={reload}>
          Try again
        </button>
      </div>
    );
  }
  const data = settings.data;
  const props = { data, save, busy };

  return (
    <div className="page">
      <header className="page__header">
        <h1 className="page__title">Settings</h1>
        <p className="page__lede">Your team, what they can do, and how the Front Desk works.</p>
      </header>
      {!data.canEdit && (
        <p className="notice">Only the owner can change settings. You can read them here.</p>
      )}
      {message && (
        <p className={message.ok ? 'meta' : 'form-error'} role={message.ok ? 'status' : 'alert'}>
          {message.text}
        </p>
      )}
      <div className="settings-sections">
        <TeamSection {...props} />
        <PermissionsSection key={data.staffCapabilities.join(',')} {...props} />
        <FreeTextSection {...props} />
        <ActNowSection key={data.actNowAfterHours} {...props} />
      </div>
    </div>
  );
}

type SectionProps = {
  data: BusinessSettings;
  save: (path: string, body: unknown, done: string) => Promise<void>;
  busy: boolean;
};

function TeamSection({ data, save, busy }: SectionProps) {
  return (
    <section className="setup-card" aria-labelledby="team-title">
      <h2 id="team-title" className="setup-card__title">
        Team
      </h2>
      <ul className="team-list">
        {data.team.map((p) => (
          <li key={p.id} className="team-row settings-person">
            <div>
              <p>
                <strong>{p.name}</strong> · {p.role === 'owner' ? 'Owner' : 'Staff'}
                {p.approvesRequests ? ' · Approves requests' : ''}
                {!p.active ? ' · Access off' : ''}
              </p>
              <p className="meta">{p.mobile ? formatPhone(p.mobile) : 'No mobile on file'}</p>
            </div>
            {data.canEdit && p.role === 'staff' && (
              <button
                className="button"
                type="button"
                disabled={busy}
                onClick={() =>
                  void save(
                    `team/${p.id}`,
                    { active: !p.active },
                    p.active ? `${p.name} can no longer sign in.` : `${p.name} can sign in again.`,
                  )
                }
              >
                {p.active ? 'Turn off access' : 'Turn access back on'}
              </button>
            )}
          </li>
        ))}
      </ul>
      <p className="meta">
        To add someone, ask Fifth Stone Dev; they send them a link to set a password. Who approves
        requests is set in Setup.
      </p>
    </section>
  );
}

function PermissionsSection({ data, save, busy }: SectionProps) {
  const [granted, setGranted] = useState<Capability[]>(data.staffCapabilities);
  const changed = [...granted].sort().join() !== [...data.staffCapabilities].sort().join();
  return (
    <section className="setup-card" aria-labelledby="permissions-title">
      <h2 id="permissions-title" className="setup-card__title">
        What staff can do
      </h2>
      <p className="meta">You can always do everything. Staff can do what you tick here.</p>
      <ul className="team-list">
        {CAPABILITY_ORDER.map((cap) => (
          <li key={cap}>
            <label className="team-row__check">
              <input
                type="checkbox"
                disabled={!data.canEdit}
                checked={granted.includes(cap)}
                onChange={(e) =>
                  setGranted((g) => (e.target.checked ? [...g, cap] : g.filter((c) => c !== cap)))
                }
              />
              <span>
                <strong>{CAPABILITY_TEXT[cap].label}</strong>
                <span className="meta"> {CAPABILITY_TEXT[cap].detail}</span>
              </span>
            </label>
          </li>
        ))}
      </ul>
      {data.canEdit && (
        <div className="setup-actions">
          <button
            className="button button--primary"
            type="button"
            disabled={busy || !changed}
            onClick={() =>
              void save('permissions', { staffCapabilities: granted }, 'Staff permissions saved.')
            }
          >
            Save permissions
          </button>
        </div>
      )}
    </section>
  );
}

function FreeTextSection({ data, save, busy }: SectionProps) {
  const on = data.freeTextChannels.includes('sms');
  const textingOff = data.texting.declined || data.texting.state !== 'approved';
  return (
    <section className="setup-card" aria-labelledby="free-text-title">
      <h2 id="free-text-title" className="setup-card__title">
        Replies in your own words
      </h2>
      <p className="meta">
        Off, replies use only the templates you approved. On, you and staff you allow can type their
        own replies to customers. Every reply is recorded with who sent it, the first text to a
        customer must name your business, and nothing goes to anyone who replied STOP.
      </p>
      <p>
        Texts: <strong>{on ? 'On' : 'Off'}</strong>
        {textingOff && (
          <span className="meta">
            {' '}
            (texting is not live for your business yet, so this applies once it is)
          </span>
        )}
      </p>
      {data.canEdit && (
        <div className="setup-actions">
          <button
            className={on ? 'button' : 'button button--primary'}
            type="button"
            disabled={busy}
            onClick={() =>
              void save(
                'free-text',
                { channels: on ? [] : ['sms'] },
                on ? 'Replies in your own words are off.' : 'Replies in your own words are on.',
              )
            }
          >
            {on ? 'Turn off' : 'Turn on for texts'}
          </button>
        </div>
      )}
    </section>
  );
}

function ActNowSection({ data, save, busy }: SectionProps) {
  const [hours, setHours] = useState(data.actNowAfterHours);
  const choices = ACT_NOW_CHOICES.includes(data.actNowAfterHours)
    ? ACT_NOW_CHOICES
    : [...ACT_NOW_CHOICES, data.actNowAfterHours].sort((a, b) => a - b);
  return (
    <section className="setup-card" aria-labelledby="act-now-title">
      <h2 id="act-now-title" className="setup-card__title">
        Act now
      </h2>
      <p className="meta">
        A contact waiting on you goes to Act now after this long. Emergencies, a held time about to
        run out, and a change to an appointment in the next two days go there right away.
      </p>
      <label className="field">
        <span className="field__label">Waiting longer than</span>
        <select
          className="field__input"
          disabled={!data.canEdit}
          value={hours}
          onChange={(e) => setHours(Number(e.target.value))}
        >
          {choices.map((h) => (
            <option key={h} value={h}>
              {hoursLabel(h)}
            </option>
          ))}
        </select>
      </label>
      {data.canEdit && (
        <div className="setup-actions">
          <button
            className="button button--primary"
            type="button"
            disabled={busy || hours === data.actNowAfterHours}
            onClick={() => void save('act-now', { hours }, 'Act now limit saved.')}
          >
            Save
          </button>
        </div>
      )}
    </section>
  );
}
