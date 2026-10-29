import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Sun, Moon } from 'lucide-react';
import { TorusBrand } from '@/components/brand/TorusBrand';
import { useTheme } from '@/shared/hooks/useTheme';
import { LandingNewsSection } from './LandingNewsSection';
import copy from '../../../shared/landing-copy.json';

// Copy source of truth: shared/landing-copy.json — the same file the backend
// renders for crawlers (backend/services/landingSeo.js, SSR-lite for `/`).
// Marketing docs 254896 (landing v3), 254978 (GEO §2 anchor, §4 FAQ), 255025
// (§B model swaps). Vendors are never named on this page; tab names live only
// in the "Tab #N closed" series on /blog.
const SOURCE_REPO_URL = copy.sourceRepoUrl;
const MCP_ENDPOINT = copy.mcpEndpoint;

// Block 3 — the only place on the page where the letters are spelled out.
const INSIDE = copy.inside.cards;

// Block 4 — the story carries no team numbers by the owner's decision (chat
// 3772, 2026-10-22); the only figure is `modelSwaps` (doc 255025 §B).

// Block 7 — the D in G.O.D.: widgets or code, no apology either way.
const SHAPE_ROWS = copy.build.rows;

// Block 8 — technical layer. Expandable cards keep the existing design; each
// card carries the letter it serves.
const UNDER_THE_HOOD = copy.underTheHood.cards;
// Grid spans stay here as literal class names: Tailwind only scans
// index.html + src/**, so a class kept in landing-copy.json is purged from the
// build and every card collapses to one of twelve columns.
const CAP_SPAN: Record<string, string> = {
  '01': 'md:col-span-7',
  '02': 'md:col-span-5',
  '03': 'md:col-span-4',
  '04': 'md:col-span-8',
  '05': 'md:col-span-6',
  '06': 'md:col-span-6',
};

// Block 9 — kept in step with the repository's "What's broken" section.
// Max four items on the landing. Only things we have actually hit.
const BROKEN = copy.broken.items;

// Block 10 — FAQ: five prompt-shaped questions (GEO clusters, doc 254978 §4).
const FAQ = copy.faq.items;

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

