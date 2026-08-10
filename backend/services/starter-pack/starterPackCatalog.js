// ADR-0079 — Personal Space Starter Pack v1
// Canonical catalog: 6 universal tables, 5 Tier-A agents, 4 Tier-B (locked) agents.
// All schemas follow ADR-0041 column-type canon: select / multi-select / number / date / url / checkbox / text / textarea / datetime.

export const STARTER_PROJECT_NAME = 'Home';
export const STARTER_PROJECT_ICON = '🏠';

// Tier-A — visible by default in agent picker
export const TIER_A_AGENT_SLUGS = ['tor', 'journal', 'planner', 'researcher', 'agent-smith'];

// Tier-B — hidden by default; unlocked via MASTERMIND / MESHOK promo OR Settings → Add Agent
export const TIER_B_AGENT_SLUGS = ['architect', 'developer-ralph', 'frontend-developer', 'sysadmin'];

// Promo codes that auto-unlock the entire Tier-B coding pack on /auth/register.
// Kept in sync with backend/services/SignupService.js KNOWN_PROMO_COHORTS.
export const TIER_B_UNLOCK_PROMOS = ['MASTERMIND', 'MESHOK'];

/**
 * Six universal starter tables.
 *
 * Seeded with a handful of sample rows per table (see STARTER_TABLE_SEEDS
 * below) so new users see how each table is meant to work; rows can be
 * deleted at any time. Privacy Invariant §5 was relaxed at owner request
 * (chat 3266, 2026-05-31) — empty tables read as "broken" for first-run UX.
 *
 * Each entry is consumed by StarterPackService.createStarterTable().
 */
// `slug` matches the key the frontend Welcome widget reads from
// widget.config.starter_tables_map and shared/starter-pack-copy.json's card.table_slug.
// Do not rename without updating both sides.
export const STARTER_TABLES = [
  {
    slug: 'daily-log',
    name: '📔 Daily Log',
    description: 'Daily journal: mood, energy, note',
    icon: '📔',
    columns: [
      { name: 'date', display: 'Date', type: 'date', order: 0, is_required: 1, config: { default_today: true } },
      { name: 'note', display: 'Note', type: 'textarea', order: 1 },
      {
        name: 'mood', display: 'Mood', type: 'select', order: 2,
        config: {
          options: [
            { label: '😊 great', value: 'great', color: '#22c55e' },
            { label: '🙂 good', value: 'good', color: '#84cc16' },
            { label: '😐 neutral', value: 'neutral', color: '#6b7280' },
            { label: '😕 meh', value: 'meh', color: '#f59e0b' },
            { label: '😢 rough', value: 'rough', color: '#ef4444' }
          ]
        }
      },
      { name: 'energy', display: 'Energy', type: 'number', order: 3, config: { min: 1, max: 5, step: 1 } }
    ]
  },
  {
    slug: 'goals-and-projects',
    name: '🎯 Goals & Projects',
    description: 'Goals and projects: what you want to move forward',
    icon: '🎯',
    columns: [
      { name: 'title', display: 'Title', type: 'text', order: 0, is_required: 1 },
      {
        name: 'type', display: 'Type', type: 'select', order: 1,
        config: { options: [
          { label: 'goal', value: 'goal', color: '#8b5cf6' },
          { label: 'project', value: 'project', color: '#3b82f6' }
        ] }
      },
      {
        name: 'status', display: 'Status', type: 'select', order: 2,
        config: { options: [
          { label: 'idea', value: 'idea', color: '#6b7280' },
          { label: 'doing', value: 'doing', color: '#f59e0b' },
          { label: 'paused', value: 'paused', color: '#94a3b8' },
          { label: 'done', value: 'done', color: '#22c55e' }
        ] }
      },
      { name: 'deadline', display: 'Deadline', type: 'date', order: 3 },
      { name: 'why', display: 'Why', type: 'textarea', order: 4 }
    ]
  },
  {
    slug: 'habits',
    name: '🔁 Habits',
    description: 'Habits and trackers',
    icon: '🔁',
    columns: [
      { name: 'name', display: 'Name', type: 'text', order: 0, is_required: 1 },
      {
        name: 'target', display: 'Period', type: 'select', order: 1,
        config: { options: [
          { label: 'daily', value: 'daily', color: '#22c55e' },
          { label: 'weekly', value: 'weekly', color: '#3b82f6' },
          { label: 'monthly', value: 'monthly', color: '#8b5cf6' }
        ] }
      },
      { name: 'streak', display: 'Streak', type: 'number', order: 2, config: { min: 0, default: 0 } },
      { name: 'last_done', display: 'Last done', type: 'date', order: 3 },
      { name: 'active', display: 'Active', type: 'checkbox', order: 4, config: { default: true } }
    ]
  },
  {
    slug: 'people',
    name: '👥 People',
    description: 'People you stay in touch with',
    icon: '👥',
    columns: [
      { name: 'name', display: 'Name', type: 'text', order: 0, is_required: 1 },
      { name: 'role', display: 'Role', type: 'text', order: 1 },
      { name: 'last_contact', display: 'Last contact', type: 'date', order: 2 },
      { name: 'note', display: 'Note', type: 'textarea', order: 3 },
      { name: 'tags', display: 'Tags', type: 'multi-select', order: 4, config: { options: [] } }
    ]
  },
  {
    slug: 'ideas',
    name: '💡 Ideas',
    description: 'Ideas, links, notes',
    icon: '💡',
    columns: [
      { name: 'title', display: 'Title', type: 'text', order: 0, is_required: 1 },
      { name: 'tag', display: 'Tags', type: 'multi-select', order: 1, config: { options: [] } },
      { name: 'source_url', display: 'Source', type: 'url', order: 2 },
      { name: 'note', display: 'Note', type: 'textarea', order: 3 },
      { name: 'created_at', display: 'Created', type: 'datetime', order: 4, is_system: 1 }
    ]
  },
  {
    slug: 'wishlist',
    name: '📚 Wishlist',
    description: 'Things to try, read, see',
    icon: '📚',
    columns: [
      { name: 'title', display: 'What', type: 'text', order: 0, is_required: 1 },
      {
        name: 'type', display: 'Type', type: 'select', order: 1,
        config: { options: [
          { label: 'book', value: 'book' },
          { label: 'course', value: 'course' },
          { label: 'place', value: 'place' },
          { label: 'thing', value: 'thing' },
          { label: 'experience', value: 'experience' },
          { label: 'food', value: 'food' }
        ] }
      },
      {
        name: 'status', display: 'Status', type: 'select', order: 2,
        config: { options: [
          { label: 'want', value: 'want', color: '#8b5cf6' },
          { label: 'in-progress', value: 'in-progress', color: '#f59e0b' },
          { label: 'have', value: 'have', color: '#3b82f6' },
          { label: 'done', value: 'done', color: '#22c55e' }
        ] }
      },
      { name: 'note', display: 'Note', type: 'textarea', order: 3 },
      { name: 'link', display: 'Link', type: 'url', order: 4 }
    ]
  }
];

