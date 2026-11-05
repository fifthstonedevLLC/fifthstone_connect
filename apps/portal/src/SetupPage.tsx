import { templateRule } from '@fsc/conversation';
import { US_REGIONS } from '@fsc/core/regions';
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { ApiError, apiPost, apiPut } from './api';
import { formatPhone, savedAtLabel } from './format';
import { Icon } from './icons';
import type {
  BusinessDetails,
  HoursBlock,
  Me,
  Onboarding,
  OnboardingStep,
  TestCallStep,
} from './types';
import { useApi } from './useApi';

/**
 * Onboarding inside the portal (SCOPE.md v0.2): six steps, each saved on its own. Details are
 * captured here and not sent to any vendor yet. The test call is a simulation until texting is
 * live, and says so wherever it appears (CLAUDE.md rule 5). Only the owner changes anything;
 * the page shows what the server confirmed (decision 24).
 */

const STEP_TITLE: Record<OnboardingStep, string> = {
  business_type: 'Business type',
  details: 'Business details',
  hours: 'Hours and calendar',
  templates: 'Templates and questions',
  team: 'Who approves requests',
  test: 'Test it',
};

const ERROR: Record<string, string> = {
  owner_only: 'Only the owner can change setup.',
  no_templates: 'Your templates are not set up yet. Fifth Stone Dev adds them first.',
  no_approver: 'Choose at least one person to approve requests.',
  unknown_person: 'One of those people is not on your team. The latest team is shown.',
  not_provisioned: 'Your account is still being set up by Fifth Stone Dev.',
  invalid_fields: 'Some fields need a fix. See the notes below them.',
  network: "We couldn't reach the server. Nothing was saved; try again.",
};
const errorText = (code: string) =>
  ERROR[code] ?? "That didn't work. Nothing was saved; try again.";

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

type Save = (write: () => Promise<Onboarding>) => Promise<Record<string, string> | null>;

// Steps --------------------------------------------------------------------------------------

function BusinessTypeStep({ data, save, token }: { data: Onboarding; save: Save; token: string }) {
  const type = data.businessType;
  if (!type) return <p className="meta">Fifth Stone Dev hasn't set your business type yet.</p>;
  return (
    <div className="setup-step">
      <p className="setup-step__big">{type.name}</p>
      <p>{type.description}</p>
      <ul className="setup-facts">
        <li>
          {type.approverChannel === 'text'
            ? 'Requests are approved by text.'
            : 'Requests are approved in this portal.'}
        </li>
        {type.minimumData && (
          <li>
            Minimum-data setup: customers are asked only for a callback number and times. Nothing
            they send goes to the AI, and voicemails are not transcribed.
          </li>
        )}
      </ul>
      <p className="meta">
        Your business type decides what customers are asked and what is kept. To change it, contact
        Fifth Stone Dev.
      </p>
      {type.confirmedAt ? (
        <p className="setup-done">
          <Icon name="check" size={16} /> Confirmed {savedAtLabel(type.confirmedAt, data.timezone)}
        </p>
      ) : (
        data.canEdit && (
          <div>
            <button
              className="button button--primary"
              type="button"
              onClick={() =>
                void save(() => apiPost<Onboarding>('/portal/onboarding/business-type', token, {}))
              }
            >
              That's right
            </button>
          </div>
        )
      )}
    </div>
  );
}

const DETAIL_FIELDS: {
  key: keyof BusinessDetails;
  label: string;
  hint?: string;
  type?: string;
  autoComplete?: string;
}[] = [
  { key: 'legalName', label: 'Legal business name', autoComplete: 'organization' },
  {
    key: 'ein',
    label: 'EIN (optional)',
    hint: '9 digits, like 12-3456789. Leave blank if you are a sole proprietor without one. Never enter a Social Security number.',
  },
  { key: 'street', label: 'Street address', autoComplete: 'address-line1' },
  { key: 'city', label: 'City', autoComplete: 'address-level2' },
  { key: 'region', label: 'State' },
  { key: 'postalCode', label: 'ZIP code', autoComplete: 'postal-code' },
  { key: 'website', label: 'Website (optional)', type: 'url', autoComplete: 'url' },
  { key: 'contactName', label: 'Contact name', autoComplete: 'name' },
  { key: 'contactEmail', label: 'Contact email', type: 'email', autoComplete: 'email' },
  { key: 'contactPhone', label: 'Contact phone', type: 'tel', autoComplete: 'tel' },
];

