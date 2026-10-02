import { type } from 'arktype';
import { getAccessToken, gmail, toEmail, type Email, type Gmail, type GoogleAuthEnv } from './gmail';

interface Env extends GoogleAuthEnv {
  AI: Ai;
  // Clef probability a flag (Needs reply, Time-sensitive) must clear to be applied.
  FLAG_FLOOR: string;
  // Unix seconds. Only mail received after this is labeled, never older mail.
  LABEL_AFTER: string;
}

// Every email gets exactly one of these (Clef `choice`), applied as Clef/<Name>.
const CATEGORIES = {
  School: 'Courses, professors, TAs, assignments, grades, and university admin',
  Dev: 'GitHub, CI, deploys, and notifications from developer tools or cloud services',
  Security: 'Sign-in alerts, verification codes, password resets, and account security notices',
  Money: 'Receipts, orders, shipping, invoices, bills, subscriptions, and failed payments',
  Events: 'Invites, RSVPs, tickets, meetups, hackathons, and calendar updates',
  Career: 'Recruiters, job or internship applications, interviews, and offers',
  Newsletters: 'Newsletters, digests, blogs, and product update announcements',
  Promotions: 'Marketing, sales, discounts, and cold outreach',
  People: 'Personal one-to-one messages from real people that fit nowhere else',
} as const;
type Category = keyof typeof CATEGORIES;
const CATEGORY_NAMES = Object.keys(CATEGORIES) as Category[];

// Independent yes/no flags (Clef `noul`), applied on top of the category.
const FLAG_LABELS = {
  needs_reply: 'Clef/Needs reply',
  time_sensitive: 'Clef/Time-sensitive',
} as const;

const ClefResult = type({
  answers: {
    category: { choice: type.enumerated(...CATEGORY_NAMES) },
    needs_reply: { noul: 'number' },
    time_sensitive: { noul: 'number' },
  },
});

const QUESTIONS = {
  category: {
    type: 'choice',
    instructions: 'Which category best fits this email?',
    criteria: CATEGORIES,
  },
  needs_reply: {
    type: 'noul',
    instructions: 'Is a real person directly asking me something or expecting a reply from me? Automated and bulk mail never does.',
  },
  time_sensitive: {
    type: 'noul',
    instructions:
      'Does this need action from me within the next 7 days, such as a deadline, a payment due, an expiring code, or an upcoming event I am attending?',
  },
} as const satisfies Record<keyof typeof ClefResult.infer.answers, { type: 'choice' | 'noul'; instructions: string; criteria?: Record<string, string> }>;

// Free-plan Workers get 50 subrequests per invocation; each message costs
// three (fetch, Clef, label), so stay well under that.
const MAX_PER_RUN = 10;

const categoryLabel = (category: Category) => `Clef/${category}`;

export default {
  async scheduled(_controller, env) {
    await labelInbox(env);
  },
} satisfies ExportedHandler<Env>;

async function labelInbox(env: Env) {
  const mail = gmail(await getAccessToken(env));
  const labelId = await ensureLabels(mail, [
    'Clef',
    ...CATEGORY_NAMES.map(categoryLabel),
    ...Object.values(FLAG_LABELS),
  ]);

  // Every processed message carries exactly one category label, so that
  // label doubles as the "already done" marker. No state store needed.
  const unlabeled = CATEGORY_NAMES.map((c) => `-label:clef-${c.toLowerCase()}`).join(' ');
  const ids = await mail.listMessageIds(`in:inbox after:${env.LABEL_AFTER} ${unlabeled}`, MAX_PER_RUN);
  const floor = Number(env.FLAG_FLOOR);

  const results = await Promise.allSettled(
    ids.map(async (id) => {
      const email = toEmail(await mail.getMessage(id));
      const answers = await classify(env.AI, email);
      const labels = [
        categoryLabel(answers.category.choice),
        ...(answers.needs_reply.noul >= floor ? [FLAG_LABELS.needs_reply] : []),
        ...(answers.time_sensitive.noul >= floor ? [FLAG_LABELS.time_sensitive] : []),
      ];
      await mail.addLabels(id, labels.map(labelId));
      console.log(
        JSON.stringify({
          id,
          from: email.from,
          subject: email.subject,
          labels,
          needs_reply: answers.needs_reply.noul,
          time_sensitive: answers.time_sensitive.noul,
        })
      );
    })
  );

  for (const result of results) {
    if (result.status === 'rejected') console.error('Failed to label message:', result.reason);
  }
}

async function classify(ai: Ai, email: Email) {
  const raw = await ai.run(
    '@cf/cloudflare/clef',
    { model: 'clef', state: email, questions: QUESTIONS },
    { gateway: { id: 'default' } }
  );
  // AI Gateway sometimes wraps the model output in a { result } envelope.
  const result = ClefResult('result' in raw ? raw.result : raw);
  if (result instanceof type.errors) throw new Error(`Unexpected Clef response: ${result.summary}`);
  return result.answers;
}

// Creates any missing labels and returns a name -> id lookup.
async function ensureLabels(mail: Gmail, names: string[]) {
  const ids = new Map((await mail.listLabels()).map((l) => [l.name, l.id]));
  for (const name of names) {
    if (!ids.has(name)) ids.set(name, (await mail.createLabel(name)).id);
  }
  return (name: string) => {
    const id = ids.get(name);
    if (!id) throw new Error(`Gmail label "${name}" is missing`);
    return id;
  };
}
