import { parseArgs } from 'node:util';
import { supabaseAuthAdmin } from './auth-admin.js';
import {
  TEXTING_STATES,
  addPerson,
  createBusiness,
  passwordLink,
  disableBusiness,
  goLive,
  listBusinesses,
  setNumber,
  setTexting,
  showBusiness,
  type BusinessSummary,
  type CommandResult,
  type TextingState,
} from './commands.js';
import { loadConfig } from './config.js';
import { createPool, inTransaction } from './db.js';
import { guardProblems } from './guard.js';

/**
 * Fifth Stone Dev's operator CLI: `npm run operator -- <command>`. Reads .env for DATABASE_URL and
 * OPERATOR_CONFIRM_ENV; `create` also needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.
 */

const USAGE = `Usage: npm run operator -- <command>

  list                                   every business: status, stage, texting, setup
  show <slug>                            one business, with its setup steps
  create --slug <s> --name <n> --owner-name <n> --owner-email <e>
         [--timezone America/Chicago] [--workflow service_call]
                                         a new business, onboarding, with its owner's login
  add-person <slug> --name <n> --email <e> [--mobile <+1...>]
                                         a staff member with a login (owner sets permissions)
  password-link <email>                  a fresh set-password link (links expire)
  number <slug> <+1...>                  record the number calls are forwarded to
  texting <slug> <${TEXTING_STATES.join('|')}> [--note <text>]
                                         move the texting status card
  go-live <slug>                         turn the business on (setup finished and a number)
  disable <slug>                         offboard: nothing comes in, nobody signs in

Changes on staging or production also need --confirm <environment>.`;

function describe(b: BusinessSummary): string {
  const done = b.steps.filter((s) => s.done).length;
  return [
    b.slug.padEnd(28),
    b.status.padEnd(11),
    b.stage.padEnd(11),
    `texting ${b.texting}`.padEnd(22),
    (b.connectNumber ?? 'no number').padEnd(13),
    `setup ${done}/${b.steps.length}`,
  ].join(' ');
}

function report<T>(result: CommandResult<T>, done: string): void {
  if (!result.ok) throw new Error(result.error);
  console.log(result.changed ? done : 'Nothing to change.');
}

