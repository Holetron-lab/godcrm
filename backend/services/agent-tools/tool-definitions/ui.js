/**
 * UI probe tool definition — the browser-run surface for QA agents.
 *
 * One tool, not five: the catalogue already carries five browser-shaped names
 * with no handler behind them. Rather than add a sixth phantom, this exposes a
 * single scenario runner whose report covers what those names promised
 * (console/devtools errors, screenshots, accessibility findings).
 */

export const UI_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'ui_probe',
      description:
        'Run a real browser (Playwright/Chromium, headless) through a UI scenario and report what breaks: '
        + 'per-step pass/fail, HTTP status, JS page errors, console errors, failed network requests, optional '
        + 'accessibility findings and screenshots (saved to uploads, URL returned). '
        + 'Hosts are allowlisted — staging/dev only by default (dev.godcrm.ai, devcrm.hltrn.cc, localhost); '
        + 'production rings are not reachable unless UI_PROBE_ALLOWED_HOSTS is widened. '
        + 'Use this to reproduce a frontend bug or verify a fix end-to-end instead of reading code and guessing.',
      parameters: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description: 'Starting URL, e.g. https://dev.godcrm.ai/spaces. Must be on an allowlisted host.',
          },
          steps: {
            type: 'array',
            description:
              'Scenario steps, executed in order (max 40). Each step is an object with an "action": '
              + 'goto {url}, click {selector}, fill {selector,value}, press {selector,key}, select {selector,value}, '
              + 'wait_for {selector,state}, wait_ms {ms}, scroll {y}, expect_text {text}, expect_visible {selector}, '
              + 'expect_url {text}, screenshot {full_page,label}. Selectors are Playwright selectors '
              + '(CSS, text=..., role=...).',
            items: { type: 'object' },
          },
          auth_token: {
            type: 'string',
            description:
              'Optional JWT for an authenticated run. Seeds the access_token cookie and god-crm-auth store only on the starting origin before '
              + 'the first navigation; the app validates it via /auth/me. Pass a token you already hold — the tool never mints or reads credentials.',
          },
          viewport: {
            type: 'string',
            description: '"mobile" for a 390x844 phone viewport; omit for 1440x900 desktop.',
          },
          a11y: {
            type: 'boolean',
            description:
              'Run a static accessibility pass on the final page (missing alt text, unlabelled controls and form '
              + 'fields, duplicate ids, heading-order jumps, missing html lang).',
          },
          screenshot: {
            type: 'boolean',
            description: 'Capture a final screenshot (default true). Set false to skip.',
          },
          wait_until: {
            type: 'string',
            description: 'Navigation wait condition: domcontentloaded (default), load, or networkidle.',
          },
          stop_on_failure: {
            type: 'boolean',
            description: 'Stop the scenario at the first failed step (default true). False runs every step.',
          },
          timeout_ms: {
            type: 'number',
            description: 'Per-operation timeout in ms (default 30000, max 120000).',
          },
        },
        required: ['url'],
      },
    },
  },
];

export default UI_TOOLS;
