import {
  checkTemplate,
  REPLY_PREFIX,
  sampleText,
  templateRule,
  type TemplateProblem,
} from '@fsc/conversation';
import { aiFieldWithinLimits } from '@fsc/core/ai-limits';
import { useMemo, useState, type ReactNode } from 'react';
import { ApiError, apiPost, apiPut } from './api';
import {
  placeholderLabel,
  savedAtLabel,
  settingsErrorMessage,
  templateProblemMessage,
} from './format';
import type { AiSettings, Me, Settings, SettingsKind, SettingsVersion } from './types';
import { useApi } from './useApi';

/**
 * Templates and AI instructions (SCOPE.md v0.2, "Settings the owner controls"). The owner edits
 * wording and structured AI fields; every save is a new version and any earlier version can be
 * made live again. The same template rules the server enforces run here for the live count and
 * notes, but only the server's answer is shown as saved (decision 24).
 */

type Problems = Record<string, TemplateProblem[]>;
type Submit = (kind: SettingsKind, write: () => Promise<Settings>) => Promise<Problems | null>;

const ENGINE_ORDER = [
  'missed_call_text_back',
  'slot_offer',
  'request_received',
  'confirmation',
  'out_of_scope',
];

const GROUPS: { title: string; note: string; keys: (keys: string[]) => string[] }[] = [
  {
    title: 'Texts to your customers',
    note: 'Sent automatically at each step.',
    keys: (keys) =>
      keys
        .filter((k) => !k.startsWith(REPLY_PREFIX) && templateRule(k)?.audience !== 'approver')
        .sort((a, b) => order(a) - order(b) || a.localeCompare(b)),
  },
  {
    title: 'Replies you can send to a contact',
    note: 'You or your staff pick one on a contact page.',
    keys: (keys) => keys.filter((k) => k.startsWith(REPLY_PREFIX)).sort(),
  },
  {
    title: 'Texts to you',
    note: 'Sent to whoever approves requests.',
    keys: (keys) => keys.filter((k) => templateRule(k)?.audience === 'approver').sort(),
  },
];

function order(key: string): number {
  const at = ENGINE_ORDER.indexOf(key);
  return at === -1 ? ENGINE_ORDER.length : at;
}

/** "a", "a and b", "a, b and c". */
const listWords = (words: string[]) =>
  words.length < 2 ? (words[0] ?? '') : `${words.slice(0, -1).join(', ')} and ${words.at(-1)}`;

const live = <T,>(versions: SettingsVersion<T>[]) => versions.find((v) => v.active) ?? null;

function changedKeys(a: Record<string, unknown>, b: Record<string, unknown>): string[] {
  return [...new Set([...Object.keys(a), ...Object.keys(b)])].filter(
    (key) => JSON.stringify(a[key]) !== JSON.stringify(b[key]),
  );
}

// Templates ---------------------------------------------------------------------------------

