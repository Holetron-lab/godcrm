/**
 * GOD CRM — Embeddable AI Chat loader (ADR-176)
 *
 * Drop-in for any third-party site:
 *   <script src="https://edit.godcrm.ai/embed.js" data-space="11" defer></script>
 *
 * Renders the GOD CRM AI chat as a full-height panel docked to the right edge.
 *
 * SPLIT vs OVERLAY (WS-C)
 * ----------------------
 * On the Penpot design host the panel is a TRUE split, not an overlay: Penpot's
 * editor root `.main_ui_workspace__workspace` is a CSS grid
 *   width:100vw; grid-template:"left-sidebar viewport right-sidebar" 1fr/auto 1fr auto
 * i.e. the two sidebars are `auto` and the centre viewport is `1fr`. We inject a
 * stylesheet that shrinks that root to `calc(100vw - var(--godcrm-strip-w))`, so
 * the reserved right gutter is absorbed by the `1fr` viewport column ALONE — both
 * Penpot sidebars keep their intrinsic widths, nothing is overlapped. Penpot lives
 * in the left region, our chat in the right strip, divided by a hard border. We
 * also dispatch a debounced `resize` so Penpot re-fits its canvas to the narrower
 * viewport. On generic hosts (no Penpot grid) we fall back to shifting `<html>`'s
 * `margin-right` — a genuine split for normal-flow pages.
 *
 * The strip is width-resizable by dragging its left edge (mouse OR touch, via
 * Pointer Events + pointer capture, so the drag survives over the iframe) and
 * collapsible via an edge tab. Width persists to localStorage. Colours follow the
 * viewer's OS colour-scheme. On the editor it opens docked by default; a collapse
 * is remembered so we never fight the user. The iframe points at /embed/chat on
 * this script's origin; auth is the viewer's CRM session (`.godcrm.ai` cookie).
 * Zero dependencies, self-contained IIFE.
 */