async function main(argv: string[]): Promise<void> {
  const { positionals, values } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      slug: { type: 'string' },
      name: { type: 'string' },
      'owner-name': { type: 'string' },
      'owner-email': { type: 'string' },
      email: { type: 'string' },
      mobile: { type: 'string' },
      timezone: { type: 'string', default: 'America/Chicago' },
      workflow: { type: 'string', default: 'service_call' },
      note: { type: 'string' },
      confirm: { type: 'string' },
      help: { type: 'boolean' },
    },
  });
  const [command, slugArg, extra] = positionals;
  if (!command || values.help) {
    console.log(USAGE);
    return;
  }

  const config = loadConfig(process.env);
  const guard = (input: { slug?: string; email?: string; number?: string }) => {
    const problems = guardProblems({
      env: config.OPERATOR_CONFIRM_ENV,
      ...input,
      ...(values.confirm ? { confirm: values.confirm } : {}),
    });
    if (problems.length > 0) throw new Error(problems.join('; '));
  };
  // Logins are made through Supabase Auth's admin API; set-password links land on the portal.
  const authAdmin = () => {
    if (!config.SUPABASE_URL || !config.SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error(`${command} needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY`);
    }
    return supabaseAuthAdmin(
      config.SUPABASE_URL,
      config.SUPABASE_SERVICE_ROLE_KEY,
      async (e) => {
        const { rows } = await pool.query<{ id: string }>(
          'select id from auth.users where email = $1',
          [e],
        );
        return rows[0]?.id ?? null;
      },
      config.PORTAL_URL,
    );
  };
  const printLink = (link: string) =>
    console.log(
      `Send this one-time link to set a password (to that person only; it signs them in):\n${link}`,
    );
  const needSlug = () => {
    if (!slugArg) throw new Error(`${command} needs a business slug`);
    return slugArg;
  };

  const pool = createPool(config.DATABASE_URL);
  try {
    switch (command) {
      case 'list': {
        const all = await inTransaction(pool, listBusinesses);
        console.log(all.length ? all.map(describe).join('\n') : 'No businesses.');
        return;
      }
      case 'show': {
        const b = await inTransaction(pool, (c) => showBusiness(c, needSlug()));
        if (!b) throw new Error(`no business ${slugArg}`);
        console.log(`${b.name}\n${describe(b)}\nowner ${b.owner ?? 'none'}`);
        for (const s of b.steps) console.log(`  [${s.done ? 'x' : ' '}] ${s.key}`);
        return;
      }
      case 'create': {
        const input = {
          slug: values.slug ?? '',
          name: values.name ?? '',
          ownerName: values['owner-name'] ?? '',
          ownerEmail: values['owner-email'] ?? '',
          timezone: values.timezone,
          workflow: values.workflow,
        };
        const missing = Object.entries(input).filter(([, v]) => v === '');
        if (missing.length) throw new Error(`create needs ${missing.map(([k]) => k).join(', ')}`);
        guard({ slug: input.slug, email: input.ownerEmail.toLowerCase() });
        const auth = authAdmin();
        const result = await inTransaction(pool, (c) => createBusiness(c, auth, input));
        report(result, `Created ${input.slug} (onboarding).`);
        if (result.ok && result.value) printLink(result.value.setPasswordLink);
        return;
      }
      case 'add-person': {
        const slug = needSlug();
        const name = values.name ?? '';
        const email = values.email ?? '';
        if (!name || !email) throw new Error('add-person needs --name and --email');
        guard({
          slug,
          email: email.toLowerCase(),
          ...(values.mobile ? { number: values.mobile } : {}),
        });
        const auth = authAdmin();
        const result = await inTransaction(pool, (c) =>
          addPerson(c, auth, {
            slug,
            name,
            email,
            ...(values.mobile ? { mobile: values.mobile } : {}),
          }),
        );
        report(result, `Added ${name} to ${slug} as staff.`);
        if (result.ok && result.value) printLink(result.value.setPasswordLink);
        return;
      }
      case 'password-link': {
        const email = slugArg;
        if (!email) throw new Error("password-link needs the person's email");
        guard({ email: email.toLowerCase() });
        const auth = authAdmin();
        const result = await inTransaction(pool, (c) => passwordLink(c, auth, email));
        if (!result.ok) throw new Error(result.error);
        if (result.value) printLink(result.value.setPasswordLink);
        return;
      }
      case 'number': {
        const slug = needSlug();
        if (!extra) throw new Error('number needs the number, like +13195550100');
        guard({ slug, number: extra });
        report(
          await inTransaction(pool, (c) => setNumber(c, slug, extra)),
          `${slug} uses ${extra}.`,
        );
        return;
      }
      case 'texting': {
        const slug = needSlug();
        if (!extra || !(TEXTING_STATES as readonly string[]).includes(extra)) {
          throw new Error(`texting needs one of: ${TEXTING_STATES.join(', ')}`);
        }
        guard({ slug });
        const state = extra as TextingState;
        report(
          await inTransaction(pool, (c) => setTexting(c, slug, state, values.note)),
          `${slug} texting is ${state}.`,
        );
        return;
      }
      case 'go-live': {
        const slug = needSlug();
        guard({ slug });
        const result = await inTransaction(pool, (c) => goLive(c, slug));
        report(result, `${slug} is live.`);
        if (result.ok && result.value && result.value.texting !== 'approved') {
          console.log(
            `Texting is ${result.value.texting}: missed calls reach the Front Desk to call back, and no texts go out until texting is approved.`,
          );
        }
        return;
      }
      case 'disable': {
        const slug = needSlug();
        guard({ slug });
        report(
          await inTransaction(pool, (c) => disableBusiness(c, slug)),
          `${slug} is disabled. Release its number in Twilio separately.`,
        );
        return;
      }
      default:
        throw new Error(`unknown command ${command}\n\n${USAGE}`);
    }
  } finally {
    await pool.end();
  }
}

main(process.argv.slice(2)).catch((error: unknown) => {
  console.error(`operator: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