function TemplateField({
  templateKey,
  value,
  onChange,
  businessName,
  readOnly,
  edited,
  serverProblems,
}: {
  templateKey: string;
  value: string;
  onChange: (value: string) => void;
  businessName: string;
  readOnly: boolean;
  edited: boolean;
  serverProblems: TemplateProblem[] | undefined;
}) {
  const rule = templateRule(templateKey);
  const check = checkTemplate(templateKey, value, businessName);
  const problems = serverProblems ?? check.problems;
  const example = sampleText(value.trim(), businessName);
  const id = `template-${templateKey}`;

  const mustKeep = [
    ...(rule?.requires ?? []).map((p) =>
      p === 'business' ? 'your business name' : placeholderLabel(p),
    ),
    ...(rule?.optOutLine ? ['the opt-out line'] : []),
  ];

  return (
    <div className="template">
      <div className="template__head">
        <label className="template__label" htmlFor={id}>
          {rule?.label ?? templateKey}
        </label>
        {edited && <span className="template__edited">Edited</span>}
      </div>
      <textarea
        id={id}
        className="template__input"
        value={value}
        rows={3}
        readOnly={readOnly}
        onChange={(e) => onChange(e.target.value)}
        aria-describedby={`${id}-hint ${id}-count`}
        aria-invalid={problems.length > 0}
      />
      <p className="meta" id={`${id}-hint`}>
        {mustKeep.length > 0 && <>Must keep {listWords(mustKeep)}. </>}
        {rule && rule.placeholders.length > 0 && (
          <>Can use {rule.placeholders.map((p) => `{${p}}`).join(', ')}.</>
        )}
      </p>
      <p className="template__example">
        <span className="meta">Example as sent</span>
        {example}
      </p>
      <p className="meta" id={`${id}-count`}>
        {check.segments} {check.segments === 1 ? 'segment' : 'segments'} · {example.length}{' '}
        characters
      </p>
      {problems.length > 0 && (
        <ul className="template__problems">
          {problems.map((problem) => (
            <li key={problem.code}>{templateProblemMessage(problem)}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function TemplatesEditor({
  settings,
  busy,
  saved,
  submit,
  onDirty,
  accessToken,
}: {
  settings: Settings;
  busy: boolean;
  saved: string | null;
  submit: Submit;
  onDirty: (dirty: boolean) => void;
  accessToken: string;
}) {
  const current = live(settings.templates.versions);
  const base = useMemo(() => current?.content ?? {}, [current]);
  const [draft, setDraft] = useState(base);
  const [serverProblems, setServerProblems] = useState<Problems>({});
  const [saveId, setSaveId] = useState(() => crypto.randomUUID());
  const keys = Object.keys(base);
  const edited = keys.filter((k) => draft[k] !== base[k]);
  const blocked = keys.some(
    (k) => checkTemplate(k, draft[k] ?? '', settings.businessName).problems.length > 0,
  );

  function change(key: string, value: string) {
    const next = { ...draft, [key]: value };
    setDraft(next);
    setServerProblems((current) =>
      Object.fromEntries(Object.entries(current).filter(([k]) => k !== key)),
    );
    onDirty(keys.some((k) => next[k] !== base[k]));
  }

  async function save() {
    const problems = await submit('templates', () =>
      apiPut<Settings>('/portal/settings/templates', accessToken, {
        id: saveId,
        baseVersion: current?.version ?? null,
        content: draft,
      }),
    );
    if (problems) setServerProblems(problems);
    else setSaveId(crypto.randomUUID());
  }

  if (keys.length === 0) {
    return <p className="meta">No templates are set up yet. Fifth Stone Dev adds them at setup.</p>;
  }

  return (
    <form
      className="settings-form"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      {GROUPS.map((group) => {
        const groupKeys = group.keys(keys);
        if (groupKeys.length === 0) return null;
        return (
          <fieldset key={group.title} className="settings-group">
            <legend className="section-title">{group.title}</legend>
            <p className="meta">{group.note}</p>
            {groupKeys.map((key) => (
              <TemplateField
                key={key}
                templateKey={key}
                value={draft[key] ?? ''}
                onChange={(value) => change(key, value)}
                businessName={settings.businessName}
                readOnly={!settings.canEdit}
                edited={edited.includes(key)}
                serverProblems={serverProblems[key]}
              />
            ))}
          </fieldset>
        );
      })}
      {settings.canEdit && (
        <SaveBar
          edited={edited.length}
          noun="template"
          blocked={blocked}
          busy={busy}
          saved={saved}
          onDiscard={() => {
            setDraft(base);
            setServerProblems({});
            onDirty(false);
          }}
        />
      )}
    </form>
  );
}

// AI instructions ---------------------------------------------------------------------------

interface AiForm {
  what_we_do: string;
  what_we_dont_do: string;
  emergency: string;
  questions: string;
  tone: string;
}

const AI_FIELDS: {
  key: keyof AiForm;
  label: string;
  hint: string;
  lines?: boolean;
  short?: boolean;
}[] = [
  { key: 'what_we_do', label: 'What you do', hint: 'The work you take on, in your own words.' },
  {
    key: 'what_we_dont_do',
    label: "What you don't do",
    hint: 'One per line, up to 10. Requests for these are marked as not your work.',
    lines: true,
  },
  {
    key: 'emergency',
    label: 'What counts as an emergency',
    hint: 'Used to decide which messages need you right away.',
  },
  {
    key: 'questions',
    label: 'Questions to ask before offering times',
    hint: 'One per line, up to 5, in the order to ask them.',
    lines: true,
  },
  { key: 'tone', label: 'Tone', hint: 'How the texts should sound.', short: true },
];

const AI_LIMIT: Record<keyof AiForm, string> = {
  what_we_do: 'Keep this under 500 characters.',
  what_we_dont_do: 'Use up to 10 lines, each under 200 characters.',
  emergency: 'Keep this under 500 characters.',
  questions: 'Use up to 5 lines, each under 160 characters.',
  tone: 'Keep this under 200 characters.',
};

function toForm(ai: AiSettings): AiForm {
  return {
    what_we_do: ai.what_we_do ?? '',
    what_we_dont_do: (ai.what_we_dont_do ?? []).join('\n'),
    emergency: ai.emergency ?? '',
    questions: (ai.questions ?? []).join('\n'),
    tone: ai.tone ?? '',
  };
}

/** Blank fields and blank lines are left out, in a fixed field order. */
function fromForm(form: AiForm): AiSettings {
  const text = (value: string) => value.trim() || undefined;
  const lines = (value: string) => {
    const list = value
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    return list.length > 0 ? list : undefined;
  };
  const out: AiSettings = {};
  const whatWeDo = text(form.what_we_do);
  const dont = lines(form.what_we_dont_do);
  const emergency = text(form.emergency);
  const questions = lines(form.questions);
  const tone = text(form.tone);
  if (whatWeDo) out.what_we_do = whatWeDo;
  if (dont) out.what_we_dont_do = dont;
  if (emergency) out.emergency = emergency;
  if (questions) out.questions = questions;
  if (tone) out.tone = tone;
  return out;
}

function AiEditor({
  settings,
  busy,
  saved,
  submit,
  onDirty,
  accessToken,
}: {
  settings: Settings;
  busy: boolean;
  saved: string | null;
  submit: Submit;
  onDirty: (dirty: boolean) => void;
  accessToken: string;
}) {
  const current = live(settings.ai.versions);
  const base = useMemo(() => toForm(current?.content ?? {}), [current]);
  const [form, setForm] = useState(base);
  const [saveId, setSaveId] = useState(() => crypto.randomUUID());
  const baseValue = JSON.stringify(fromForm(base));
  const value = fromForm(form);
  const dirty = JSON.stringify(value) !== baseValue;
  const invalid = new Set(
    (Object.keys(value) as (keyof AiSettings)[]).filter(
      (key) => !aiFieldWithinLimits(key, value[key] ?? ''),
    ),
  );

  function change(key: keyof AiForm, text: string) {
    const next = { ...form, [key]: text };
    setForm(next);
    onDirty(JSON.stringify(fromForm(next)) !== baseValue);
  }

  async function save() {
    await submit('ai', () =>
      apiPut<Settings>('/portal/settings/ai', accessToken, {
        id: saveId,
        baseVersion: current?.version ?? null,
        content: value,
      }),
    );
    setSaveId(crypto.randomUUID());
  }

  return (
    <form
      className="settings-form"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <fieldset className="settings-group">
        <legend className="section-title">What the AI knows about your business</legend>
        <p className="meta">
          It uses these to read messages and draft questions. Times, prices and bookings come only
          from your templates, never from the AI.
        </p>
        {AI_FIELDS.map((field) => {
          const id = `ai-${field.key}`;
          const bad = invalid.has(field.key);
          return (
            <div key={field.key} className="template">
              <label className="template__label" htmlFor={id}>
                {field.label}
              </label>
              {field.short ? (
                <input
                  id={id}
                  className="field__input"
                  value={form[field.key]}
                  readOnly={!settings.canEdit}
                  onChange={(e) => change(field.key, e.target.value)}
                  aria-describedby={`${id}-hint`}
                  aria-invalid={bad}
                />
              ) : (
                <textarea
                  id={id}
                  className="template__input"
                  value={form[field.key]}
                  rows={field.lines ? 4 : 3}
                  readOnly={!settings.canEdit}
                  onChange={(e) => change(field.key, e.target.value)}
                  aria-describedby={`${id}-hint`}
                  aria-invalid={bad}
                />
              )}
              <p className="meta" id={`${id}-hint`}>
                {field.hint}
              </p>
              {bad && (
                <ul className="template__problems">
                  <li>{AI_LIMIT[field.key]}</li>
                </ul>
              )}
            </div>
          );
        })}
      </fieldset>
      {settings.canEdit && (
        <SaveBar
          edited={dirty ? 1 : 0}
          noun="AI instruction"
          blocked={invalid.size > 0}
          busy={busy}
          saved={saved}
          onDiscard={() => {
            setForm(base);
            onDirty(false);
          }}
        />
      )}
    </form>
  );
}

// Shared pieces -----------------------------------------------------------------------------

function SaveBar({
  edited,
  noun,
  blocked,
  busy,
  saved,
  onDiscard,
}: {
  edited: number;
  noun: string;
  blocked: boolean;
  busy: boolean;
  /** The server's confirmation of the last save or restore, if any. */
  saved: string | null;
  onDiscard: () => void;
}) {
  return (
    <div className="savebar">
      <span className="meta" role="status">
        {edited === 0
          ? (saved ?? 'No unsaved changes.')
          : blocked
            ? 'Fix the notes above to save.'
            : noun === 'template'
              ? `${edited} ${edited === 1 ? 'template' : 'templates'} edited. Saving makes a new live version.`
              : 'Edited. Saving makes a new live version.'}
      </span>
      <div className="savebar__actions">
        <button
          className="button"
          type="button"
          disabled={edited === 0 || busy}
          onClick={onDiscard}
        >
          Discard
        </button>
        <button
          className="button button--primary"
          type="submit"
          disabled={edited === 0 || blocked || busy}
        >
          {busy ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  );
}

function VersionHistory<T extends object>({
  versions,
  timeZone,
  canEdit,
  dirty,
  busy,
  label,
  onRestore,
}: {
  versions: SettingsVersion<T>[];
  timeZone: string;
  canEdit: boolean;
  dirty: boolean;
  busy: boolean;
  label: (key: string) => string;
  onRestore: (version: number) => void;
}) {
  const current = live(versions);
  return (
    <section className="history" aria-labelledby="history-heading">
      <h2 id="history-heading" className="section-title">
        Versions
      </h2>
      <p className="meta">
        Every save is kept. Making an earlier version live is one click and can be undone the same
        way.
      </p>
      {canEdit && dirty && <p className="meta">Save or discard your edits to change versions.</p>}
      <ol className="history__list">
        {versions.map((v) => {
          const differs = current
            ? changedKeys(
                current.content as Record<string, unknown>,
                v.content as Record<string, unknown>,
              )
            : [];
          return (
            <li key={v.version} className="version">
              <div className="version__head">
                <span className="version__name">Version {v.version}</span>
                {v.active ? (
                  <span className="version__live">Live</span>
                ) : (
                  canEdit && (
                    <button
                      className="button button--small"
                      type="button"
                      disabled={dirty || busy}
                      onClick={() => onRestore(v.version)}
                    >
                      Make live
                    </button>
                  )
                )}
              </div>
              <p className="meta">
                {savedAtLabel(v.createdAt, timeZone)} ·{' '}
                {v.createdByName ?? 'Set up by Fifth Stone Dev'}
              </p>
              {!v.active && (
                <p className="meta">
                  {differs.length === 0
                    ? 'Same wording as the live version.'
                    : `Differs from live: ${differs.map(label).join(', ')}.`}
                </p>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

// Page --------------------------------------------------------------------------------------

const AI_LABEL: Record<string, string> = Object.fromEntries(AI_FIELDS.map((f) => [f.key, f.label]));

export function SettingsPage({ me, accessToken }: { me: Me; accessToken: string }) {
  const [settings, reload, replace] = useApi<Settings>('/portal/settings', accessToken);
  const [tab, setTab] = useState<SettingsKind>('templates');
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState<Record<SettingsKind, boolean>>({
    templates: false,
    ai: false,
  });
  const [message, setMessage] = useState<{
    kind: 'ok' | 'error';
    scope: SettingsKind;
    text: string;
  } | null>(null);
  const savedNote = (scope: SettingsKind) =>
    message?.kind === 'ok' && message.scope === scope ? message.text : null;

  // Show the server's answer, never an assumed result. A save or restore answers with the
  // settings as they now stand; a refusal wrote nothing, and a conflict reloads the latest.
  const submit: Submit = async (kind, write) => {
    setBusy(true);
    setMessage(null);
    try {
      const next = await write();
      replace(next);
      setDirty((d) => ({ ...d, [kind]: false }));
      const now = live<object>(next[kind].versions);
      setMessage({
        kind: 'ok',
        scope: kind,
        text: now ? `Version ${now.version} is live.` : 'Saved.',
      });
      return null;
    } catch (error) {
      const code = error instanceof ApiError ? error.code : 'error';
      setMessage({ kind: 'error', scope: kind, text: settingsErrorMessage(code) });
      if (error instanceof ApiError && (error.status === 409 || error.status === 404)) {
        setDirty({ templates: false, ai: false });
        reload();
      }
      if (error instanceof ApiError && error.status === 422) {
        const list = (error.body.problems ?? []) as { key: string; problems: TemplateProblem[] }[];
        return Object.fromEntries(list.map((p) => [p.key, p.problems]));
      }
      return null;
    } finally {
      setBusy(false);
    }
  };

  const restore = (kind: SettingsKind, version: number, baseVersion: number | null) =>
    void submit(kind, () =>
      apiPost<Settings>(`/portal/settings/${kind}/restore`, accessToken, { version, baseVersion }),
    );

  let body: ReactNode;
  if (settings.status === 'loading') {
    body = (
      <p className="page__note" role="status">
        Loading your settings…
      </p>
    );
  } else if (settings.status === 'error') {
    body = (
      <div className="notice" role="alert">
        <p>We couldn't load your settings. Nothing has changed; this is only the view.</p>
        <button className="button" type="button" onClick={reload}>
          Try again
        </button>
      </div>
    );
  } else {
    const data = settings.data;
    const versions = tab === 'templates' ? data.templates.versions : data.ai.versions;
    const current = live<object>(versions);
    body = (
      <>
        {!data.canEdit && (
          <p className="notice">Only the owner can change these. You can read them here.</p>
        )}
        <div className="segmented" aria-label="Settings section">
          {(['templates', 'ai'] as const).map((kind) => (
            <button
              key={kind}
              type="button"
              className="segmented__button"
              aria-pressed={tab === kind}
              onClick={() => setTab(kind)}
            >
              {kind === 'templates' ? 'Text templates' : 'AI instructions'}
              {dirty[kind] && <span className="segmented__dot" aria-label="(edited)" />}
            </button>
          ))}
        </div>
        <div className="settings-columns">
          <div className="settings-main">
            <div hidden={tab !== 'templates'}>
              <TemplatesEditor
                key={`templates-${live(data.templates.versions)?.version ?? 0}`}
                settings={data}
                busy={busy}
                saved={savedNote('templates')}
                submit={submit}
                accessToken={accessToken}
                onDirty={(d) => setDirty((s) => ({ ...s, templates: d }))}
              />
            </div>
            <div hidden={tab !== 'ai'}>
              {data.ai.available ? (
                <AiEditor
                  key={`ai-${live(data.ai.versions)?.version ?? 0}`}
                  settings={data}
                  busy={busy}
                  saved={savedNote('ai')}
                  submit={submit}
                  accessToken={accessToken}
                  onDirty={(d) => setDirty((s) => ({ ...s, ai: d }))}
                />
              ) : (
                <p className="notice">
                  {data.businessName} uses the minimum-data setup: customer messages never go to the
                  AI layer, so there are no AI instructions to set.
                </p>
              )}
            </div>
          </div>
          {(tab === 'templates' || data.ai.available) && versions.length > 0 && (
            <VersionHistory<object>
              versions={versions}
              timeZone={me.tenant.timezone}
              canEdit={data.canEdit}
              dirty={dirty[tab]}
              busy={busy}
              label={(key) =>
                tab === 'templates' ? (templateRule(key)?.label ?? key) : (AI_LABEL[key] ?? key)
              }
              onRestore={(version) => restore(tab, version, current?.version ?? null)}
            />
          )}
        </div>
      </>
    );
  }

  return (
    <div className="page">
      <header className="page__header">
        <h1 className="page__title">Templates &amp; AI</h1>
        <p className="page__lede">
          The words your customers get, and what the AI knows about your business.
        </p>
      </header>
      {/* A confirmation shows in the save bar; a refusal shows here, above the reloaded view. */}
      {message?.kind === 'error' && (
        <p className="form-error" role="alert">
          {message.text}
        </p>
      )}
      {body}
    </div>
  );
}