(function () {
  'use strict';

  var script = document.currentScript;
  if (!script) return;

  // If this loader's host page is itself framed same-origin by a GOD CRM shell,
  // the parent already renders the chat — suppress the duplicate. A cross-origin
  // top (window.top access throws) is a legitimate external embed (e.g.
  // WorkAdventure) → keep the panel there as an overlay.
  try {
    if (window.top !== window.self) return;
  } catch (_crossOrigin) { /* external host embed → keep the panel */ }

  var origin = new URL(script.src).origin;
  var space = script.getAttribute('data-space') || 'auto';
  var frameSrc = origin + '/embed/chat?space=' + encodeURIComponent(space) + '&mode=overlay';

  var Z = '2147483000'; // above typical site chrome, below max (leaves headroom)
  var WIDTH_KEY = 'godcrm_embed_w';        // persisted strip width (px)
  var COLLAPSE_KEY = 'godcrm_embed_collapsed'; // remembered collapse choice
  var DEFAULT_W = 400;
  var MIN_W = 320;   // keep the in-frame AIChatPanel above its mobile (<768) fork
  var root = document.documentElement;
  var frame = null, handle = null, tab = null, splitStyle = null;
  var isOpen = false;

  function maxW() { return Math.min(Math.round(window.innerWidth * 0.9), 2100); }
  function clampW(w) { return Math.max(MIN_W, Math.min(maxW(), w)); }

  var panelW = DEFAULT_W;
  try {
    var stored = parseInt(localStorage.getItem(WIDTH_KEY), 10);
    if (stored) panelW = stored;
  } catch (_e) { /* storage blocked — use default */ }
  panelW = clampW(panelW);

  var userCollapsed = false;
  try { userCollapsed = localStorage.getItem(COLLAPSE_KEY) === '1'; } catch (_e) {}

  // lucide MessageCircle — the icon GOD CRM's FloatingChatButton uses.
  var ICON_CHAT =
    '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24"' +
    ' fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"' +
    ' stroke-linejoin="round"><path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/></svg>';
  function chevron(dir) { // dir '<' points into page (collapse), '>' reopens
    var d = dir === '<' ? 'M15 18l-6-6 6-6' : 'M9 18l6-6-6-6';
    return '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"' +
      ' fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"' +
      ' stroke-linejoin="round"><path d="' + d + '"/></svg>';
  }

  // Colours track the viewer's OS colour-scheme (matches in-app theme vars).
  var mq = window.matchMedia('(prefers-color-scheme: dark)');
  function palette() {
    return mq.matches
      ? { bg: '#1f2937', border: '#374151', icon: '#d1d5db', frame: '#111827' }
      : { bg: '#ffffff', border: '#e5e7eb', icon: '#4b5563', frame: '#ffffff' };
  }

  function isDesktop() { return window.innerWidth >= 768; }
  function isPenpotEditor() { return /\/workspace(\b|[/?#])/.test(location.hash + location.pathname); }
  function penpotRoot() { return document.querySelector('.main_ui_workspace__workspace'); }

  // Inject the split stylesheet once. Harmless when the Penpot grid is absent —
  // the rule simply matches nothing until the editor route mounts.
  function ensureSplitStyle() {
    if (splitStyle) return;
    splitStyle = document.createElement('style');
    splitStyle.id = 'godcrm-embed-split';
    splitStyle.textContent =
      '.main_ui_workspace__workspace{width:calc(100vw - var(--godcrm-strip-w,0px)) !important;}';
    (document.head || document.documentElement).appendChild(splitStyle);
  }

  function ensureFrame() {
    if (frame) return frame;
    ensureSplitStyle();
    frame = document.createElement('iframe');
    frame.src = frameSrc;
    frame.title = 'GOD CRM AI Chat';
    frame.setAttribute('allow', 'clipboard-write; microphone');
    frame.style.cssText = [
      'position:fixed', 'top:0', 'right:0', 'bottom:0', 'height:100dvh',
      'width:' + panelW + 'px', 'max-width:100vw',
      'border:none', 'border-left:1px solid ' + palette().border, 'z-index:' + Z,
      'box-shadow:-8px 0 32px rgba(0,0,0,.18)', 'background:' + palette().frame, 'display:none'
    ].join(';');
    document.body.appendChild(frame);

    // Drag handle riding the strip's left edge — the resize affordance.
    handle = document.createElement('div');
    handle.setAttribute('aria-hidden', 'true');
    handle.style.cssText = [
      'position:fixed', 'top:0', 'bottom:0', 'width:8px',
      'z-index:' + (Number(Z) + 1), 'cursor:col-resize',
      'touch-action:none', 'display:none', 'background:transparent'
    ].join(';');
    document.body.appendChild(handle);
    handle.addEventListener('pointerdown', startResize);
    return frame;
  }

  // The collapse/expand edge tab (always present so a collapsed strip is
  // recoverable). Open → sits at the strip's left edge showing a collapse
  // chevron; collapsed → sits at the far right showing the chat icon to reopen.
  function ensureTab() {
    if (tab) return tab;
    tab = document.createElement('button');
    tab.type = 'button';
    tab.style.cssText = [
      'position:fixed', 'bottom:70px',   // match GOD CRM's FloatingChatButton level
      'width:22px', 'height:52px', 'display:flex', 'align-items:center',
      'justify-content:center', 'cursor:pointer', 'padding:0',
      'border:1px solid transparent', 'border-radius:8px 0 0 8px',
      'z-index:' + (Number(Z) + 2), 'box-shadow:-2px 0 8px rgba(0,0,0,.12)',
      'transition:right .3s ease'
    ].join(';');
    tab.addEventListener('click', function () { setOpen(!isOpen, true); });
    document.body.appendChild(tab);
    return tab;
  }

  function paintTab() {
    if (!tab) return;
    var p = palette();
    tab.style.background = p.bg;
    tab.style.borderColor = p.border;
    tab.style.color = p.icon;
    tab.innerHTML = isOpen ? chevron('>') : ICON_CHAT;
    tab.setAttribute('aria-label', isOpen ? 'Collapse AI chat' : 'Open AI chat');
  }

  // Reserve the right gutter. Penpot editor → shrink the grid root via the CSS
  // var (viewport 1fr column absorbs it, sidebars intact). Generic host → shift
  // <html> margin-right. Narrow viewport → panel is full-width, nothing to split.
  var resizeTimer = null;
  function nudgePenpot() {
    // Penpot fits its canvas to the viewport element; poke a resize so the
    // narrower column is picked up even if it only listens to window resize.
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      try { window.dispatchEvent(new Event('resize')); } catch (_e) {}
    }, 60);
  }
  function applyLayout() {
    var wide = isOpen && isDesktop();
    var gutter = wide ? panelW : 0;
    var penpot = penpotRoot();

    root.style.setProperty('--godcrm-strip-w', gutter + 'px');
    if (penpot) {
      root.style.marginRight = ''; // grid reflow owns the split — no double shift
      nudgePenpot();
    } else {
      if (!/margin-right/.test(root.style.transition)) {
        root.style.transition = (root.style.transition ? root.style.transition + ',' : '') +
          'margin-right .3s ease';
      }
      root.style.marginRight = gutter ? gutter + 'px' : '';
    }

    if (frame) {
      frame.style.display = isOpen ? 'block' : 'none';
      frame.style.width = (isOpen && !isDesktop()) ? '100vw' : panelW + 'px';
    }
    if (handle) {
      handle.style.display = wide ? 'block' : 'none';
      handle.style.right = panelW + 'px';
    }
    if (tab) {
      tab.style.right = wide ? panelW + 'px' : '0px';
      paintTab();
    }
  }

  function startResize(e) {
    if (!isOpen || !isDesktop()) return;
    e.preventDefault();
    var startX = e.clientX, startW = panelW;
    var prevTransition = root.style.transition;
    root.style.transition = 'none';        // no shift animation during live drag
    frame.style.pointerEvents = 'none';    // let pointer events reach the handle
    tab.style.transition = 'none';
    document.body.style.userSelect = 'none';
    if (handle.setPointerCapture) { try { handle.setPointerCapture(e.pointerId); } catch (_e) {} }

    function onMove(ev) {
      panelW = clampW(startW + (startX - ev.clientX));
      frame.style.width = panelW + 'px';
      handle.style.right = panelW + 'px';
      tab.style.right = panelW + 'px';
      root.style.setProperty('--godcrm-strip-w', panelW + 'px');
      if (!penpotRoot()) root.style.marginRight = panelW + 'px';
    }
    function onUp() {
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', onUp);
      handle.removeEventListener('pointercancel', onUp);
      root.style.transition = prevTransition;
      frame.style.pointerEvents = '';
      tab.style.transition = 'right .3s ease';
      document.body.style.userSelect = '';
      try { localStorage.setItem(WIDTH_KEY, String(panelW)); } catch (_e) {}
      if (penpotRoot()) nudgePenpot();
    }
    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onUp);
    handle.addEventListener('pointercancel', onUp);
  }

  function setOpen(next, byUser) {
    ensureFrame();
    ensureTab();
    isOpen = next;
    if (byUser) {
      userCollapsed = !next;
      try { localStorage.setItem(COLLAPSE_KEY, next ? '0' : '1'); } catch (_e) {}
    }
    applyLayout();
  }

  // Repaint live when the OS flips light/dark.
  function repaint() {
    if (frame) { frame.style.background = palette().frame; frame.style.borderLeftColor = palette().border; }
    paintTab();
  }
  if (mq.addEventListener) mq.addEventListener('change', repaint);
  else if (mq.addListener) mq.addListener(repaint);

  // In-frame controls talk to this host. close → collapse the strip; mode:'split'
  // → hand off to the true side-by-side shell. Sender origin verified.
  window.addEventListener('message', function (ev) {
    if (ev.origin !== origin || !ev.data) return;
    if (ev.data.type === 'godcrm-embed:close') {
      if (isOpen) setOpen(false, true);
    } else if (ev.data.type === 'godcrm-embed:mode' && ev.data.mode === 'split') {
      window.location.href = '/split';
    }
  });

  // Keep the split consistent across viewport changes.
  window.addEventListener('resize', function () {
    if (!isOpen) return;
    panelW = clampW(panelW);
    applyLayout();
  });

  // React to Penpot's hash routing: dock open by default on the editor route
  // (unless the user collapsed it), retract elsewhere.
  function syncRoute() {
    if (isPenpotEditor() && !userCollapsed) { if (!isOpen) setOpen(true, false); }
    else if (!isPenpotEditor() && isOpen && penpotRoot() === null) { /* generic host: leave as-is */ }
  }
  window.addEventListener('hashchange', function () { setTimeout(syncRoute, 300); });

  function mount() {
    ensureFrame();
    ensureTab();
    // Default state: docked-open strip on the Penpot editor (respecting a
    // remembered collapse); a reopen tab everywhere else.
    setOpen(isPenpotEditor() && !userCollapsed, false);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }
})();
