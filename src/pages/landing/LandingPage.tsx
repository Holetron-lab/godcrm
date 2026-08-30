import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Sun, Moon } from 'lucide-react';
import { TorusBrand } from '@/components/brand/TorusBrand';
import { useTheme } from '@/shared/hooks/useTheme';
import { LandingNewsSection } from './LandingNewsSection';

const SOURCE_REPO_URL = 'https://godcrm.ai/git/holetron-lab/godcrm';

type CapabilityDownload = { label: string; url: string; filename: string; meta: string };
const CAPABILITIES: Array<{
  num: string;
  label: string;
  span: string;
  body: string;
  long: string;
  live?: boolean;
  download?: CapabilityDownload;
}> = [
  {
    num: '01', label: 'TABLES', span: 'md:col-span-7',
    body: 'Programmable schema. 15+ column types, relations, formulas, JSON, files.',
    long: 'Text, number, date, relation, formula, JSON, file, image, AI-generated. Schema mutates live — no downtime, no migrations. Up to 50 columns per table, soft-cap 10M rows. Row-level policies for fine-grained access.',
  },
  {
    num: '02', label: 'VIEWS', span: 'md:col-span-5',
    body: 'Table, Kanban, Calendar, Timeline, Gallery. Same data, any shape.',
    long: 'Same rows, six shapes: table for power-users, kanban for flow, calendar for time, timeline for gantt, gallery for image-first records, list for mobile. Save filters/sorts per view. Share any view publicly by slug — read-only, no login.',
  },
  {
    num: '03', label: 'WIDGETS', span: 'md:col-span-4',
    body: 'Dashboards from any table. Charts, kanban, counters, docs.',
    long: 'Mount any view + KPI counters + chart blocks on a project dashboard. Drag-resize grid, per-widget settings. Embed widget rows inside documents. Snapshot a widget into chat as a live mini-board.',
  },
  {
    num: '04', label: 'AUTOMATIONS', span: 'md:col-span-8',
    body: 'Triggers and actions on row events. Webhooks, notifications, hot-reload every 5 min.',
    long: 'Trigger on row insert/update/delete, schedule, or external webhook. Actions: HTTP call, post chat message, mutate another row, run an agent, send Telegram. Hot-reloads from DB every 5 min — no restart, no deploy.',
  },
  {
    num: '05', label: 'AGENTS', span: 'md:col-span-6',
    body: 'Native first-class. They read, write, chat, and orchestrate other agents.',
    long: 'Agents are rows in a table. Each has a prompt, a tool whitelist, a model (Claude / GPT-5 / local). Mention with @slug in any chat — they read history, call MCP tools, mutate rows, spawn other agents. First-class participants, not a chatbot bolted on the side.',
  },
  {
    num: '06', label: 'API', span: 'md:col-span-6',
    body: 'REST v3 on every table, row, widget. JWT, OpenAPI, signed webhooks.',
    long: 'REST v3 on every entity — tables, rows, widgets, chats, projects. JWT auth, full OpenAPI 3.1 spec, signed webhooks with token-hash. Pagination, filters, sort, search — the same engine your views use is the same API external systems get.',
  },
  {
    num: '07', label: 'MCP', span: 'md:col-span-8',
    body: 'Native MCP server — 55 tools, ~160 lines. Claude Desktop, Cursor, any MCP client drives your CRM.',
    long: 'Native Model Context Protocol server exposes 55 tools — query tables, create rows, manage widgets, spawn agents, search globally — and the whole server is ~160 lines, because the CRM already does the work. Point Claude Desktop, Cursor, Zed, or any MCP client at your workspace and it operates the CRM like a power user. No glue code, no scraping.',
  },
  {
    num: '08', label: 'ARTIFACTS', span: 'md:col-span-4',
    body: 'Real apps, not browser-only. Android, desktop, Photoshop plugin.',
    long: 'Android app (Flutter) — chat, tables, agents in your pocket. Desktop client for Linux and Windows — file uploads, offline cache. Photoshop plugin — push designs straight into CRM rows. iOS in active development. One platform, many surfaces.',
  },
];

