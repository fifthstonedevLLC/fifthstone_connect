import {
  WORKFLOWS,
  templateRule,
  trade,
  tradesFor,
  workflow,
  type WorkflowKey,
} from '@fsc/conversation';
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
  texting: 'Texting',
};

const ERROR: Record<string, string> = {
  owner_only: 'Only the owner can change setup.',
  no_templates: 'Your templates are not set up yet. Fifth Stone Dev adds them first.',
  no_approver: 'Choose at least one person to approve requests.',
  unknown_person: 'One of those people is not on your team. The latest team is shown.',
  not_provisioned: 'Your account is still being set up by Fifth Stone Dev.',
  invalid_fields: 'Some fields need a fix. See the notes below them.',
  network: "We couldn't reach the server. Nothing was saved; try again.",
  unknown_trade: 'That business type is not available. Pick another one.',
  setup_incomplete: 'Finish the other steps first. The latest setup is shown.',
  not_confirmed: 'Confirm the details are accurate before sending.',
  already_approved: 'Texting is already approved.',
  application_sent: 'Your application is with Fifth Stone Dev. Contact them to withdraw it.',
  template_problems:
    "The starting wording doesn't fit your business name. Fifth Stone Dev will help set it up.",
};
const errorText = (code: string) =>
  ERROR[code] ?? "That didn't work. Nothing was saved; try again.";

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** Null once saved; otherwise the fields that need fixing (empty when the error is not a field's). */
type Save = (write: () => Promise<Onboarding>) => Promise<Record<string, string> | null>;

// Steps --------------------------------------------------------------------------------------

function BusinessTypeStep({ data, save, token }: { data: Onboarding; save: Save; token: string }) {
  const type = data.businessType;
  const [choosing, setChoosing] = useState(false);
  if (!type) return <p className="meta">Fifth Stone Dev hasn't set up your account yet.</p>;
  const picking = data.canEdit && (choosing || type.trade === null);

  return (
    <div className="setup-step">
      <p className="setup-step__big">
        {type.trade ? `${type.trade.name} · ${type.name}` : type.name}
      </p>
      <p>{type.description}</p>
      <ul className="setup-facts">
        <li>
          {type.approverChannel === 'text'
            ? 'Requests are approved by text.'
            : 'Requests are approved in this portal.'}
        </li>
        <li>Each booking holds {minutesLabel(type.jobMinutes)} on your calendar.</li>
      </ul>
      {picking ? (
        <BusinessTypePicker
          type={type}
          save={save}
          token={token}
          {...(type.trade ? { onCancel: () => setChoosing(false) } : {})}
          onDone={() => setChoosing(false)}
        />
      ) : (
        <>
          {type.confirmedAt && (
            <p className="setup-done">
              <Icon name="check" size={16} /> Confirmed{' '}
              {savedAtLabel(type.confirmedAt, data.timezone)}
            </p>
          )}
          {data.canEdit && (
            <div className="setup-actions">
              {!type.confirmedAt && (
                <button
                  className="button button--primary"
                  type="button"
                  onClick={() =>
                    void save(() =>
                      apiPost<Onboarding>('/portal/onboarding/business-type', token, {}),
                    )
                  }
                >
                  That's right
                </button>
              )}
              <button className="button" type="button" onClick={() => setChoosing(true)}>
                Change business type
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function minutesLabel(minutes: number) {
  if (minutes % 60 === 0) return minutes === 60 ? '1 hour' : `${minutes / 60} hours`;
  return minutes > 60 ? `${Math.floor(minutes / 60)} h ${minutes % 60} min` : `${minutes} minutes`;
}

/**
 * Pick how bookings work (the workflow), then the closest trade (decision 34). Choosing applies
 * that trade's starter questions and wording as new versions; earlier ones stay restorable in
 * Templates & AI. The server checks the choice; the page shows what it confirmed.
 */
function BusinessTypePicker({
  type,
  save,
  token,
  onCancel,
  onDone,
}: {
  type: NonNullable<Onboarding['businessType']>;
  save: Save;
  token: string;
  onCancel?: () => void;
  onDone: () => void;
}) {
  const [flowKey, setFlowKey] = useState<WorkflowKey>(workflow(type.key)?.key ?? WORKFLOWS[0]!.key);
  const [tradeKey, setTradeKey] = useState<string | null>(type.trade?.key ?? null);
  const [busy, setBusy] = useState(false);
  const flow = workflow(flowKey)!;
  const chosen = tradeKey ? trade(tradeKey) : null;
  const preview = chosen?.workflow === flowKey ? chosen : null;

  async function apply() {
    if (!preview) return;
    setBusy(true);
    const problems = await save(() =>
      apiPut<Onboarding>('/portal/onboarding/business-type', token, { trade: preview.key }),
    );
    setBusy(false);
    if (!problems) onDone();
  }

  return (
    <div className="setup-step">
      <fieldset className="type-group">
        <legend className="setup-card__title">How do your bookings work?</legend>
        <div className="type-choices">
          {WORKFLOWS.map((w) => (
            <label key={w.key} className="type-choice">
              <input
                type="radio"
                name="workflow"
                value={w.key}
                checked={flowKey === w.key}
                onChange={() => {
                  setFlowKey(w.key);
                  setTradeKey(null);
                }}
              />
              <span>
                <strong>{w.name}</strong>
                <span>{w.summary}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="type-group">
        <legend className="setup-card__title">Which is closest to your business?</legend>
        <div className="type-choices type-choices--trades">
          {tradesFor(flowKey).map((t) => (
            <label key={t.key} className="type-choice">
              <input
                type="radio"
                name="trade"
                value={t.key}
                checked={tradeKey === t.key}
                onChange={() => setTradeKey(t.key)}
              />
              <span>
                <strong>{t.name}</strong>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      {preview && (
        <div className="setup-card" aria-live="polite">
          <h3 className="setup-card__title">What you start with</h3>
          <ul className="setup-facts">
            <li>
              {flow.approverChannel === 'text'
                ? 'Requests are approved by text.'
                : 'Requests are approved in this portal.'}
            </li>
            <li>Each booking holds {minutesLabel(preview.jobMinutes)} on your calendar.</li>
          </ul>
          <p className="meta">Questions customers are asked before times are offered:</p>
          <ol className="setup-list">
            {(preview.ai.questions ?? []).map((q) => (
              <li key={q}>{q}</li>
            ))}
          </ol>
          <p className="meta">
            This replaces your live templates and AI instructions with this starting set. Your
            current versions stay in Templates &amp; AI, where you can edit them or restore an
            earlier one.
          </p>
        </div>
      )}

      <div className="setup-actions">
        <button
          className="button button--primary"
          type="button"
          disabled={!preview || busy}
          onClick={() => void apply()}
        >
          {busy ? 'Saving...' : 'Use these settings'}
        </button>
        {onCancel && (
          <button className="button" type="button" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
        )}
      </div>
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
          : 'Requests wait in the Approve queue on the Front Desk for an approver.'}
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
          <p className="sim__who">Request waits in the Approve queue</p>
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

/**
 * The texting step (decisions 35 and 36): text customers back, which means sending the
 * application the carriers review, or go without texting for now. Either choice finishes setup;
 * a business without texting still gets missed calls and voicemails on its Front Desk. Fifth
 * Stone Dev submits the application; nothing goes to a vendor from here.
 */
function TextingStep({
  data,
  save,
  token,
  onDecided,
}: {
  data: Onboarding;
  save: Save;
  token: string;
  onDecided: () => void;
}) {
  const { application } = data;
  const [applying, setApplying] = useState(false);

  async function decline() {
    const problems = await save(() =>
      apiPost<Onboarding>('/portal/onboarding/no-texting', token, {}),
    );
    if (!problems) onDecided();
  }

  if (application.registration === 'approved') {
    return (
      <p className="setup-done">
        <Icon name="check" size={16} /> Texting is approved and on.
      </p>
    );
  }
  if (application.submittedAt || applying) {
    return <Application data={data} save={save} token={token} onSent={onDecided} />;
  }
  if (application.declinedAt) {
    return (
      <div className="setup-step">
        <p className="setup-done">
          <Icon name="check" size={16} /> No texting for now. Chosen{' '}
          {savedAtLabel(application.declinedAt, data.timezone)}.
        </p>
        <p>
          Missed calls and voicemails come to your Front Desk to call back. No texts are sent to
          customers.
        </p>
        {data.canEdit && (
          <div className="setup-actions">
            <button className="button" type="button" onClick={() => setApplying(true)}>
              Turn on texting
            </button>
          </div>
        )}
      </div>
    );
  }
  return (
    <div className="setup-step">
      <p>Texting is optional. Choose how you want to reach customers who call and miss you.</p>
      <div className="setup-card">
        <h3 className="setup-card__title">Text customers back</h3>
        <p className="meta">
          A missed call gets a text from your business, asks what is needed and offers open times.
          The phone carriers review an application first. Going live does not wait for it: texting
          switches on once it is approved.
        </p>
        {data.canEdit && (
          <div className="setup-actions">
            <button
              className="button button--primary"
              type="button"
              onClick={() => setApplying(true)}
            >
              Review my application
            </button>
          </div>
        )}
      </div>
      <div className="setup-card">
        <h3 className="setup-card__title">No texting for now</h3>
        <p className="meta">
          Missed calls and voicemails come to your Front Desk to call back. You can turn on texting
          later from this step.
        </p>
        {data.canEdit && (
          <div className="setup-actions">
            <button className="button" type="button" onClick={() => void decline()}>
              Go without texting
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/** What goes to the carriers, built from the business's details and live templates. */
function Application({
  data,
  save,
  token,
  onSent,
}: {
  data: Onboarding;
  save: Save;
  token: string;
  onSent: () => void;
}) {
  const [confirmed, setConfirmed] = useState(false);
  const { application, details } = data;
  const sent = application.submittedAt;

  async function send() {
    const problems = await save(() =>
      apiPost<Onboarding>('/portal/onboarding/application', token, { confirmed: true }),
    );
    if (!problems) onSent();
  }

  return (
    <div className="setup-step">
      <p>
        This is what the phone carriers review before your business can text customers. Check it
        carefully: a mismatch is the most common reason an application comes back.
      </p>
      {!application.ready && (
        <p className="notice">Finish the other steps first. Each one feeds this application.</p>
      )}
      {details && (
        <div className="setup-card">
          <h3 className="setup-card__title">Business</h3>
          <p>
            {details.legalName}
            {details.ein ? `, EIN ${details.ein}` : ''}
          </p>
          <p className="meta">
            {details.street}, {details.city}, {details.region} {details.postalCode}
            {details.website ? ` · ${details.website}` : ''}
          </p>
          <p className="meta">
            Contact: {details.contactName}, {details.contactEmail},{' '}
            {formatPhone(details.contactPhone)}
          </p>
        </div>
      )}
      {application.preview && (
        <>
          <div className="setup-card">
            <h3 className="setup-card__title">How texts are used</h3>
            <p>{application.preview.useCase}</p>
          </div>
          <div className="setup-card">
            <h3 className="setup-card__title">How customers agree to texts</h3>
            <p>{application.preview.optIn}</p>
          </div>
          <div className="setup-card">
            <h3 className="setup-card__title">Sample messages, from your templates</h3>
            <ul className="setup-facts">
              {application.preview.sampleMessages.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
          </div>
        </>
      )}
      {sent && (
        <p className="setup-done">
          <Icon name="check" size={16} /> Sent {savedAtLabel(sent, data.timezone)}
        </p>
      )}
      {data.canEdit && application.ready && (
        <>
          <label className="team-row__check">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            <span>These details are accurate and belong to this business.</span>
          </label>
          <div className="setup-actions">
            <button
              className="button button--primary"
              type="button"
              disabled={!confirmed}
              onClick={() => void send()}
            >
              {sent ? 'Send again with changes' : 'Send my application'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export function SetupPage({
  me,
  accessToken,
  onSetupChange = () => undefined,
}: {
  me: Me;
  accessToken: string;
  /** Called when the texting choice is made, so the portal can show where setup stands. */
  onSetupChange?: () => void;
}) {
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
      return {};
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
            : `${data.steps.length} steps to get ${me.tenant.name} ready. Each one saves on its own.`}
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
          {step === 'texting' && <TextingStep {...props} onDecided={onSetupChange} />}
        </section>
      </div>
    </div>
  );
}
