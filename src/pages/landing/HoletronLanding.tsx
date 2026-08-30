import { useEffect } from 'react';
import { useTheme } from '@/shared/hooks/useTheme';

const HOLETRON_PALETTE = {
  bg: '#0a0a0a',
  bgPanel: '#181818',
  fg: '#f5f5f5',
  muted: '#a2a2a2',
  border: 'rgba(210, 210, 210, 0.12)',
  purple: '#8a12ef',
  purpleDeep: '#5f00ac',
  purpleLight: '#826dff',
  pink: '#c94abc',
  teal: '#06ac8e',
  gold: '#ba8d18',
};

const HoletronLogo = ({ size = 96 }: { size?: number }) => (
  <svg
    width={size}
    height={Math.round(size * (41 / 36))}
    viewBox="0 0 36 41"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden
  >
    <path
      fillRule="evenodd"
      clipRule="evenodd"
      d="M35.9784 22.6879L36 24.948C36 25.2292 36 25.5212 35.9676 25.8023C35.8594 27.3704 35.362 28.8843 34.4752 30.4091C34.3743 30.5822 34.2806 30.7227 34.1941 30.8309C34.0643 31.0688 33.9201 31.2959 33.7615 31.5122L33.6858 31.6311L33.675 31.6419H33.6642L33.5777 31.5122C33.3722 31.2526 33.1992 30.9715 33.0369 30.6795V30.6687C32.9865 30.5966 32.9324 30.5173 32.8747 30.4308C31.7933 28.6573 31.2634 26.8946 31.231 25.0345V13.7555C31.231 13.3662 31.0255 13.0093 30.7011 12.8038L26.1051 9.95975L21.3902 7.05077L19.2382 5.72064C18.8813 5.49354 18.4272 5.49354 18.0595 5.72064L16.0372 6.97507L15.7236 7.16972V16.6861C15.7236 17.3025 16.2211 17.7999 16.8483 17.7999H20.2655C20.8819 17.7999 21.3902 17.3025 21.3902 16.6861V12.2956C21.3902 11.4196 22.3527 10.8789 23.0988 11.3439L25.5752 12.8687C25.9105 13.0742 26.1051 13.4419 26.1051 13.8312V30.766H26.116V35.6864C26.116 36.0757 25.9105 36.4434 25.5752 36.638L23.6287 37.8492L23.5963 37.86L23.1421 38.152L21.0874 39.4172L19.9628 40.1093L19.2382 40.5635C18.8813 40.7798 18.4163 40.7798 18.0595 40.5635L14.1556 38.152L1.61129 30.3875L1.47071 30.301C1.14629 30.1063 0.940823 29.7387 0.940823 29.3494V16.4698C0.868729 16.3977 0.800241 16.322 0.735356 16.2427C0.281166 15.6912 0 14.9883 0 14.2097C0 13.3229 0.356864 12.5227 0.940823 11.9495C1.05617 11.8414 1.17513 11.7441 1.29769 11.6576C1.33373 11.6215 1.37339 11.5927 1.41664 11.571C1.46711 11.535 1.51757 11.5026 1.56804 11.4737C2.03304 11.1925 2.58456 11.0412 3.16852 11.0412C3.31271 11.0412 3.45329 11.052 3.59027 11.0736C3.66597 11.0736 3.74166 11.0952 3.80655 11.106H3.81736C3.87504 11.1205 3.93271 11.1349 3.99039 11.1493C4.96365 11.4088 5.75308 12.1226 6.12076 13.0526C6.26134 13.4094 6.33704 13.7987 6.33704 14.2097C6.33704 14.8585 6.14239 15.4749 5.80715 15.9724C5.76389 16.0372 5.71703 16.1021 5.66657 16.167V26.7215C5.66657 27.1108 5.87203 27.4785 6.19646 27.684L18.0595 35.0051C18.4272 35.2322 18.8813 35.2322 19.2382 35.0051L21.0874 33.8696L21.3902 33.6858V23.6503C21.3902 23.0231 20.8819 22.5257 20.2655 22.5257H16.8483C16.2211 22.5257 15.7236 23.0231 15.7236 23.6503V27.8462C15.7236 28.7221 14.7612 29.2628 14.0042 28.7978L11.5278 27.2622C11.2034 27.0568 10.9979 26.6999 10.9979 26.3106V5.15831C10.9979 4.769 11.2034 4.41214 11.5386 4.20667V4.19585L14.1556 2.57374L15.4317 1.78432L16.0264 1.41664L18.0595 0.162211C18.4272 -0.0540703 18.8813 -0.0540703 19.2382 0.162211L23.1421 2.58456L35.4377 10.1868C35.7729 10.3923 35.9676 10.7492 35.9676 11.1385V22.3851L35.9784 22.6879ZM5.16912 14.2097C5.16912 13.1066 4.27155 12.2199 3.17933 12.2199C2.0763 12.2199 1.17873 13.1066 1.17873 14.2097C1.17873 15.3127 2.0763 16.1995 3.17933 16.1995C4.27155 16.1995 5.16912 15.3127 5.16912 14.2097ZM34.6807 25.4887C34.6591 25.1859 34.623 24.8868 34.5725 24.5912C34.5293 24.3172 34.4716 24.0469 34.3995 23.7801C34.2986 23.4052 34.176 23.0412 34.0318 22.6879C33.8949 22.3491 33.7327 22.0246 33.5452 21.7146C33.3722 22.0282 33.2208 22.3527 33.091 22.6879C32.9252 23.1205 32.7918 23.5638 32.6909 24.018C32.6909 24.0252 32.6909 24.0288 32.6909 24.0288C32.6332 24.31 32.5864 24.5948 32.5503 24.8831V24.894C32.5143 25.2184 32.4962 25.5464 32.4962 25.878C32.4854 27.4353 32.8639 28.96 33.6317 30.1604C34.4428 28.8195 34.7888 27.1433 34.6807 25.4887Z"
      fill="currentColor"
    />
  </svg>
);