const COMPARISON: Array<{ axis: string; traditional: string; god: string }> = [
  {
    axis: 'SCHEMA',
    traditional: 'Fixed tables. Changing a field is a migration and a deploy.',
    god: '15+ column types, mutated live. Agents add tables and fields at runtime — no migration.',
  },
  {
    axis: 'MODULES',
    traditional: 'A fixed feature set the vendor ships — contacts, deals, pipelines, tickets. Need another? Wait for the roadmap.',
    god: 'Tables, docs, chat, dashboards, kanban/calendar/list widgets, automations, connectors, agents — the building blocks. Agents assemble custom UI for any task on the same canvas, no release cycle.',
  },
  {
    axis: 'WHO OPERATES IT',
    traditional: 'Humans click the UI. Bots are bolt-on integrations.',
    god: 'Humans and agents, same canvas. People work the UI; agents are rows — prompt, tools, model. Both drive the same data from either side.',
  },
  {
    axis: 'AUTOMATION',
    traditional: 'A visual rule-builder, vendor-hosted. Redeploy to change it.',
    god: 'Triggers and actions are DB rows. Hot-reload, no restart — they run agents, HTTP, chat.',
  },
  {
    axis: 'INTEGRATION',
    traditional: 'A catalogue of pre-built connectors plus a REST API.',
    god: 'Native MCP server. Any MCP client — Claude, Cursor — drives the CRM directly.',
  },
  {
    axis: 'OWNERSHIP',
    traditional: 'SaaS. Vendor-hosted, per-seat, your data on their servers.',
    god: 'Open-core. Self-host, own the database, no seat tax.',
  },
];

const MARKETPLACE = [
  {
    label: 'CODE IS CHEAP',
    body: 'Anyone can generate a CRUD screen in an afternoon. What stayed scarce is the system someone built because they ran the business for ten years and know exactly where it bleeds.',
  },
  {
    label: 'PACKAGE & TRADE',
    body: 'On top of the open core: a marketplace. Package a table-system, an automation, a playbook — and trade it, free or paid. What you build, you price.',
  },
  {
    label: 'TABLE WIZARD',
    body: 'Our own first product lands here — a guided wizard that scaffolds a live, synced table from any data source. Building now.',
  },
];

const PROOF = [
  { big: '10–200',        small: 'USERS PER WORKSPACE' },
  { big: 'OPEN-CORE',     small: 'SELF-HOST, YOU OWN IT' },
  { big: 'AGENTS NATIVE', small: 'FIRST-CLASS, NOT BOLTED ON' },
  { big: 'BETA',          small: 'BUILD IN PUBLIC' },
];

const MCP_ENDPOINT = 'https://godcrm.ai/s/help/mcp';

const CONNECT_SNIPPETS: Array<{ label: string; code: string }> = [
  {
    label: 'CLAUDE CODE',
    code: `claude mcp add --transport http godcrm ${MCP_ENDPOINT}`,
  },
  {
    label: 'CLAUDE DESKTOP / CURSOR',
    code: `{
  "mcpServers": {
    "godcrm": {
      "type": "http",
      "url": "${MCP_ENDPOINT}"
    }
  }
}`,
  },
];

const LandingThemeToggle = () => {
  const { theme, toggleTheme } = useTheme();
  return (
    <button
      type="button"
      onClick={() => {
        sessionStorage.setItem('welcome-theme-touched', '1');
        toggleTheme();
      }}
      className="brutal-edge border-2 p-2 transition-colors hover:bg-[var(--text-primary)] hover:text-[var(--bg-primary)]"
      aria-pressed={theme === 'dark'}
      aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
    >
      {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </button>
  );
};

const CopyBlock = ({ label, code }: { label: string; code: string }) => {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard unavailable (insecure context / denied) — user selects manually
    }
  };
  return (
    <div className="brutal-edge border-2">
      <div className="brutal-edge flex items-center justify-between border-b-2 px-3 py-2">
        <span className="font-mono text-[10px] font-black uppercase tracking-widest text-[var(--text-secondary)] md:text-xs">
          {label}
        </span>
        <button
          type="button"
          onClick={copy}
          className="brutal-edge brutal-shadow border-2 px-2 py-1 font-mono text-[10px] font-black uppercase tracking-widest"
          aria-label={`Copy ${label} connect snippet`}
        >
          {copied ? '✓ COPIED' : 'COPY'}
        </button>
      </div>
      <pre className="overflow-x-auto px-3 py-3 font-mono text-xs leading-relaxed text-[var(--text-primary)]">
        <code>{code}</code>
      </pre>
    </div>
  );
};