// Underscore convention — matches shared/widget-presets.json + frontend WidgetRenderer
// (commit 8d704f83 registered as `welcome_dashboard`). Do not switch to hyphen.
export const WELCOME_WIDGET_PRESET = 'welcome_dashboard';
export const WELCOME_WIDGET_TITLE = '🏠 Welcome';
export const WELCOME_WIDGET_POSITION = { x: 0, y: 0, w: 12, h: 6 };

export const FEATURE_FLAG_KEY = 'starter_pack_enabled';

/**
 * Sample rows per starter-table slug — built per call so date fields stay
 * relative to "today" (registration day) and never drift stale on disk.
 * StarterPackService inserts each row's `data` JSON verbatim into
 * `table_rows.data`. Keep keys in sync with the matching table's columns
 * above (column.name → key).
 *
 * Date columns store 'YYYY-MM-DD'; datetime store ISO; multi-select store
 * string arrays; select store option value (not label).
 */
export function buildStarterTableSeeds() {
  const today = new Date();
  const todayIso = today.toISOString();
  const offsetDate = (days) => {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  };

  return {
    'daily-log': [
      { date: offsetDate(0),  note: 'Day one. Set up CRM, figuring out what goes where.',     mood: 'good',    energy: 4 },
      { date: offsetDate(-1), note: 'Decided to keep a journal — let\'s see how long it lasts.', mood: 'neutral', energy: 3 },
      { date: offsetDate(-2), note: 'Slept badly, pulled the day through on coffee.',         mood: 'meh',     energy: 2 },
      { date: offsetDate(-3), note: 'Long walk and met up with a friend. Recharged.',         mood: 'great',   energy: 5 },
      { date: offsetDate(-7), note: 'Sick all week. Only now starting to feel human again.',  mood: 'rough',   energy: 1 }
    ],
    'goals-and-projects': [
      { title: 'Use CRM as a second brain',     type: 'project', status: 'doing',  deadline: offsetDate(14),  why: 'Want one place for notes, goals and people.' },
      { title: 'Read 12 books this year',       type: 'goal',    status: 'doing',  deadline: offsetDate(150), why: 'Training attention and perspective.' },
      { title: 'Save up for a vacation',        type: 'goal',    status: 'doing',  deadline: offsetDate(90),  why: 'Burned out — need a reset.' },
      { title: 'Launch a blog',                 type: 'project', status: 'idea',   deadline: offsetDate(60),  why: 'Share what I\'m learning.' },
      { title: 'Get English to B2',             type: 'goal',    status: 'doing',  deadline: offsetDate(180), why: 'Opens up work and content.' },
      { title: 'Clean out the garage',          type: 'project', status: 'paused', deadline: offsetDate(30),  why: 'Chaos in the way of thinking.' }
    ],
    'habits': [
      { name: '10-min morning workout',    target: 'daily',  streak: 12, last_done: offsetDate(0),  active: true  },
      { name: 'Read before bed',           target: 'daily',  streak: 5,  last_done: offsetDate(-1), active: true  },
      { name: 'Duolingo English',          target: 'daily',  streak: 21, last_done: offsetDate(0),  active: true  },
      { name: '5,000 steps walk',          target: 'daily',  streak: 0,  last_done: offsetDate(-3), active: true  },
      { name: 'Sugar-free week',           target: 'weekly', streak: 2,  last_done: offsetDate(-2), active: true  },
      { name: '5-min meditation',          target: 'daily',  streak: 0,  last_done: null,           active: false }
    ],
    'people': [
      { name: 'Anton',         role: 'college friend',         last_contact: offsetDate(-7),  note: 'Back from Georgia soon — ask how the trip went.', tags: ['friend'] },
      { name: 'Mom',           role: 'mom',                    last_contact: offsetDate(-2),  note: 'Birthday October 14th.',                           tags: ['family'] },
      { name: 'Lena',          role: 'designer colleague',     last_contact: offsetDate(-14), note: 'Discuss the landing page rebrand.',                tags: ['work'] },
      { name: 'Dr. Ivanov',    role: 'GP',                     last_contact: offsetDate(-45), note: 'Every six months — general checkup.',              tags: ['health'] },
      { name: 'Igor',          role: 'neighbor at the cabin',  last_contact: offsetDate(-30), note: 'Helped with the fence — invite him for tea.',      tags: ['friend', 'local'] },
      { name: 'Anna (mktg)',   role: 'met at a conference',    last_contact: offsetDate(-60), note: 'Promised a positioning consult.',                  tags: ['work', 'network'] }
    ],
    'ideas': [
      { title: 'Start a podcast with friends',                       tag: ['podcast'],                source_url: '',                                        note: 'Weekly, 30 minutes, one topic — no filler.',          created_at: todayIso },
      { title: 'Habit: one letter a day',                            tag: ['habit', 'writing'],       source_url: '',                                        note: 'To anyone — even future me.',                          created_at: todayIso },
      { title: 'Productivity course — after I figure it out myself', tag: ['business', 'education'],  source_url: '',                                        note: 'Only from real experience, not rewriting books.',     created_at: todayIso },
      { title: 'Minimalist travel bag',                              tag: ['design', 'travel'],       source_url: '',                                        note: 'One compartment, everything visible, fits under seat.', created_at: todayIso },
      { title: 'Read "Deep Work" by Cal Newport',                    tag: ['book'],                   source_url: 'https://en.wikipedia.org/wiki/Deep_Work', note: 'Re-read at the start of each year.',                  created_at: todayIso },
      { title: 'Post: "why I quit CRM three times"',                 tag: ['blog', 'writing'],        source_url: '',                                        note: 'Honest — about failures, not success.',               created_at: todayIso }
    ],
    'wishlist': [
      { title: 'Atlas Shrugged',                  type: 'book',       status: 'want', note: 'Heard a million contradictory takes — time to form my own.', link: '' },
      { title: 'Rust course',                     type: 'course',     status: 'want', note: 'Figure out why it beats Go for systems code.',                link: 'https://www.rust-lang.org/learn' },
      { title: 'Week in Georgia',                 type: 'place',      status: 'want', note: 'Tbilisi + Kakheti. Don\'t tell Mom yet.',                     link: '' },
      { title: 'AeroPress',                       type: 'thing',      status: 'have', note: 'Bought it — now learn to brew properly.',                     link: '' },
      { title: 'Skydiving',                       type: 'experience', status: 'want', note: 'Once in a lifetime — must do.',                               link: '' },
      { title: 'Real ramen in Japan',             type: 'food',       status: 'want', note: 'Hokkaido, miso ramen — they say it\'s a different beast.',    link: '' }
    ]
  };
}
