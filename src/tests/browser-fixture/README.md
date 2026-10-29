# Isolated component browser fixture

Run from the repository root:

```sh
npm run test:browser-fixture
```

The runner uses installed Vite and Chromium, serves only a local frontend fixture,
blocks API and nonlocal requests, and prints the temporary screenshot directory.
No backend, credentials, database, or app Vite configuration is loaded.

For a component check, copy this directory inside `src/tests/` in your own worktree,
keep the CSS import and HTML viewport, and replace the Switch example with the
component and explicit synthetic props/mocks. Use `createFixtureServer` and `openFixture` from
`scripts/qa/browser-fixture.mjs` as the smoke script does; adapt the HTML entry,
accessible locator, expected dimensions, and interaction assertions.
Keep the spacing/theme checks before interactions so a broken harness fails early.
Tailwind scans TSX under `src`; do not put the entry outside its content paths.

Always load `src/styles/index.css` through Vite/PostCSS, as the app entry does.
It includes spacing/typography tokens, both theme definitions, Tailwind utilities,
and global component styles. Do not concatenate a hand-picked subset of CSS or
copy token values into a fixture: utilities such as `h-6` depend on `--spacing-6`.
Retain any component-specific CSS imports as well.

Acceptance: at 1440px and 390px, the example switch is 44×24px, has an accessible
name, receives Tab focus, toggles via Space and click, produces no horizontal
page overflow, and has no console/page/network errors. Screenshots establish
fixture evidence; they do not replace full-app or staging acceptance.

For dark-theme scenarios, set `data-theme="dark"` on the HTML element and repeat
the component assertions. The default smoke covers light theme only.

## Stable bootstrap for component checks

Keep the runner inside `scripts/qa` in your worktree so Node resolves the installed
Vite/Playwright packages. Put fixture HTML/TSX under `src/tests`, not `/tmp` (where
React resolution and Tailwind content scanning differ). Store only artifacts and
the isolated Vite cache under `/tmp`. Run from the worktree root.

```js
const entry = 'src/tests/my-fixture/index.html';
const server = await createFixtureServer({ root, artifacts, entry });
try {
  // Launch browser; create a fresh page for each viewport.
  const control = page.getByRole('button', { name: 'Example' });
  const fixture = await openFixture({ server, page, entry, ready: control });
  // Check CSS tokens/dimensions, then exercise keyboard/mouse behavior.
  await control.click();
  // Check behavior and any event history here.
  await fixture.assertStable();
} finally {
  await browser?.close();
  await server.close();
}
```

Bootstrap scans the selected HTML entry, prepares React's generated JSX imports,
waits for the rendered component and Vite's request crawl, then reloads once before
stateful assertions. It does not retry failed assertions or clear browser errors.
`assertStable()` detects a document replacement during the test and checks all
recorded console/page/HTTP/request errors. API and external requests are blocked
on both the preparation and assertion loads. Use a fresh page per scenario.

For dependencies loaded only after interaction, import them in the fixture entry
or prepare them before calling the shared bootstrap; do not reload after clicks.
For screenshots of animated components, explicitly wait for the relevant CSS
transition/animation to finish. Vite readiness does not mean animations ended.

Run the bootstrap regression (fresh cache on each run, both viewport widths):

```sh
node --test scripts/qa/browser-fixture-regression.mjs
```