const LandingPage = () => {
  const { setTheme } = useTheme();
  const [kbCount, setKbCount] = useState<number | null>(null);

  useEffect(() => {
    const userDefault = localStorage.getItem('god-crm-default-theme');
    const touched = sessionStorage.getItem('welcome-theme-touched');
    if ((!userDefault || userDefault === 'system') && !touched) {
      setTheme('dark');
    }
  }, [setTheme]);

  useEffect(() => {
    const ctrl = new AbortController();
    fetch('/api/v3/public/s/help/docs?limit=100', { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((json: unknown) => {
        const data = json as { data?: { documents?: Array<{ name?: string; slug?: string }> } } | null;
        const list = data?.data?.documents;
        if (!Array.isArray(list)) return;
        setKbCount(list.length);
      })
      .catch(() => {});
    return () => ctrl.abort();
  }, []);

  return (
    <main className="brutal-root relative min-h-screen overflow-x-hidden bg-[var(--bg-primary)] text-[var(--text-primary)]">
      <style>{`
        .brutal-edge { border-color: var(--text-primary); }
        .brutal-shadow {
          transition: transform 150ms ease-out, box-shadow 150ms ease-out;
        }
        .brutal-shadow:hover {
          box-shadow: 6px 6px 0 var(--text-primary);
          transform: translate(-2px, -2px);
        }
        .brutal-grid {
          position: absolute;
          inset: 0;
          pointer-events: none;
          background-image:
            linear-gradient(var(--text-primary) 1px, transparent 1px),
            linear-gradient(90deg, var(--text-primary) 1px, transparent 1px);
          background-size: 40px 40px;
          /* Anchor every grid to the viewport lattice so adjacent sections
             share the same 40px phase — no squished "short row" at section
             seams (e.g. hero → BUILDING IN PUBLIC). */
          background-attachment: fixed;
          opacity: 0.05;
        }
        .brutal-glow {
          text-shadow: 0 0 24px var(--accent-primary);
        }
        .brutal-scanlines {
          position: absolute;
          inset: 0;
          pointer-events: none;
          background-image: repeating-linear-gradient(
            0deg,
            transparent 0px,
            transparent 3px,
            var(--text-primary) 3px,
            var(--text-primary) 4px
          );
          opacity: 0.025;
        }
        .cap-card { position: relative; cursor: pointer; }
        .cap-card > summary {
          list-style: none;
          cursor: pointer;
          display: block;
          padding: 1.5rem;
        }
        @media (min-width: 768px) {
          .cap-card > summary { padding: 2rem; }
        }
        .cap-card > summary::-webkit-details-marker { display: none; }
        .cap-card-toggle {
          position: absolute;
          top: 0.75rem;
          right: 0.75rem;
          width: 1.75rem;
          height: 1.75rem;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
          font-size: 1.1rem;
          font-weight: 900;
          color: var(--text-secondary);
          pointer-events: none;
          transition: color 150ms ease-out;
        }
        .cap-card:hover .cap-card-toggle { color: var(--text-primary); }
        .cap-card-toggle::before { content: '+'; }
        .cap-card[open] .cap-card-toggle::before { content: '–'; }
        .cap-card-body {
          padding: 0 1.5rem 1.5rem;
        }
        @media (min-width: 768px) {
          .cap-card-body { padding: 0 2rem 2rem; }
        }
        @media (prefers-reduced-motion: reduce) {
          .brutal-shadow { transition: none; }
          .brutal-shadow:hover { box-shadow: none; transform: none; }
          .brutal-glow { text-shadow: none; }
          .brutal-scanlines { display: none; }
        }
      `}</style>

      {/* Top bar */}
      <header className="brutal-edge sticky top-0 z-40 flex h-14 items-center justify-between border-b-2 bg-[var(--bg-primary)] px-4 md:px-6">
        <div className="flex items-center gap-2 font-mono text-sm font-black uppercase tracking-widest">
          <span>GOD CRM</span>
          <span
            aria-hidden
            className="inline-block h-2 w-2 rounded-full bg-red-500"
            style={{ animation: 'pulse 2s ease-in-out infinite' }}
          />
        </div>
        <div className="flex items-center gap-2 md:gap-3">
          <LandingThemeToggle />
          <a
            href={SOURCE_REPO_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="brutal-shadow inline-flex items-center justify-center border-2 px-3 py-2 font-mono text-xs font-black uppercase tracking-widest text-white"
            style={{
              background: 'var(--color-primary-500)',
              borderColor: 'var(--color-primary-500)',
            }}
          >
            GET IT →
          </a>
        </div>
      </header>

      {/* Hero */}
      <section className="relative flex flex-col items-center justify-start overflow-hidden px-6 pt-0 pb-6 md:pt-0 md:pb-12">
        <div className="brutal-grid" aria-hidden />
        <div className="relative flex w-full flex-col items-center">
          <TorusBrand
            size="hero"
            interactive
            className="origin-top scale-[0.9] md:scale-[1.5] -mt-12 md:-mt-24"
          />
          <h1 className="brutal-glow mt-0 w-full max-w-4xl text-balance break-words text-center text-3xl font-black uppercase leading-[0.95] tracking-tighter text-[var(--text-primary)] sm:text-5xl md:mt-64 md:text-7xl">
            Everything is a row.
          </h1>
          <p className="mt-4 w-full max-w-3xl text-balance text-center text-base font-bold uppercase tracking-tight text-[var(--text-secondary)] sm:text-lg md:text-xl">
            The self-configuring CRM. Agents build it — and reshape it when you change.
          </p>
          <div className="mt-6 flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:gap-4 md:mt-8">
            <a
              href={SOURCE_REPO_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="brutal-edge brutal-shadow inline-flex items-center justify-center gap-2 border-2 px-6 py-3 font-mono text-sm font-black uppercase tracking-widest text-white"
              style={{
                background: 'var(--color-primary-500)',
                borderColor: 'var(--color-primary-500)',
              }}
            >
              READ THE CODE →
            </a>
            <a
              href="#connect-mcp"
              className="brutal-edge brutal-shadow inline-flex items-center justify-center gap-2 border-2 px-6 py-3 font-mono text-sm font-black uppercase tracking-widest"
            >
              CONNECT VIA MCP
            </a>
            <a
              href="https://t.me/god_crm"
              target="_blank"
              rel="noopener noreferrer"
              className="brutal-edge brutal-shadow inline-flex items-center justify-center gap-2 border-2 px-6 py-3 font-mono text-sm font-black uppercase tracking-widest"
            >
              ▶ JOIN TELEGRAM
            </a>
          </div>

          {/* Hero KB preview — one tight line: live proof that /s/help is a real public surface */}
          <div className="mt-6 flex max-w-md flex-col items-center gap-2 text-center md:items-start md:text-left">
            <Link
              to="/s/help"
              className="font-mono text-[10px] uppercase tracking-widest text-[var(--text-secondary)] underline decoration-dotted underline-offset-4 hover:text-[var(--text-primary)] md:text-xs"
            >
              NEW HERE? → KNOWLEDGE BASE{kbCount !== null ? ` (${kbCount} ARTICLES)` : ''}
            </Link>
            <div className="mt-6 font-mono text-[10px] uppercase tracking-widest text-[var(--text-tertiary)] md:text-xs">
              v1.2.0-beta · self-host · open-core
            </div>
          </div>
        </div>
      </section>

      {/* Building in Public — neutral RowCardsWidget feed (renders only when posts exist).
          Sits directly under the hero badge: proof-of-life before the pitch. */}
      <LandingNewsSection />

      {/* Manifesto */}
      <section className="brutal-edge relative overflow-hidden border-y-2 px-6 py-24 md:py-32">
        <div className="brutal-scanlines" aria-hidden />
        <div className="relative mx-auto max-w-5xl space-y-8 text-2xl font-black uppercase leading-[1.05] tracking-tight md:text-4xl lg:text-5xl">
          <p>
            We started from a simple question.<br />
            Why do all CRMs assume the operator is a <span className="brutal-glow">human</span>?
          </p>
          <p>
            GOD CRM is built the other way around. <span className="brutal-glow">Agents</span> read rows,
            mutate state, and talk back — through the same <span className="brutal-glow">API</span> you use.
            No plugins. No <span className="brutal-glow">bolt-ons</span>.
          </p>
        </div>
      </section>

      {/* Connect via MCP — the no-signup front door */}
      <section
        id="connect-mcp"
        className="brutal-edge relative overflow-hidden border-y-2 bg-[var(--bg-secondary)] px-6 py-16 md:py-24"
      >
        <div className="brutal-grid" aria-hidden />
        <div className="relative mx-auto max-w-5xl">
          <div className="mb-8 flex items-baseline justify-between">
            <h2 className="font-mono text-xs font-black uppercase tracking-widest text-[var(--text-secondary)]">
              CONNECT VIA MCP
            </h2>
            <span className="brutal-edge border-2 px-2 py-1 font-mono text-[10px] font-black uppercase tracking-widest text-[var(--text-primary)]">
              NO SIGNUP
            </span>
          </div>
          <p className="text-2xl font-black uppercase leading-[1.05] tracking-tight md:text-4xl">
            Point any MCP client at the CRM.<br />
            <span className="brutal-glow">No login. No token.</span>
          </p>
          <p className="mt-6 max-w-3xl text-base leading-relaxed text-[var(--text-secondary)] md:text-lg">
            Drop the endpoint into Claude Desktop, Claude Code, Cursor, Zed — any MCP client. It
            connects to a live, read-safe demo space and operates GOD CRM like a power user: query
            tables, read docs, search globally. Want write access? Self-host it — clone, run, you're the admin.
          </p>

          <div className="brutal-edge brutal-shadow mt-8 flex flex-col gap-2 border-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <span className="font-mono text-xs font-black uppercase tracking-widest text-[var(--text-secondary)]">
              ENDPOINT
            </span>
            <code className="break-all font-mono text-sm font-black tracking-tight text-[var(--text-primary)] sm:text-base">
              {MCP_ENDPOINT}
            </code>
          </div>

          <div className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-2">
            {CONNECT_SNIPPETS.map((s) => (
              <CopyBlock key={s.label} label={s.label} code={s.code} />
            ))}
          </div>

          <p className="mt-6 font-mono text-[10px] uppercase tracking-widest text-[var(--text-secondary)] md:text-xs">
            ANONYMOUS TIER · READ-SAFE TOOLS · LIVE DEMO SPACE
          </p>
        </div>
      </section>

      {/* Video showcase — 90s walkthrough. Sits right after CONNECT: you've
          read how the door works, now watch it move, before the proof feed. */}
      <section className="px-6 py-12 md:py-16">
        <div className="mx-auto max-w-5xl">
          <div className="mb-6 flex items-baseline justify-between">
            <h2 className="font-mono text-xs font-black uppercase tracking-widest text-[var(--text-secondary)]">
              WHAT IT FEELS LIKE
            </h2>
            <span className="font-mono text-xs uppercase tracking-widest text-[var(--text-secondary)]">
              ▶ WATCH
            </span>
          </div>
          <div className="brutal-edge brutal-shadow relative aspect-video overflow-hidden border-2">
            <iframe
              className="absolute inset-0 h-full w-full"
              src="https://www.youtube.com/embed/YPeci9VevO8?rel=0"
              title="GOD CRM — what it feels like (everything is a row, ep. 4)"
              loading="lazy"
              referrerPolicy="strict-origin-when-cross-origin"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              allowFullScreen
            />
          </div>
        </div>
      </section>

      {/* Capabilities */}
      <section className="brutal-edge relative overflow-hidden border-t-2 px-6 py-16 md:py-24">
        <div className="brutal-grid" aria-hidden />
        <div className="relative mx-auto max-w-6xl">
          <div className="mb-8 flex items-baseline justify-between">
            <h2 className="font-mono text-xs font-black uppercase tracking-widest text-[var(--text-secondary)]">
              CAPABILITIES
            </h2>
            <span className="font-mono text-xs uppercase tracking-widest text-[var(--text-secondary)]">
              08 / 08
            </span>
          </div>
          <div className="grid grid-cols-1 gap-0 md:grid-cols-12">
            {CAPABILITIES.map((cap) => (
              <details
                key={cap.num}
                className={`cap-card brutal-edge brutal-shadow border-2 ${cap.span} -mt-[2px] md:-ml-[2px] md:mt-0 first:mt-0 md:first:ml-0`}
              >
                <summary aria-label={`Toggle ${cap.label} details`}>
                  <span className="cap-card-toggle" aria-hidden />
                  <div className="flex items-baseline gap-4 pr-8">
                    <span className="font-mono text-4xl font-black opacity-30 md:text-5xl">{cap.num}</span>
                    <h3 className="text-xl font-black uppercase tracking-tighter md:text-2xl">{cap.label}</h3>
                    {cap.live && (
                      <span
                        aria-label="Live now"
                        className="ml-1 inline-flex items-center gap-1 border-2 border-green-500 px-1.5 py-0.5 font-mono text-[10px] font-black uppercase tracking-widest text-green-500"
                      >
                        <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-green-500" />
                        LIVE
                      </span>
                    )}
                  </div>
                  <p className="mt-4 text-base leading-relaxed text-[var(--text-secondary)]">
                    {cap.body}
                  </p>
                </summary>
                <div className="cap-card-body">
                  {cap.download && (
                    <a
                      href={cap.download.url}
                      download={cap.download.filename}
                      onClick={(e) => e.stopPropagation()}
                      className="brutal-edge brutal-shadow mb-4 inline-flex flex-wrap items-center gap-x-3 gap-y-1 border-2 px-3 py-2 font-mono text-xs font-black uppercase tracking-widest text-[var(--text-primary)] hover:text-[var(--text-primary)]"
                    >
                      <span>↓ DOWNLOAD {cap.download.label}</span>
                      <span className="font-mono text-[10px] font-normal tracking-widest text-[var(--text-secondary)]">
                        {cap.download.meta}
                      </span>
                    </a>
                  )}
                  <p className="text-sm leading-relaxed text-[var(--text-secondary)]">
                    {cap.long}
                  </p>
                </div>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* Comparison — static vs self-configuring. Its own section above the
          marketplace: a real <table>, the GEO unit LLMs parse and cite most
          readily. The structural claim (schema-first vs schema-emergent) is a
          fact about architecture — quotable without sounding like a put-down. */}
      <section className="brutal-edge relative overflow-hidden border-t-2 px-6 py-16 md:py-24">
        <div className="mx-auto max-w-6xl">
          <div className="mb-8 flex items-baseline justify-between">
            <h2 className="font-mono text-xs font-black uppercase tracking-widest text-[var(--text-secondary)]">
              STATIC VS SELF-CONFIGURING
            </h2>
            <span className="brutal-edge border-2 px-2 py-1 font-mono text-[10px] font-black uppercase tracking-widest text-[var(--text-secondary)]">
              THE DIFFERENCE
            </span>
          </div>
          <p className="mb-10 max-w-3xl text-2xl font-black uppercase leading-[1.05] tracking-tight md:text-4xl">
            Every other CRM is <span className="brutal-glow">schema-first</span>.<br />
            GOD CRM is <span className="brutal-glow">schema-emergent</span>.
          </p>
          <div className="brutal-edge overflow-x-auto border-2">
            <table className="w-full min-w-[640px] border-collapse text-left">
              <thead>
                <tr className="brutal-edge border-b-2">
                  <th className="px-4 py-3 font-mono text-[10px] font-black uppercase tracking-widest text-[var(--text-secondary)] md:text-xs">
                    <span className="sr-only">Axis</span>
                  </th>
                  <th className="brutal-edge border-l-2 px-4 py-3 font-mono text-[10px] font-black uppercase tracking-widest text-[var(--text-secondary)] md:text-xs">
                    TRADITIONAL CRM
                  </th>
                  <th className="brutal-edge border-l-2 bg-[var(--bg-secondary)] px-4 py-3 font-mono text-[10px] font-black uppercase tracking-widest text-[var(--text-primary)] md:text-xs">
                    GOD CRM
                  </th>
                </tr>
              </thead>
              <tbody>
                {COMPARISON.map((row) => (
                  <tr key={row.axis} className="align-top">
                    <th
                      scope="row"
                      className="px-4 py-5 font-mono text-[10px] font-black uppercase tracking-widest text-[var(--text-secondary)] md:text-xs"
                    >
                      {row.axis}
                    </th>
                    <td className="brutal-edge border-l-2 px-4 py-5 text-sm leading-relaxed text-[var(--text-secondary)]">
                      {row.traditional}
                    </td>
                    <td className="brutal-edge border-l-2 bg-[var(--bg-secondary)] px-4 py-5 text-sm leading-relaxed text-[var(--text-primary)]">
                      {row.god}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* Marketplace */}
      <section className="brutal-edge relative overflow-hidden border-t-2 px-6 py-16 md:py-24">
        <div className="brutal-grid" aria-hidden />
        <div className="relative mx-auto max-w-6xl">
          <div className="mb-8 flex items-baseline justify-between">
            <h2 className="font-mono text-xs font-black uppercase tracking-widest text-[var(--text-secondary)]">
              MARKETPLACE
            </h2>
            <span className="brutal-edge border-2 px-2 py-1 font-mono text-[10px] font-black uppercase tracking-widest text-[var(--text-secondary)]">
              BUILDING
            </span>
          </div>
          <p className="mb-8 max-w-3xl text-2xl font-black uppercase leading-[1.05] tracking-tight md:text-4xl">
            A market for what you <span className="brutal-glow">know</span>.
          </p>
          <div className="grid grid-cols-1 gap-0 md:grid-cols-3">
            {MARKETPLACE.map((item) => (
              <article
                key={item.label}
                className="brutal-edge -mt-[2px] border-2 p-6 first:mt-0 md:-ml-[2px] md:mt-0 md:first:ml-0"
              >
                <h3 className="text-xl font-black uppercase tracking-tighter md:text-2xl">{item.label}</h3>
                <p className="mt-4 text-base leading-relaxed text-[var(--text-secondary)]">
                  {item.body}
                </p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* Audience → reframed: not who it's for, but how it fits */}
      <section className="brutal-edge border-t-2 px-6 py-16 md:py-24">
        <div className="mx-auto max-w-6xl">
          <div className="mb-10 flex items-baseline justify-between">
            <h2 className="font-mono text-xs font-black uppercase tracking-widest text-[var(--text-secondary)]">
              WHO IT'S FOR
            </h2>
            <span className="brutal-edge border-2 px-2 py-1 font-mono text-[10px] font-black uppercase tracking-widest text-[var(--text-secondary)]">
              FITS YOU
            </span>
          </div>
          <p className="max-w-4xl text-2xl font-black uppercase leading-[1.05] tracking-tight md:text-4xl lg:text-5xl">
            Not a CRM for a kind of company.<br />
            A CRM that becomes <span className="brutal-glow">your</span> shape.
          </p>
          <p className="mt-8 max-w-3xl text-base leading-relaxed text-[var(--text-secondary)] md:text-lg">
            Most CRMs make you fit your work into their structure. GOD CRM does the opposite.
            Describe what you need in plain language and its AI agents build the tables, fields,
            links and automations on the fly — then rebuild them when your process changes. No setup
            project. No admin panel. No consultant. The system configures itself to how you actually work.
          </p>
          <p className="mt-6 max-w-3xl text-base leading-relaxed text-[var(--text-secondary)] md:text-lg">
            A studio runs it as a booking system. A workshop runs it as inventory. Our own shop runs
            it as all of it at once. Same product — configured by agents, not by you.
          </p>

          <p className="mt-8 max-w-3xl text-base leading-relaxed text-[var(--text-secondary)] md:text-lg">
            Pick a traditional CRM if your process never changes and already matches a standard sales
            pipeline — you set it up once, then fit your work to its structure. Pick GOD CRM if your
            process is <span className="brutal-glow">yours</span>: it shapes itself to how you actually
            work and rebuilds itself when you change.
          </p>
        </div>
      </section>

      {/* Proof */}
      <section className="brutal-edge border-y-2 bg-[var(--bg-secondary)] px-6 py-16">
        <div className="mx-auto grid max-w-6xl grid-cols-2 gap-8 md:grid-cols-4">
          {PROOF.map((p) => (
            <div key={p.small} className="text-center">
              <div className="text-3xl font-black uppercase tracking-tighter md:text-4xl">{p.big}</div>
              <div className="mt-2 font-mono text-[10px] uppercase tracking-widest text-[var(--text-secondary)] md:text-xs">
                {p.small}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Read the code */}
      <section className="relative overflow-hidden px-6 py-16">
        <div className="brutal-grid" aria-hidden />
        <div className="relative mx-auto max-w-6xl">
          <div className="mb-10 flex items-baseline justify-between">
            <h2 className="font-mono text-xs font-black uppercase tracking-widest text-[var(--text-secondary)]">
              GET STARTED
            </h2>
            <span className="brutal-edge border-2 px-2 py-1 font-mono text-[10px] font-black uppercase tracking-widest text-[var(--text-secondary)]">
              SELF-HOST
            </span>
          </div>
          <p className="max-w-4xl text-2xl font-black uppercase leading-[1.05] tracking-tight md:text-4xl lg:text-5xl">
            Want to see how it <span className="brutal-glow">actually works</span>? It's <span className="brutal-glow">all open</span> — the CRM, the MCP server, the agents.
          </p>
          <div className="mt-8 flex">
            <a
              href={SOURCE_REPO_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="brutal-shadow inline-flex w-full max-w-2xl items-center justify-center gap-2 border-2 px-6 py-5 font-mono text-sm font-black uppercase tracking-widest text-white md:text-base"
              style={{
                background: 'var(--color-primary-500)',
                borderColor: 'var(--color-primary-500)',
              }}
            >
              READ THE CODE → GODCRM.AI/GIT/GODCRM
            </a>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="brutal-edge border-t-2 px-6 py-10">
        <div className="mx-auto max-w-6xl space-y-4 font-mono text-[10px] uppercase tracking-widest text-[var(--text-secondary)] md:text-xs">
          <p>© 2026 HOLETRON LTD</p>
          <p className="flex flex-wrap gap-x-3 gap-y-2">
            <a
              href="https://hltrn.cc"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-[var(--text-primary)] transition-colors"
            >
              HLTRN.CC
            </a>
            <span aria-hidden>·</span>
            <a
              href="https://godcrm.ai/git/holetron-lab/godcrm"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-[var(--text-primary)] transition-colors"
            >
              GODCRM.AI/GIT
            </a>
            <span aria-hidden>·</span>
            <Link
              to="/s/help"
              className="hover:text-[var(--text-primary)] transition-colors"
            >
              KNOWLEDGE BASE
            </Link>
            <span aria-hidden>·</span>
            <Link
              to="/blog"
              className="hover:text-[var(--text-primary)] transition-colors"
            >
              BLOG
            </Link>
          </p>
          <div className="brutal-edge mt-6 border-t-2 pt-4 leading-relaxed">
            <p>GENERATIVE ORCHESTRATION & DEVELOPMENT</p>
            <p>CRITICAL RESOURCE MANAGER</p>
          </div>
        </div>
      </footer>
    </main>
  );
};

export default LandingPage;