const HoletronLanding = () => {
  const { setTheme } = useTheme();

  useEffect(() => {
    setTheme('dark');
    document.documentElement.setAttribute('lang', 'en');
  }, [setTheme]);

  return (
    <main
      className="hltrn-root relative min-h-screen overflow-x-hidden"
      style={{ background: HOLETRON_PALETTE.bg, color: HOLETRON_PALETTE.fg }}
    >
      <style>{`
        .hltrn-root {
          font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
          font-feature-settings: "ss01", "cv11";
        }
        .hltrn-root ::selection {
          background: ${HOLETRON_PALETTE.purple};
          color: ${HOLETRON_PALETTE.fg};
        }
        .hltrn-grid {
          position: absolute;
          inset: 0;
          pointer-events: none;
          background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='48' height='28' viewBox='0 0 48 28'><g fill='none' stroke='%23f5f5f5' stroke-width='1'><polygon points='40,14 32,28 16,28 8,14 16,0 32,0'/><polygon points='16,0 8,14 -8,14 -16,0 -8,-14 8,-14'/><polygon points='64,0 56,14 40,14 32,0 40,-14 56,-14'/><polygon points='16,28 8,42 -8,42 -16,28 -8,14 8,14'/><polygon points='64,28 56,42 40,42 32,28 40,14 56,14'/></g></svg>");
          background-size: 96px 56px;
          opacity: 0.04;
        }
        .hltrn-scanlines {
          position: absolute;
          inset: 0;
          pointer-events: none;
          background-image: repeating-linear-gradient(
            0deg,
            transparent 0px,
            transparent 3px,
            ${HOLETRON_PALETTE.fg} 3px,
            ${HOLETRON_PALETTE.fg} 4px
          );
          opacity: 0.02;
        }
        .hltrn-aura {
          position: absolute;
          inset: 0;
          pointer-events: none;
          background:
            radial-gradient(60% 60% at 18% 22%, rgba(138, 18, 239, 0.22) 0%, transparent 60%),
            radial-gradient(50% 50% at 88% 78%, rgba(6, 172, 142, 0.16) 0%, transparent 65%),
            radial-gradient(40% 40% at 80% 10%, rgba(201, 74, 188, 0.14) 0%, transparent 70%);
          animation: hltrn-aura-shift 36s ease-in-out infinite alternate;
          will-change: filter, opacity;
        }
        @keyframes hltrn-aura-shift {
          0%   { filter: hue-rotate(0deg)   saturate(1);    opacity: 1;    }
          25%  { filter: hue-rotate(45deg)  saturate(1.15); opacity: 0.92; }
          50%  { filter: hue-rotate(-30deg) saturate(0.9);  opacity: 1.05; }
          75%  { filter: hue-rotate(60deg)  saturate(1.1);  opacity: 0.95; }
          100% { filter: hue-rotate(20deg)  saturate(1);    opacity: 1;    }
        }
        @media (prefers-reduced-motion: reduce) {
          .hltrn-aura { animation: none; }
        }
        .hltrn-logo-glow {
          color: ${HOLETRON_PALETTE.fg};
          filter:
            drop-shadow(0 0 18px rgba(138, 18, 239, 0.55))
            drop-shadow(0 0 42px rgba(96, 109, 255, 0.25));
        }
        .hltrn-title {
          font-size: clamp(40px, 7vw, 88px);
          font-weight: 800;
          line-height: 1.04;
          letter-spacing: -0.025em;
          max-width: 18ch;
          text-wrap: balance;
        }
        .hltrn-quote-mark {
          background: linear-gradient(127.75deg, ${HOLETRON_PALETTE.purpleDeep} 10%, ${HOLETRON_PALETTE.purple} 50%, ${HOLETRON_PALETTE.purpleLight} 90%);
          -webkit-background-clip: text;
          background-clip: text;
          color: transparent;
        }
        .hltrn-sub {
          font-size: clamp(16px, 1.5vw, 22px);
          font-weight: 400;
          line-height: 1.55;
          color: ${HOLETRON_PALETTE.muted};
          max-width: 52ch;
        }
        .hltrn-header__name {
          font-size: clamp(20px, 2vw, 28px);
          font-weight: 700;
          letter-spacing: 0.18em;
          text-transform: uppercase;
        }
        .hltrn-header__tag {
          font-size: clamp(12px, 1vw, 14px);
          font-weight: 400;
          letter-spacing: 0.05em;
          color: ${HOLETRON_PALETTE.muted};
        }
        .hltrn-pill {
          display: inline-flex;
          align-items: center;
          gap: 0.5rem;
          padding: 0.375rem 0.625rem;
          border: 1px solid ${HOLETRON_PALETTE.border};
          border-radius: 999px;
          font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
          font-size: 11px;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          color: ${HOLETRON_PALETTE.muted};
        }
        .hltrn-pill__dot {
          display: inline-block;
          width: 6px;
          height: 6px;
          border-radius: 999px;
          background: ${HOLETRON_PALETTE.teal};
          box-shadow: 0 0 8px ${HOLETRON_PALETTE.teal};
        }
        .hltrn-cta-row {
          display: flex;
          flex-direction: row;
          gap: 16px;
          flex-wrap: wrap;
        }
        .hltrn-cta {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 12px 20px;
          border: 1px solid ${HOLETRON_PALETTE.border};
          border-radius: 4px;
          font-size: 14px;
          font-weight: 500;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          color: ${HOLETRON_PALETTE.fg};
          text-decoration: none;
        }
        .hltrn-cta:hover {
          border-color: ${HOLETRON_PALETTE.purpleLight};
          color: ${HOLETRON_PALETTE.purpleLight};
        }
        @media (max-width: 640px) {
          .hltrn-cta-row { flex-direction: column; align-items: stretch; }
          .hltrn-cta { justify-content: center; }
        }
        .hltrn-story {
          max-width: 100%;
          margin-top: clamp(48px, 8vh, 96px);
          color: ${HOLETRON_PALETTE.fg};
        }
        .hltrn-story h2 {
          font-size: clamp(28px, 4vw, 44px);
          font-weight: 800;
          letter-spacing: -0.02em;
          line-height: 1.1;
          text-transform: uppercase;
          margin: 0 0 clamp(20px, 3vh, 32px);
        }
        .hltrn-story p {
          font-size: 17px;
          line-height: 1.7;
          opacity: 0.85;
          margin-top: 1.25em;
        }
        .hltrn-story p:first-of-type {
          margin-top: 0;
        }
        .hltrn-story a {
          color: ${HOLETRON_PALETTE.fg};
          text-decoration: underline;
          text-decoration-color: ${HOLETRON_PALETTE.border};
          text-underline-offset: 3px;
        }
        .hltrn-story a:hover {
          color: ${HOLETRON_PALETTE.purpleLight};
          text-decoration-color: ${HOLETRON_PALETTE.purpleLight};
        }
        .hltrn-section-title {
          font-size: clamp(28px, 4vw, 44px);
          font-weight: 800;
          letter-spacing: -0.02em;
          line-height: 1.1;
          margin: clamp(64px, 10vh, 120px) 0 clamp(20px, 3vh, 32px);
        }
        .hltrn-tools {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 24px;
        }
        @media (max-width: 768px) {
          .hltrn-tools { grid-template-columns: 1fr; }
        }
        .hltrn-tool-card {
          border: 1px solid ${HOLETRON_PALETTE.border};
          padding: 32px;
          border-radius: 4px;
          background: ${HOLETRON_PALETTE.bgPanel};
          display: flex;
          flex-direction: column;
          gap: 16px;
        }
        .hltrn-tool-card h2 {
          font-size: 24px;
          font-weight: 700;
          letter-spacing: 0.05em;
          text-transform: uppercase;
          margin: 0;
        }
        .hltrn-tool-card .lede {
          font-size: 17px;
          color: ${HOLETRON_PALETTE.fg};
          opacity: 0.9;
          margin: 0;
        }
        .hltrn-tool-card .body {
          font-size: 15px;
          color: ${HOLETRON_PALETTE.muted};
          line-height: 1.6;
          margin: 0;
        }
        .hltrn-tool-card .meta {
          font-size: 12px;
          letter-spacing: 0.15em;
          text-transform: uppercase;
          color: ${HOLETRON_PALETTE.muted};
          margin: 0;
        }
        .hltrn-tool-card a.cta {
          margin-top: auto;
          color: ${HOLETRON_PALETTE.fg};
          font-size: 14px;
          text-decoration: none;
          border-bottom: 1px solid transparent;
          padding-bottom: 2px;
          align-self: flex-start;
        }
        .hltrn-tool-card a.cta:hover {
          color: ${HOLETRON_PALETTE.purpleLight};
          border-bottom-color: ${HOLETRON_PALETTE.purpleLight};
        }
        .hltrn-footer {
          margin-top: clamp(96px, 12vh, 160px);
          padding-top: 32px;
          border-top: 1px solid ${HOLETRON_PALETTE.border};
          font-size: 13px;
          color: ${HOLETRON_PALETTE.muted};
        }
        .hltrn-footer__row {
          display: flex;
          flex-wrap: wrap;
          gap: 8px 16px;
          margin-bottom: 12px;
        }
        .hltrn-footer a {
          color: ${HOLETRON_PALETTE.muted};
          text-decoration: none;
        }
        .hltrn-footer a:hover {
          color: ${HOLETRON_PALETTE.purpleLight};
        }
        .hltrn-footer__sep {
          color: ${HOLETRON_PALETTE.border};
        }
        @media print {
          .hltrn-root { background: #fff !important; color: #000 !important; }
          .hltrn-grid, .hltrn-scanlines, .hltrn-aura { display: none !important; }
          .hltrn-logo-glow { color: #000 !important; filter: none !important; }
          .hltrn-quote-mark { color: #000 !important; -webkit-text-fill-color: #000 !important; background: none !important; }
          .hltrn-sub, .hltrn-header__tag, .hltrn-pill { color: #333 !important; }
          .hltrn-cta, .hltrn-tool-card, .hltrn-footer { color: #000 !important; border-color: #ccc !important; background: #fff !important; }
          .hltrn-story, .hltrn-story p { color: #000 !important; opacity: 1 !important; }
        }
      `}</style>

      {/* Backgrounds */}
      <div className="hltrn-aura" aria-hidden />
      <div className="hltrn-grid" aria-hidden />
      <div className="hltrn-scanlines" aria-hidden />

      <div
        className="relative mx-auto flex min-h-screen flex-col"
        style={{
          maxWidth: 1100,
          padding: 'clamp(24px, 5vw, 48px) clamp(24px, 5vw, 80px)',
        }}
      >
        {/* Header */}
        <header className="flex items-center gap-3">
          <span className="hltrn-logo-glow inline-flex shrink-0">
            <HoletronLogo size={28} />
          </span>
          <span className="hltrn-header__name">HOLETRON</span>
          <span className="hltrn-header__tag hidden md:inline">
            · tools we accidentally built
          </span>
          <span className="ml-auto">
            <span className="hltrn-pill">
              <span className="hltrn-pill__dot" aria-hidden />
              umbrella · v1
            </span>
          </span>
        </header>

        {/* Hero */}
        <section
          className="relative flex flex-1 flex-col items-start justify-center"
          style={{ paddingTop: 'clamp(64px, 12vh, 160px)', paddingBottom: 'clamp(64px, 18vh, 220px)' }}
        >
          <div className="hltrn-logo-glow mb-10">
            <HoletronLogo size={96} />
          </div>

          <h1 className="hltrn-title">
            <span className="hltrn-quote-mark">“</span>We never wanted to be developers.
            <span className="hltrn-quote-mark">”</span>
          </h1>

          <p className="hltrn-sub mt-8">
            Our shop needed an IT department.
            <br />
            The IT department kept building tools.
            <br />
            Eventually we put them online — because why not.
          </p>

          <div className="hltrn-cta-row mt-10">
            <a
              className="hltrn-cta"
              href="https://github.com/Holetron-lab"
              target="_blank"
              rel="noopener noreferrer"
            >
              <span aria-hidden>↗</span> GitHub
            </a>
            <a
              className="hltrn-cta"
              href="https://godcrm.ai"
              target="_blank"
              rel="noopener noreferrer"
            >
              <span aria-hidden>↗</span> GOD CRM
            </a>
            <a
              className="hltrn-cta"
              href="https://holetron.com"
              target="_blank"
              rel="noopener noreferrer"
            >
              <span aria-hidden>↗</span> Holetron.com
            </a>
          </div>
        </section>

        {/* STORY */}
        <section className="hltrn-story">
          <h2>Our Story</h2>
          <p>Holetron started as a piercing supplies business. It still is.</p>
          <p>
            But running a real-economy company meant we needed software no one would sell us: an
            agent that could actually read our inventory, a workflow that wouldn&apos;t break the
            moment we added a custom field, a CRM that didn&apos;t assume we had 500 sales reps.
          </p>
          <p>
            So we built our own. Then we kept building. The internal tools turned out to be more
            interesting than we expected, and the software started solving problems that
            weren&apos;t ours anymore.
          </p>
          <p>
            We publish what we use ourselves. The code is on GitHub because we wrote it for our
            team, and we don&apos;t mind if your team uses it too. There&apos;s no roadmap
            promise, no enterprise plan, no support tier. If it works for you, great. If it
            doesn&apos;t, fork it.
          </p>
          <p>
            We&apos;re still mostly a piercing supplies business. The tools are a side effect —
            you can find the original shop at{' '}
            <a href="https://holetron.com" target="_blank" rel="noopener noreferrer">
              holetron.com
            </a>
            .
          </p>
        </section>

        {/* OUR PRODUCTS */}
        <h2 className="hltrn-section-title">Our Products</h2>

        {/* TOOLS */}
        <section className="hltrn-tools">
          <article className="hltrn-tool-card">
            <h2>Hindsight MemPalace</h2>
            <p className="lede">Hierarchical memory for AI agents.</p>
            <p className="body">
              Vector memory store crossed with a structured taxonomy: Rooms (topics), Halls
              (knowledge types), and Layers (priority L0–L3). Auto-classification, cross-bank
              bridges, compressed summaries, MCP server for Claude and other MCP-compatible
              tools. Drop-in Docker upgrade over vanilla Hindsight.
            </p>
            <p className="meta">MIT · Python + TypeScript · MCP-compatible</p>
            <a
              className="cta"
              href="https://github.com/Holetron-lab/fleet-memory"
              target="_blank"
              rel="noopener noreferrer"
            >
              → github.com/Holetron-lab/fleet-memory
            </a>
          </article>

          <article className="hltrn-tool-card">
            <h2>GOD CRM</h2>
            <p className="lede">A CRM where AI agents are first-class citizens.</p>
            <p className="body">
              Tables, automations, agents, MCP — all in one place. Used internally to run
              Holetron&apos;s operations. Now in limited public beta. The code is open at{' '}
              <a href="https://godcrm.ai/git/holetron-lab/godcrm" target="_blank" rel="noopener noreferrer">
                godcrm.ai/git
              </a>
              .
            </p>
            <p className="meta">Public beta · invitation-only</p>
            <a
              className="cta"
              href="https://godcrm.ai"
              target="_blank"
              rel="noopener noreferrer"
            >
              → godcrm.ai
            </a>
          </article>
        </section>

        {/* FOOTER */}
        <footer className="hltrn-footer">
          <div className="hltrn-footer__row">
            <a href="https://github.com/Holetron-lab" target="_blank" rel="noopener noreferrer">
              github.com/Holetron-lab
            </a>
            <span className="hltrn-footer__sep" aria-hidden>·</span>
            <a href="https://x.com/holetron" target="_blank" rel="noopener noreferrer">
              x.com/holetron
            </a>
            <span className="hltrn-footer__sep" aria-hidden>·</span>
            <a href="https://t.me/god_crm" target="_blank" rel="noopener noreferrer">
              t.me/god_crm
            </a>
            <span className="hltrn-footer__sep" aria-hidden>·</span>
            <a href="mailto:hello@hltrn.cc">hello@hltrn.cc</a>
          </div>
          <div>Holetron Ltd · Registered in Hong Kong · © 2026</div>
        </footer>
      </div>
    </main>
  );
};

export default HoletronLanding;