function DetailsStep({ data, save, token }: { data: Onboarding; save: Save; token: string }) {
  const initial = Object.fromEntries(
    DETAIL_FIELDS.map((f) => [f.key, (data.details?.[f.key] as string | undefined) ?? '']),
  ) as Record<keyof BusinessDetails, string>;
  if (data.details?.contactPhone) initial.contactPhone = formatPhone(data.details.contactPhone);
  const [form, setForm] = useState(initial);
  const [fields, setFields] = useState<Record<string, string>>({});
  const readOnly = !data.canEdit;

  async function submit() {
    const problems = await save(() =>
      apiPut<Onboarding>('/portal/onboarding/details', token, form),
    );
    setFields(problems ?? {});
  }

  return (
    <form
      className="setup-step"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <p className="meta">
        Your texting registration needs these. They're saved here and not sent anywhere until Fifth
        Stone Dev submits your registration.
      </p>
      <div className="setup-grid">
        {DETAIL_FIELDS.map((f) => {
          const id = `details-${f.key}`;
          const problem = fields[f.key];
          return (
            <div key={f.key} className={`field field--${f.key}`}>
              <label className="field__label" htmlFor={id}>
                {f.label}
              </label>
              {f.key === 'region' ? (
                <select
                  id={id}
                  className="field__input"
                  value={form.region}
                  disabled={readOnly}
                  onChange={(e) => setForm({ ...form, region: e.target.value })}
                  aria-invalid={Boolean(problem)}
                >
                  <option value="">Choose</option>
                  {US_REGIONS.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  id={id}
                  className="field__input"
                  type={f.type ?? 'text'}
                  autoComplete={f.autoComplete}
                  value={form[f.key]}
                  readOnly={readOnly}
                  onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
                  aria-invalid={Boolean(problem)}
                  aria-describedby={f.hint ? `${id}-hint` : undefined}
                />
              )}
              {f.hint && (
                <p className="meta" id={`${id}-hint`}>
                  {f.hint}
                </p>
              )}
              {problem && <p className="field__problem">{problem}</p>}
            </div>
          );
        })}
      </div>
      {data.canEdit && (
        <div>
          <button className="button button--primary" type="submit">
            Save details
          </button>
        </div>
      )}
    </form>
  );
}

function HoursStep({ data, save, token }: { data: Onboarding; save: Save; token: string }) {
  const [blocks, setBlocks] = useState<HoursBlock[]>(
    data.hours.length > 0 ? data.hours : [{ days: [1, 2, 3, 4, 5], open: '08:00', close: '17:00' }],
  );
  const [problem, setProblem] = useState<string | null>(null);
  const readOnly = !data.canEdit;
  const update = (i: number, block: HoursBlock) =>
    setBlocks(blocks.map((b, j) => (j === i ? block : b)));

  async function submit() {
    const problems = await save(() =>
      apiPut<Onboarding>('/portal/onboarding/hours', token, {
        hours: blocks.map((b) => ({ ...b, days: [...b.days].sort() })),
      }),
    );
    setProblem(problems ? (Object.values(problems)[0] ?? null) : null);
  }

  const calendar = data.calendar;
  return (
    <form
      className="setup-step"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <p className="meta">
        Open times are offered only inside these hours, in {data.timezone.replace('_', ' ')} time.
      </p>
      {blocks.map((block, i) => (
        <fieldset key={i} className="hours-block">
          <legend className="sr-only">Hours block {i + 1}</legend>
          <div className="hours-block__days">
            {DAYS.map((label, d) => {
              const day = d + 1;
              return (
                <label key={label} className="day-toggle">
                  <input
                    type="checkbox"
                    checked={block.days.includes(day)}
                    disabled={readOnly}
                    onChange={(e) =>
                      update(i, {
                        ...block,
                        days: e.target.checked
                          ? [...block.days, day]
                          : block.days.filter((x) => x !== day),
                      })
                    }
                  />
                  <span>{label}</span>
                </label>
              );
            })}
          </div>
          <div className="hours-block__times">
            <label className="field">
              <span className="field__label">Opens</span>
              <input
                className="field__input"
                type="time"
                value={block.open}
                readOnly={readOnly}
                onChange={(e) => update(i, { ...block, open: e.target.value })}
              />
            </label>
            <label className="field">
              <span className="field__label">Closes</span>
              <input
                className="field__input"
                type="time"
                value={block.close}
                readOnly={readOnly}
                onChange={(e) => update(i, { ...block, close: e.target.value })}
              />
            </label>
            {data.canEdit && blocks.length > 1 && (
              <button
                className="button button--small"
                type="button"
                onClick={() => setBlocks(blocks.filter((_, j) => j !== i))}
              >
                Remove
              </button>
            )}
          </div>
        </fieldset>
      ))}
      {problem && <p className="field__problem">{problem}</p>}
      {data.canEdit && (
        <div className="setup-actions">
          <button
            className="button"
            type="button"
            onClick={() => setBlocks([...blocks, { days: [6], open: '09:00', close: '12:00' }])}
          >
            Add hours
          </button>
          <button className="button button--primary" type="submit">
            Save hours
          </button>
        </div>
      )}

      <div className="setup-card">
        <h3 className="setup-card__title">Calendar</h3>
        <p>
          {calendar
            ? `${calendar.provider === 'google' ? 'Google Calendar' : 'Acuity'}: ${
                calendar.status === 'connected'
                  ? 'connected'
                  : calendar.status === 'revoked'
                    ? 'needs reconnecting'
                    : 'not connected'
              }`
            : 'No calendar connected yet.'}
        </p>
        <p className="meta">
          Fifth Stone Dev connects your calendar with you during setup. Connecting it from here
          comes later.
        </p>
      </div>
    </form>
  );
}

function TemplatesStep({ data, save, token }: { data: Onboarding; save: Save; token: string }) {
  const t = data.templates;
  return (
    <div className="setup-step">
      <p>
        {t.version === null
          ? 'Your templates are not set up yet.'
          : `Version ${t.version} of your templates is live. They are the words customers get at each step.`}
      </p>
      {t.questions.length > 0 && (
        <div className="setup-card">
          <h3 className="setup-card__title">Questions asked before offering times</h3>
          <ol className="setup-list">
            {t.questions.map((q) => (
              <li key={q}>{q}</li>
            ))}
          </ol>
        </div>
      )}
      <p>
        <Link to="/templates">Open Templates &amp; AI</Link> to read or change them.
      </p>
      {t.reviewedAt && (
        <p className="setup-done">
          <Icon name="check" size={16} /> Reviewed {savedAtLabel(t.reviewedAt, data.timezone)}
        </p>
      )}
      {data.canEdit && t.version !== null && (
        <div>
          <button
            className={t.reviewedAt ? 'button' : 'button button--primary'}
            type="button"
            onClick={() =>
              void save(() =>
                apiPost<Onboarding>('/portal/onboarding/templates-reviewed', token, {}),
              )
            }
          >
            {t.reviewedAt ? 'Reviewed again' : "I've reviewed them"}
          </button>
        </div>
      )}
    </div>
  );
}

function TeamStep({ data, save, token }: { data: Onboarding; save: Save; token: string }) {
  const [chosen, setChosen] = useState(
    () => new Set(data.team.filter((u) => u.approvesRequests).map((u) => u.id)),
  );
  const byText = data.businessType?.approverChannel === 'text';
  return (
    <form
      className="setup-step"
      onSubmit={(e) => {
        e.preventDefault();
        void save(() =>
          apiPut<Onboarding>('/portal/onboarding/approvers', token, { approverIds: [...chosen] }),
        );
      }}
    >
      <p className="meta">
        {byText
          ? 'Approvers get a text for each request and reply 1 to approve. They can also approve here.'
          : 'Requests wait on Today for an approver to approve.'}
      </p>
      <ul className="team-list">
        {data.team.map((u) => (
          <li key={u.id} className="team-row">
            <label className="team-row__check">
              <input
                type="checkbox"
                checked={chosen.has(u.id)}
                disabled={!data.canEdit}
                onChange={(e) => {
                  const next = new Set(chosen);
                  if (e.target.checked) next.add(u.id);
                  else next.delete(u.id);
                  setChosen(next);
                }}
              />
              <span>
                <span className="team-row__name">{u.name}</span>
                <span className="meta">
                  {u.role === 'owner' ? 'Owner' : 'Staff'}
                  {u.mobile ? ` · ${formatPhone(u.mobile)}` : ' · no mobile number'}
                </span>
              </span>
            </label>
            {byText && chosen.has(u.id) && !u.mobile && (
              <p className="field__problem">No mobile number, so no approval texts.</p>
            )}
          </li>
        ))}
      </ul>
      <p className="meta">Need another login? Contact Fifth Stone Dev.</p>
      {data.canEdit && (
        <div>
          <button className="button button--primary" type="submit" disabled={chosen.size === 0}>
            Save approvers
          </button>
        </div>
      )}
    </form>
  );
}

function templateLabel(key: string) {
  return templateRule(key)?.label ?? key;
}

function TestStepLine({ step, data }: { step: TestCallStep; data: Onboarding }): ReactNode {
  switch (step.kind) {
    case 'missed_call':
      return (
        <>
          <p className="sim__who">You call and hang up</p>
          <p>
            {step.from ? `From ${formatPhone(step.from)}` : 'From your phone'} to{' '}
            {step.to ? formatPhone(step.to) : 'your Fifth Stone Connect number'}.
          </p>
        </>
      );
    case 'text_to_caller':
      return (
        <>
          <p className="sim__who">Text to you · {templateLabel(step.templateKey)}</p>
          {step.body ? (
            <p className="sim__bubble">{step.body}</p>
          ) : (
            <p className="field__problem">No template for this step yet.</p>
          )}
        </>
      );
    case 'caller_replies':
      return (
        <>
          <p className="sim__who">You reply</p>
          <p className="sim__bubble sim__bubble--in">{step.body}</p>
        </>
      );
    case 'approval_request':
      return step.channel === 'text' ? (
        <>
          <p className="sim__who">
            Text to {step.approver ?? 'your approver'} · {templateLabel('approval_request')}
          </p>
          {step.body ? (
            <p className="sim__bubble">{step.body}</p>
          ) : (
            <p className="field__problem">No template for this step yet.</p>
          )}
        </>
      ) : (
        <>
          <p className="sim__who">Request waits on Today</p>
          <p>For {step.approver ?? 'an approver'} to approve in the portal.</p>
        </>
      );
    case 'approver_approves':
      return (
        <>
          <p className="sim__who">
            {data.team.find((u) => u.approvesRequests)?.name ?? 'Approver'}
          </p>
          <p>{step.channel === 'text' ? 'Replies 1 to approve.' : 'Taps Approve.'}</p>
        </>
      );
  }
}

function TestStep({
  data,
  token,
  onRun,
}: {
  data: Onboarding;
  token: string;
  onRun: (next: Onboarding) => void;
}) {
  const [steps, setSteps] = useState<TestCallStep[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const result = await apiPost<{ steps: TestCallStep[]; onboarding: Onboarding }>(
        '/portal/onboarding/test-call',
        token,
        {},
      );
      setSteps(result.steps);
      onRun(result.onboarding);
    } catch (e) {
      setError(errorText(e instanceof ApiError ? e.code : 'error'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="setup-step">
      <p className="notice notice--plain">
        Simulation: no call is placed and no text is sent. Once your number is connected, this
        becomes a real test call.
      </p>
      <p>
        This plays a missed call through your own templates, the way a customer would see it, and
        then the approval.
      </p>
      {data.test.simulatedAt && (
        <p className="setup-done">
          <Icon name="check" size={16} /> Last run{' '}
          {savedAtLabel(data.test.simulatedAt, data.timezone)}
        </p>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {data.canEdit && (
        <div>
          <button className="button button--primary" type="button" disabled={busy} onClick={run}>
            {busy ? 'Running…' : steps ? 'Run it again' : 'Run the simulated test call'}
          </button>
        </div>
      )}
      {steps && (
        <ol className="sim" aria-label="Simulated test call">
          {steps.map((step, i) => (
            <li key={i} className="sim__step">
              <TestStepLine step={step} data={data} />
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

// Page ---------------------------------------------------------------------------------------

export function SetupPage({ me, accessToken }: { me: Me; accessToken: string }) {
  const [onboarding, reload, replace] = useApi<Onboarding>('/portal/onboarding', accessToken);
  const [current, setCurrent] = useState<OnboardingStep | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  // The step on screen: the one chosen, else the first not done. A save keeps it on screen, even
  // when it completes the step the page opened on.
  const step: OnboardingStep =
    current ??
    (onboarding.status === 'ready'
      ? (onboarding.data.steps.find((s) => !s.done)?.key ?? 'business_type')
      : 'business_type');
  const stay = () => setCurrent((c) => c ?? step);

  // Show the server's answer, never an assumed result (decision 24).
  const save: Save = async (write) => {
    stay();
    setBusy(true);
    setMessage(null);
    try {
      replace(await write());
      setMessage({ ok: true, text: 'Saved.' });
      return null;
    } catch (e) {
      const code = e instanceof ApiError ? e.code : 'error';
      setMessage({ ok: false, text: errorText(code) });
      if (e instanceof ApiError && e.status === 409) reload();
      if (e instanceof ApiError && e.status === 422) {
        return (e.body.fields ?? {}) as Record<string, string>;
      }
      return null;
    } finally {
      setBusy(false);
    }
  };

  if (onboarding.status === 'loading') {
    return (
      <p className="page__note" role="status">
        Loading setup…
      </p>
    );
  }
  if (onboarding.status === 'error') {
    return (
      <div className="notice" role="alert">
        <p>We couldn't load setup. Nothing has changed; this is only the view.</p>
        <button className="button" type="button" onClick={reload}>
          Try again
        </button>
      </div>
    );
  }

  const data = onboarding.data;
  const allDone = data.steps.every((s) => s.done);
  const props = { data, save, token: accessToken };

  return (
    <div className="page">
      <header className="page__header">
        <h1 className="page__title">Setup</h1>
        <p className="page__lede">
          {allDone
            ? `${me.tenant.name} is set up. You can come back and change any step.`
            : `Six steps to get ${me.tenant.name} ready. Each one saves on its own.`}
        </p>
      </header>
      {!data.canEdit && (
        <p className="notice">Only the owner can change setup. You can read it here.</p>
      )}
      {message && (
        <p className={message.ok ? 'meta' : 'form-error'} role={message.ok ? 'status' : 'alert'}>
          {message.text}
        </p>
      )}
      <div className="setup">
        <nav aria-label="Setup steps">
          <ol className="setup-nav">
            {data.steps.map((s) => (
              <li key={s.key}>
                <button
                  type="button"
                  className="setup-nav__item"
                  aria-current={s.key === step ? 'step' : undefined}
                  onClick={() => {
                    setCurrent(s.key);
                    setMessage(null);
                  }}
                >
                  <span
                    className={s.done ? 'setup-nav__mark setup-nav__mark--done' : 'setup-nav__mark'}
                  >
                    {s.done && <Icon name="check" size={14} />}
                  </span>
                  {STEP_TITLE[s.key]}
                  <span className="sr-only">{s.done ? ' (done)' : ' (not done)'}</span>
                </button>
              </li>
            ))}
          </ol>
        </nav>
        <section className="setup-panel" aria-labelledby="setup-step-title" aria-busy={busy}>
          <h2 id="setup-step-title" className="section-title">
            {STEP_TITLE[step]}
          </h2>
          {step === 'business_type' && <BusinessTypeStep {...props} />}
          {step === 'details' && <DetailsStep key={data.details?.updatedAt ?? 'new'} {...props} />}
          {step === 'hours' && <HoursStep {...props} />}
          {step === 'templates' && <TemplatesStep {...props} />}
          {step === 'team' && <TeamStep {...props} />}
          {step === 'test' && (
            <TestStep
              data={data}
              token={accessToken}
              onRun={(next) => {
                stay();
                replace(next);
              }}
            />
          )}
        </section>
      </div>
    </div>
  );
}