type Headline = { pre: string; glow: string; post: string };
// Section headline with the glowing fragment — the JSON keeps the three parts
// so the crawler render (plain text) and this one stay the same sentence.
const Glow = ({ h }: { h: Headline }) => (
  <>
    {h.pre}
    <span className="brutal-glow">{h.glow}</span>
    {h.post}
  </>
);

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
  const copyToClipboard = async () => {
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
          onClick={copyToClipboard}
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

const SectionHeader = ({ title, badge }: { title: string; badge?: string }) => (
  <div className="mb-8 flex items-baseline justify-between gap-4">
    <h2 className="font-mono text-xs font-black uppercase tracking-widest text-[var(--text-secondary)]">
      {title}
    </h2>
    {badge && (
      <span className="brutal-edge shrink-0 border-2 px-2 py-1 font-mono text-[10px] font-black uppercase tracking-widest text-[var(--text-secondary)]">
        {badge}
      </span>
    )}
  </div>
);

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
        /* FAQ rows: the toggle sits on the question's first line, not the card corner. */
        .faq-card .cap-card-toggle { top: 1.5rem; right: 1.25rem; }
        @media (min-width: 768px) {
          .faq-card .cap-card-toggle { top: 2rem; right: 1.75rem; }
        }
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
            SELF-HOST →
          </a>
        </div>
      </header>

      {/* 1. Hero — thesis and category */}
      <section className="relative flex flex-col items-center justify-start overflow-hidden px-6 pt-0 pb-6 md:pt-0 md:pb-12">
        <div className="brutal-grid" aria-hidden />
        <div className="relative flex w-full flex-col items-center">
          <TorusBrand
            size="hero"
            interactive
            className="origin-top scale-[0.9] md:scale-[1.5] -mt-12 md:-mt-24"
          />
          <p className="mt-0 text-center font-mono text-[10px] font-black uppercase tracking-widest text-[var(--text-secondary)] md:mt-64 md:text-xs">
            {copy.hero.kicker}
          </p>
          <h1 className="brutal-glow mt-3 w-full max-w-4xl text-balance break-words text-center text-4xl font-black uppercase leading-[0.95] tracking-tighter text-[var(--text-primary)] sm:text-6xl md:mt-4 md:text-8xl">
            {copy.hero.h1}
          </h1>
          <p className="mt-4 w-full max-w-3xl text-balance text-center text-base font-bold tracking-tight text-[var(--text-secondary)] sm:text-lg md:text-xl">
            {copy.hero.thesis}
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
              SELF-HOST GOD CRM →
            </a>
            <a
              href="#inside"
              className="brutal-edge brutal-shadow inline-flex items-center justify-center gap-2 border-2 px-6 py-3 font-mono text-sm font-black uppercase tracking-widest"
            >
              WHAT&apos;S INSIDE ↓
            </a>
          </div>

          <div className="mt-6 flex max-w-md flex-col items-center gap-2 text-center">
            <Link
              to="/s/help"
              className="font-mono text-[10px] uppercase tracking-widest text-[var(--text-secondary)] underline decoration-dotted underline-offset-4 hover:text-[var(--text-primary)] md:text-xs"
            >
              READ THE DOCS{kbCount !== null ? ` (${kbCount} ARTICLES)` : ''}
            </Link>
            <div className="mt-6 font-mono text-[10px] uppercase tracking-widest text-[var(--text-tertiary)] md:text-xs">
              {copy.hero.tags}
            </div>
          </div>
        </div>
      </section>

      {/* 2. The enemy — the tab. No vendor names on this page. */}
      <section className="brutal-edge relative overflow-hidden border-t-2 bg-[var(--bg-secondary)] px-6 py-16 md:py-24">
        <div className="brutal-scanlines" aria-hidden />
        <div className="relative mx-auto max-w-6xl">
          <SectionHeader title={copy.enemy.title} badge={copy.enemy.badge} />
          <p className="max-w-4xl text-2xl font-black uppercase leading-[1.05] tracking-tight md:text-4xl lg:text-5xl">
            <Glow h={copy.enemy.headline} />
          </p>
          <p className="mt-8 max-w-3xl text-base leading-relaxed text-[var(--text-secondary)] md:text-lg">
            {copy.enemy.body}
          </p>
          {/* Null until Closed Tab #0 ships (doc 255372 §2.2): no link into an empty series. */}
          {copy.enemy.link && (
            <Link
              to="/blog"
              className="mt-8 inline-block font-mono text-xs font-black uppercase tracking-widest underline decoration-dotted underline-offset-4 transition-colors hover:text-[var(--text-secondary)]"
            >
              {copy.enemy.link}
            </Link>
          )}
        </div>
      </section>

      {/* 3. Context · Rights · Memory · Build (hero CTA target) */}
      <section id="inside" className="brutal-edge relative overflow-hidden border-t-2 px-6 py-16 md:py-24">
        <div className="brutal-grid" aria-hidden />
        <div className="relative mx-auto max-w-6xl">
          <SectionHeader title={copy.inside.title} badge={copy.inside.badge} />
          <p className="max-w-4xl text-2xl font-black uppercase leading-[1.05] tracking-tight md:text-4xl">
            <Glow h={copy.inside.headline} />
          </p>
          <p className="mt-4 mb-10 font-mono text-[10px] font-black uppercase tracking-widest text-[var(--text-secondary)] md:text-xs">
            {copy.inside.kicker}
          </p>
          <div className="grid grid-cols-1 gap-0 md:grid-cols-2 lg:grid-cols-4">
            {INSIDE.map((item) => (
              <article
                key={item.label}
                className="brutal-edge brutal-shadow -mt-[2px] border-2 p-6 first:mt-0 md:mt-0 md:-ml-[2px] md:first:ml-0 md:p-8"
              >
                <div className="flex items-baseline gap-4">
                  <span className="font-mono text-4xl font-black opacity-30 md:text-5xl">{item.num}</span>
                  <h3 className="text-xl font-black uppercase tracking-tighter md:text-2xl">{item.label}</h3>
                </div>
                <p className="mt-4 text-base leading-relaxed text-[var(--text-secondary)]">
                  {item.body}
                </p>
                {item.link && (
                  <a
                    href={item.link.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-4 inline-block font-mono text-xs font-black uppercase tracking-widest underline decoration-dotted underline-offset-4 transition-colors hover:text-[var(--text-secondary)]"
                  >
                    {item.link.label}
                  </a>
                )}
              </article>
            ))}
          </div>
          <p className="mt-8 max-w-3xl text-base font-bold leading-relaxed text-[var(--text-primary)] md:text-lg">
            {copy.inside.outro}
          </p>
        </div>
      </section>

      {/* 4. The story — why believe us */}
      <section className="brutal-edge relative overflow-hidden border-t-2 bg-[var(--bg-secondary)] px-6 py-16 md:py-24">
        <div className="brutal-scanlines" aria-hidden />
        <div className="relative mx-auto max-w-6xl">
          <SectionHeader title={copy.story.title} badge={copy.story.badge} />
          <p className="max-w-4xl text-2xl font-black uppercase leading-[1.05] tracking-tight md:text-4xl lg:text-5xl">
            <Glow h={copy.story.headline} />
          </p>
          <p className="mt-8 max-w-3xl text-base leading-relaxed text-[var(--text-secondary)] md:text-lg">
            {copy.story.body}
          </p>
          {/* The one canonical model-swap quote (doc 255025 §B) — cited verbatim site-wide. */}
          <p className="mt-6 max-w-3xl text-base leading-relaxed text-[var(--text-secondary)] md:text-lg">
            {copy.story.swapQuote.pre}{copy.story.modelSwaps}{copy.story.swapQuote.post}{' '}
            {copy.story.conclusion}
          </p>
          <p className="mt-8 font-mono text-[10px] uppercase tracking-widest text-[var(--text-secondary)] md:text-xs">
            {copy.story.credit}
          </p>
        </div>
      </section>

      {/* 5. Connect your agent — public MCP, explicitly read-only */}
      <section
        id="connect-mcp"
        className="brutal-edge relative overflow-hidden border-t-2 px-6 py-16 md:py-24"
      >
        <div className="brutal-grid" aria-hidden />
        <div className="relative mx-auto max-w-5xl">
          <SectionHeader title={copy.connect.title} badge={copy.connect.badge} />
          <p className="text-2xl font-black uppercase leading-[1.05] tracking-tight md:text-4xl">
            <Glow h={copy.connect.headline} />
          </p>
          <p className="mt-6 max-w-3xl text-base leading-relaxed text-[var(--text-secondary)] md:text-lg">
            {copy.connect.body}
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
            {copy.connect.note}
          </p>
        </div>
      </section>

      {/* 6. Video — the walkthrough as recorded */}
      <section className="brutal-edge border-t-2 px-6 py-12 md:py-16">
        <div className="mx-auto max-w-5xl">
          <div className="mb-6 flex items-baseline justify-between">
            <h2 className="font-mono text-xs font-black uppercase tracking-widest text-[var(--text-secondary)]">
              WATCH IT WORK
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

      {/* 7. Build — widgets or code, as a real <table> */}
      <section className="brutal-edge relative overflow-hidden border-t-2 px-6 py-16 md:py-24">
        <div className="mx-auto max-w-6xl">
          <SectionHeader title={copy.build.title} badge={copy.build.badge} />
          <p className="mb-10 max-w-4xl text-2xl font-black uppercase leading-[1.05] tracking-tight md:text-4xl">
            <Glow h={copy.build.headline} />
          </p>
          <div className="brutal-edge overflow-x-auto border-2">
            <table className="w-full min-w-[640px] border-collapse text-left">
              <thead>
                <tr className="brutal-edge border-b-2">
                  <th className="px-4 py-3 font-mono text-[10px] font-black uppercase tracking-widest text-[var(--text-secondary)] md:text-xs">
                    {copy.build.columns.need}
                  </th>
                  <th className="brutal-edge border-l-2 bg-[var(--bg-secondary)] px-4 py-3 font-mono text-[10px] font-black uppercase tracking-widest text-[var(--text-primary)] md:text-xs">
                    {copy.build.columns.widgets}
                  </th>
                  <th className="brutal-edge border-l-2 px-4 py-3 font-mono text-[10px] font-black uppercase tracking-widest text-[var(--text-primary)] md:text-xs">
                    {copy.build.columns.code}
                  </th>
                </tr>
              </thead>
              <tbody>
                {SHAPE_ROWS.map((row) => (
                  <tr key={row.need} className="align-top">
                    <th
                      scope="row"
                      className="px-4 py-5 font-mono text-[10px] font-black uppercase tracking-widest text-[var(--text-secondary)] md:text-xs"
                    >
                      {row.need}
                    </th>
                    <td className="brutal-edge border-l-2 bg-[var(--bg-secondary)] px-4 py-5 text-sm leading-relaxed text-[var(--text-primary)]">
                      {row.widgets}
                    </td>
                    <td className="brutal-edge border-l-2 px-4 py-5 text-sm leading-relaxed text-[var(--text-primary)]">
                      {row.code}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-8 max-w-3xl text-base font-bold leading-relaxed text-[var(--text-primary)] md:text-lg">
            {copy.build.outro}
          </p>
        </div>
      </section>

      {/* 8. Under the hood — technical layer, expandable cards tagged by letter */}
      <section className="brutal-edge relative overflow-hidden border-t-2 px-6 py-16 md:py-24">
        <div className="brutal-grid" aria-hidden />
        <div className="relative mx-auto max-w-6xl">
          <SectionHeader title={copy.underTheHood.title} badge={copy.underTheHood.badge} />
          <p className="mb-10 max-w-3xl text-2xl font-black uppercase leading-[1.05] tracking-tight md:text-4xl">
            <Glow h={copy.underTheHood.headline} />
          </p>
          <div className="grid grid-cols-1 gap-0 md:grid-cols-12">
            {UNDER_THE_HOOD.map((cap) => (
              <details
                key={cap.num}
                className={`cap-card brutal-edge brutal-shadow border-2 ${CAP_SPAN[cap.num] ?? ''} -mt-[2px] md:-ml-[2px] md:mt-0 first:mt-0 md:first:ml-0`}
              >
                <summary aria-label={`Toggle ${cap.label} details`}>
                  <span className="cap-card-toggle" aria-hidden />
                  <span className="brutal-edge inline-block border px-1.5 py-0.5 font-mono text-[10px] font-black uppercase tracking-widest text-[var(--text-secondary)]">
                    {cap.tag}
                  </span>
                  <div className="mt-3 flex items-baseline gap-4 pr-8">
                    <span className="font-mono text-4xl font-black opacity-30 md:text-5xl">{cap.num}</span>
                    <h3 className="text-xl font-black uppercase tracking-tighter md:text-2xl">{cap.label}</h3>
                  </div>
                  <p className="mt-4 text-base leading-relaxed text-[var(--text-secondary)]">
                    {cap.body}
                  </p>
                </summary>
                <div className="cap-card-body">
                  <p className="text-sm leading-relaxed text-[var(--text-secondary)]">
                    {cap.long}
                  </p>
                </div>
              </details>
            ))}
          </div>
          {/* Category anchor (doc 254978 §2): the thesis above is for people,
              this sentence maps "substrate" onto the words people type into a
              prompt. Plain text, not a card. */}
          <p className="mt-10 max-w-4xl text-base leading-relaxed text-[var(--text-secondary)] md:text-lg">
            {copy.underTheHood.anchor}
          </p>
        </div>
      </section>

      {/* 9. What's broken — honest status */}
      <section id="whats-broken" className="brutal-edge relative overflow-hidden border-t-2 bg-[var(--bg-secondary)] px-6 py-16 md:py-24">
        <div className="brutal-scanlines" aria-hidden />
        <div className="relative mx-auto max-w-6xl">
          <SectionHeader title={copy.broken.title} badge={copy.broken.badge} />
          <p className="max-w-4xl text-2xl font-black uppercase leading-[1.05] tracking-tight md:text-4xl">
            <Glow h={copy.broken.headline} />
          </p>
          <p className="mt-8 max-w-3xl text-base leading-relaxed text-[var(--text-secondary)] md:text-lg">
            {copy.broken.body}
          </p>
          <ul className="mt-6 max-w-3xl">
            {BROKEN.map((item) => (
              <li
                key={item}
                className="brutal-edge -mt-[2px] border-2 bg-[var(--bg-primary)] px-5 py-4 text-base leading-relaxed text-[var(--text-primary)] first:mt-0"
              >
                {item}
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* 10. Building in Public — home of the "Tab #N closed" series (renders only when posts exist). */}
      <LandingNewsSection />

      {/* 11. FAQ — the five prompt-shaped questions (GEO clusters). Mirrored as
          FAQPage JSON-LD in index.html. */}
      <section id="faq" className="brutal-edge relative overflow-hidden border-t-2 px-6 py-16 md:py-24">
        <div className="brutal-grid" aria-hidden />
        <div className="relative mx-auto max-w-6xl">
          <SectionHeader title={copy.faq.title} badge={copy.faq.badge} />
          <p className="mb-10 max-w-4xl text-2xl font-black uppercase leading-[1.05] tracking-tight md:text-4xl">
            <Glow h={copy.faq.headline} />
          </p>
          <div>
            {FAQ.map((item) => (
              <details key={item.q} className="cap-card faq-card brutal-edge -mt-[2px] border-2 first:mt-0">
                <summary>
                  <span className="cap-card-toggle" aria-hidden />
                  <h3 className="pr-10 text-lg font-black tracking-tight md:text-xl">{item.q}</h3>
                </summary>
                <div className="cap-card-body">
                  <p className="text-base leading-relaxed text-[var(--text-secondary)]">{item.a}</p>
                </div>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* 12. Final CTA */}
      <section className="brutal-edge relative overflow-hidden border-t-2 px-6 py-16 md:py-24">
        <div className="brutal-grid" aria-hidden />
        <div className="relative mx-auto max-w-6xl">
          <SectionHeader title={copy.finalCta.title} badge={copy.finalCta.badge} />
          <p className="max-w-4xl text-2xl font-black uppercase leading-[1.05] tracking-tight md:text-4xl lg:text-5xl">
            <Glow h={copy.finalCta.headline} />
          </p>
          <p className="mt-8 max-w-3xl text-base leading-relaxed text-[var(--text-secondary)] md:text-lg">
            {copy.finalCta.body}
          </p>
          <div className="mt-8 flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:gap-4">
            <a
              href={SOURCE_REPO_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="brutal-shadow inline-flex items-center justify-center gap-2 border-2 px-6 py-4 font-mono text-sm font-black uppercase tracking-widest text-white md:text-base"
              style={{
                background: 'var(--color-primary-500)',
                borderColor: 'var(--color-primary-500)',
              }}
            >
              SELF-HOST GOD CRM →
            </a>
            <Link
              to="/s/help"
              className="brutal-edge brutal-shadow inline-flex items-center justify-center gap-2 border-2 px-6 py-4 font-mono text-sm font-black uppercase tracking-widest md:text-base"
            >
              READ THE DOCS →
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="brutal-edge border-t-2 px-6 py-10">
        <div className="mx-auto max-w-6xl space-y-4 font-mono text-[10px] uppercase tracking-widest text-[var(--text-secondary)] md:text-xs">
          <p>{copy.footer.copyright}</p>
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
              href={SOURCE_REPO_URL}
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
            <span aria-hidden>·</span>
            <a
              href="https://t.me/god_crm"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-[var(--text-primary)] transition-colors"
            >
              TELEGRAM
            </a>
          </p>
          <div className="brutal-edge mt-6 border-t-2 pt-4 leading-relaxed">
            <p>{copy.footer.lines[0]}</p>
            <p className="text-[var(--text-primary)]">{copy.footer.lines[1]}</p>
            <p>{copy.footer.lines[2]}</p>
          </div>
        </div>
      </footer>
    </main>
  );
};

export default LandingPage;
