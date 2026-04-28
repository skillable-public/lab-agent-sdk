/**
 * lab-simulator.js
 *
 * Reference "lab host" that mimics the Skillable lab shell and embeds the
 * AI Chat Mentor iframe.
 *
 *   [ VM tabs (Windows 11 / RDP / HTTPS / ...) |  brand   X Exit Lab ]
 *   [                                          |  Instructions | Resources | Mentor   ? gear |
 *   [                                          |  (or Settings / Help overlay) |
 *   [   Live environment (screenshot)          |                    |
 *   [                                          | [ Prev ]  [ Next ] |
 *   [                                          | 7 Hr 58 Min Rem    |
 *
 * The Color Mode dropdown in Settings posts host.theme.change to the chat
 * iframe so you can watch the postMessage contract drive theme switching
 * in real time.
 */
(function () {
  'use strict';

  const PROTOCOL_VERSION = 1;
  const SOURCE_HOST = 'lab-host';
  const SOURCE_CHAT = 'mentor-chat';

  // Inbound (chat -> host)
  const IN = {
    READY:              'mentor.ready',
    GOTO_PAGE:          'mentor.gotoInstructionsPage',
    SEND_TEXT:          'mentor.sendTextToEnvironment',
    MESSAGE_SENT:       'mentor.message.sent',
    MENTOR_RESPONSE:    'mentor.response',
    ERROR:              'mentor.error',
  };
  // Outbound (host -> chat)
  const OUT = {
    INIT:            'host.init',
    CONTEXT_UPDATE:  'host.context.update',
    HINT_REQUEST:    'host.hint.request',
    THEME_CHANGE:    'host.theme.change',
    LOCALE_CHANGE:   'host.locale.change',
    SEND_MESSAGE:    'host.send.message',
  };

  const $  = (id) => document.getElementById(id);
  const $$ = (sel) => document.querySelectorAll(sel);

  const $iframe = $('mentor-iframe');
  const $bridgeStatus = $('bridge-status');
  const $eventLog = $('event-log');
  const $eventLogPanel = $('event-log-panel');
  const $mentorBadge = $('mentor-badge');
  const $envCanvas = $('env-canvas');
  const $envToast = $('env-toast');
  const $envToastBody = $('env-toast-body');
  const $timer = $('lab-timer');
  const $colorMode = $('color-mode');

  // --- Tabs / overlays -----------------------------------------------------
  //
  // Tabs: instructions | resources | mentor
  // Overlays: settings | help  (triggered by their icon buttons)
  //
  // Overlays cover the tab-panel area while open. Closing an overlay restores
  // whatever tab was active before.

  let activeTab = 'instructions';
  let activeOverlay = null; // 'settings' | 'help' | null

  function activateTab(id) {
    if (!id) return;
    activeTab = id;
    closeOverlay();
    $$('.lab-tab').forEach(t => {
      const on = t.dataset.tab === id;
      t.classList.toggle('is-active', on);
      t.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    $$('.tab-panel').forEach(p => {
      const on = p.id === `tab-${id}`;
      p.classList.toggle('is-active', on);
      if (on) p.removeAttribute('hidden'); else p.setAttribute('hidden', '');
    });
    if (id === 'mentor') {
      ensureMentorLoaded();
      hideMentorBadge();
    }
  }

  // Event delegation: one listener on the tab bar. Works even if clicks land
  // on a descendant (text node, badge span, svg child, etc.).
  const $tabBar = document.querySelector('.lab-tabs');
  if ($tabBar) {
    $tabBar.addEventListener('click', (e) => {
      const btn = e.target.closest('.lab-tab');
      if (btn && $tabBar.contains(btn)) activateTab(btn.dataset.tab);
    });
  }

  function openOverlay(name) {
    activeOverlay = name;
    $$('.overlay-panel').forEach(o => { o.hidden = o.id !== `overlay-${name}`; });
  }
  function closeOverlay() {
    activeOverlay = null;
    $$('.overlay-panel').forEach(o => { o.hidden = true; });
  }
  $('btn-help').addEventListener('click',     () => openOverlay('help'));
  $('btn-settings').addEventListener('click', () => openOverlay('settings'));
  $$('[data-close-overlay]').forEach(b => b.addEventListener('click', closeOverlay));

  function showMentorBadge() {
    if (activeTab === 'mentor' && !activeOverlay) return;
    $mentorBadge.hidden = false;
  }
  function hideMentorBadge() { $mentorBadge.hidden = true; }

  // --- Lab state -----------------------------------------------------------
  //
  // In the real Skillable lab client the Previous/Next buttons navigate
  // between *pages* of instructions. Each page is authored as markdown and
  // usually starts with a heading; the heading doubles as the page's display
  // name. When a page has no heading, the UI labels it "Page {n}" using the
  // non-zero-based sequence number.
  //
  // `currentPageIndex` is a ZERO-BASED index into `lab.pages` throughout
  // this module and in the LabContext sent over postMessage / REST.

  let currentPageIndex = 0;

  const lab = {
    labId: 'sample-lab',
    labTitle: 'Sample Lab',
    pages: [
      // Each page body is markdown. Most start with an H1/H2 heading that is
      // used as the page title; pages without a heading fall back to "Page N".
      `# Welcome to the lab

In this lab you'll get comfortable with the Windows 11 command line by running
a handful of everyday PowerShell commands against your lab VM.

By the end you will be able to:

- open and use Windows Terminal
- list the contents of a directory with \`Get-ChildItem\`
- create and inspect a small file
- check the status of a git repository

Click **Next** to begin.`,

      `# Open Windows Terminal

Locate **Windows Terminal** on the taskbar and click it to open a new
PowerShell session.

You should see a prompt similar to:

\`\`\`
PS C:\\Users\\student>
\`\`\`

If you do not see a prompt, ask the mentor for help from the **Mentor** tab.`,

      `# List files in your home directory

With the terminal focused, run:

\`\`\`powershell
Get-ChildItem -Force
\`\`\`

The \`-Force\` flag asks PowerShell to include hidden items. You should see
folders like *Desktop*, *Documents*, and *Downloads*.

*Tip:* \`ls\` and \`dir\` are aliases for \`Get-ChildItem\`.`,

      `# Create a file

Create a new file in your home directory:

\`\`\`powershell
New-Item -Name hello.txt -ItemType File -Value "hi from the lab"
\`\`\`

Confirm it landed where you expect:

\`\`\`powershell
Get-Content hello.txt
\`\`\`

The output should read \`hi from the lab\`.`,

      `# Check git status

Change directory into the lab repository and ask git what state the tree is in:

\`\`\`powershell
Set-Location C:\\repo
git status
\`\`\`

You're done! Click **Next** to finish the lab.`,

      `# Wrap-up

Nice work. In this lab you:

- opened Windows Terminal
- listed files with \`Get-ChildItem\`
- created a file with \`New-Item\`
- inspected a git working tree

Feel free to ask the mentor any lingering questions before closing the lab.`,
    ],
  };

  const $labPage = $('lab-page');
  const $labTitle = $('lab-title');

  // Tiny markdown renderer — supports #/## headings, paragraphs, unordered
  // and ordered lists, bold/italic, inline code, and fenced code blocks.
  // Escapes HTML first so content is safe to innerHTML.
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }
  function renderMarkdown(src) {
    const out = [];
    const fenceRe = /```([a-z0-9_-]*)\n([\s\S]*?)```/gi;
    let last = 0, m;
    while ((m = fenceRe.exec(src)) !== null) {
      out.push(renderInline(src.slice(last, m.index)));
      out.push(`<pre><code>${escapeHtml(m[2])}</code></pre>`);
      last = m.index + m[0].length;
    }
    out.push(renderInline(src.slice(last)));
    return out.join('');

    function renderInline(chunk) {
      const blocks = chunk.split(/\n{2,}/);
      return blocks.map(block => {
        const trimmed = block.trim();
        if (!trimmed) return '';
        const h = trimmed.match(/^(#{1,6})\s+(.+)$/);
        if (h) {
          const level = h[1].length;
          return `<h${level}>${inline(h[2])}</h${level}>`;
        }
        if (/^[-*]\s+/.test(trimmed)) {
          const items = trimmed.split(/\n/).map(l => l.replace(/^[-*]\s+/, ''));
          return `<ul>${items.map(i => `<li>${inline(i)}</li>`).join('')}</ul>`;
        }
        if (/^\d+\.\s+/.test(trimmed)) {
          const items = trimmed.split(/\n/).map(l => l.replace(/^\d+\.\s+/, ''));
          return `<ol>${items.map(i => `<li>${inline(i)}</li>`).join('')}</ol>`;
        }
        return `<p>${inline(trimmed).replace(/\n/g, '<br/>')}</p>`;
      }).join('');
    }
    function inline(s) {
      return escapeHtml(s)
        .replace(/`([^`]+)`/g, '<code>$1</code>')
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replace(/\*([^*]+)\*/g, '<em>$1</em>')
        .replace(/_([^_]+)_/g, '<em>$1</em>');
    }
  }

  // Extract the first H1/H2 heading text from a markdown page, if any.
  // Returns null if the page has no leading heading.
  function extractPageHeading(md) {
    const m = md.match(/^\s*#{1,2}\s+(.+?)\s*$/m);
    return m ? m[1].trim() : null;
  }

  function pageDisplayName(index) {
    const heading = extractPageHeading(lab.pages[index]);
    return heading || `Page ${index + 1}`;
  }

  function currentContext() {
    const md = lab.pages[currentPageIndex];
    const heading = extractPageHeading(md);
    return {
      labId: lab.labId,
      labTitle: lab.labTitle,
      currentPageIndex,                            // zero-based
      totalPages: lab.pages.length,
      pageTitle: heading ?? undefined,             // omit when the page has no heading
      pageInstructions: md,                        // raw markdown
      environment: { os: 'windows-11', shell: 'powershell', cwd: 'C:\\Users\\student' },
    };
  }

  function renderCurrentPage() {
    const md = lab.pages[currentPageIndex];
    const display = pageDisplayName(currentPageIndex);
    $labTitle.textContent = lab.labTitle;
    $labPage.innerHTML =
      `<div class="lab-page__meta">${display} &middot; Page ${currentPageIndex + 1} of ${lab.pages.length}</div>` +
      renderMarkdown(md);
    $('btn-prev').disabled = currentPageIndex <= 0;
    $('btn-next').disabled = currentPageIndex >= lab.pages.length - 1;
    // Scroll to top of the page content so the student sees the new page from
    // the top, not wherever they left off on the previous page.
    const scroller = document.querySelector('#tab-instructions .tab-panel__scroll');
    if (scroller) scroller.scrollTop = 0;
  }

  // --- Iframe --------------------------------------------------------------
  let mentorLoaded = false;
  // The mentor iframe URL is supplied by the chooser (index.html) as the
  // `?mentor=<url>` query parameter on this page. If it's absent (e.g. a
  // direct hit on lab-simulator.html), bounce the user back to the chooser.
  const MENTOR_URL = (() => {
    const m = new URL(window.location.href).searchParams.get('mentor');
    if (m) return m;
    window.location.replace('./');
    return null;
  })();

  function iframeUrl() {
    // Resolve the (possibly-relative) mentor URL against this page first,
    // then layer on parentOrigin and theme as additional query params.
    const base = new URL(MENTOR_URL, window.location.href);
    base.searchParams.set('parentOrigin', window.location.origin);
    base.searchParams.set('theme', currentIframeTheme());
    return base.toString();
  }
  function ensureMentorLoaded() {
    if (mentorLoaded || !MENTOR_URL) return;
    $iframe.src = iframeUrl();
    mentorLoaded = true;
  }

  // --- postMessage plumbing -------------------------------------------------
  function post(type, payload) {
    if (!mentorLoaded || !$iframe.contentWindow) return;
    const msg = { source: SOURCE_HOST, version: PROTOCOL_VERSION, type, payload };
    $iframe.contentWindow.postMessage(msg, new URL(iframeUrl()).origin);
    log('host \u2192 chat', type, payload);
  }

  window.addEventListener('message', (event) => {
    if (!$iframe || event.source !== $iframe.contentWindow) return;
    const msg = event.data;
    if (!msg || msg.source !== SOURCE_CHAT || msg.version !== PROTOCOL_VERSION) return;

    log('chat \u2192 host', msg.type, msg.payload);

    switch (msg.type) {
      case IN.READY:
        if ($bridgeStatus) {
          $bridgeStatus.textContent = 'Connected';
          $bridgeStatus.classList.add('is-connected');
        }
        post(OUT.INIT, {
          sessionId: null,
          userName: 'Chris',
          theme: currentIframeTheme(),
          locale: 'en',
          labContext: currentContext(),
        });
        break;
      case IN.GOTO_PAGE:          gotoInstructionsPage(msg.payload?.index); break;
      case IN.SEND_TEXT:          showEnvToast(msg.payload?.text || ''); break;
      case IN.MENTOR_RESPONSE:    showMentorBadge(); break;
    }
  });

  function gotoInstructionsPage(index) {
    if (typeof index !== 'number' || index < 0 || index >= lab.pages.length) return;
    currentPageIndex = index;
    renderCurrentPage();
    activateTab('instructions');
    post(OUT.CONTEXT_UPDATE, { context: currentContext() });
  }
  function showEnvToast(text) {
    $envToastBody.textContent = text;
    $envToast.hidden = false;
    $envCanvas.classList.remove('is-flash');
    void $envCanvas.offsetWidth;
    $envCanvas.classList.add('is-flash');
    clearTimeout(showEnvToast._t);
    showEnvToast._t = setTimeout(() => { $envToast.hidden = true; }, 3500);
  }

  // --- Controls ------------------------------------------------------------
  $('btn-stuck').addEventListener('click', () => {
    activateTab('mentor');
    post(OUT.HINT_REQUEST, { reason: 'stuck-button' });
  });
  $('btn-prev').addEventListener('click', () => {
    currentPageIndex = Math.max(0, currentPageIndex - 1);
    renderCurrentPage();
    post(OUT.CONTEXT_UPDATE, { context: currentContext() });
  });
  $('btn-next').addEventListener('click', () => {
    currentPageIndex = Math.min(lab.pages.length - 1, currentPageIndex + 1);
    renderCurrentPage();
    post(OUT.CONTEXT_UPDATE, { context: currentContext() });
  });
  $('btn-exit').addEventListener('click', () => {
    if (confirm('Exit lab? (Demo only \u2014 this would normally end the VM session.)')) {
      log('host', 'exit-lab (demo)', null);
    }
  });

  // --- Settings: Text Size (cosmetic; styles the sidebar body only) -------
  $$('.settings-list--check li').forEach(li => {
    li.addEventListener('click', () => {
      $$('.settings-list--check li').forEach(x => x.classList.remove('is-selected'));
      li.classList.add('is-selected');
      const size = li.dataset.textSize;
      const scale = size === 'xlarge' ? '1.18' : size === 'large' ? '1.08' : '1';
      document.querySelector('.lab-side').style.setProperty('--side-text-scale', scale);
      // Apply by adjusting the base font-size of the .side-body
      document.querySelector('.side-body').style.fontSize = `calc(${scale} * ${getComputedStyle(document.documentElement).getPropertyValue('--font-size-body-sm')})`;
    });
  });

  // --- Settings: Color Mode — flips theme + posts host.theme.change --------
  function currentIframeTheme() {
    // The contract only carries "light" and "dark". If the host's internal
    // mode is something else (e.g. "high-contrast"), fall back to "light"
    // per spec — never "dark".
    return document.documentElement.getAttribute('data-theme') === 'dark'
      ? 'dark'
      : 'light';
  }

  function applyColorMode(mode) {
    document.documentElement.setAttribute('data-theme', mode);
    document.documentElement.classList.toggle('is-high-contrast', mode === 'high-contrast');
    if (mentorLoaded) post(OUT.THEME_CHANGE, { theme: currentIframeTheme() });
  }
  $colorMode.addEventListener('change', (e) => applyColorMode(e.target.value));
  // Initialize dropdown from whatever the page booted with
  $colorMode.value = document.documentElement.getAttribute('data-theme') || 'light';

  // --- Settings: event log toggle ------------------------------------------
  $('evt-log-toggle').addEventListener('change', (e) => {
    $eventLogPanel.hidden = !e.target.checked;
  });
  $('btn-clear-log').addEventListener('click', () => $eventLog.replaceChildren());

  // --- Event log drag + resize --------------------------------------------
  //
  // The event log is a floating, opt-in panel. By default the CSS anchors it
  // to the bottom-left of the viewport (left:16, bottom:16). On the first
  // user interaction we materialize its geometry as explicit top/left/width/
  // height pixels; every subsequent drag or resize updates those four
  // numbers and keeps the panel clamped inside the viewport.
  (function setupEventLogDragResize() {
    const panel = $eventLogPanel;
    const header = $('event-log-drag-handle');
    if (!panel || !header) return;

    const MIN_W = 320;
    const MIN_H = 180;

    function clamp(val, min, max) { return Math.max(min, Math.min(max, val)); }

    // Convert any bottom/right-based anchoring to explicit top/left so the
    // rest of the drag/resize math only ever has to touch those properties.
    function materialize() {
      if (panel.style.top && panel.style.left && panel.style.width && panel.style.height) return;
      const r = panel.getBoundingClientRect();
      panel.style.top    = r.top + 'px';
      panel.style.left   = r.left + 'px';
      panel.style.width  = r.width + 'px';
      panel.style.height = r.height + 'px';
      panel.style.bottom = '';
      panel.style.right  = '';
    }

    // ---------- Drag via header ----------
    header.addEventListener('mousedown', (e) => {
      // Leave button / interactive clicks alone.
      if (e.target.closest('button, input, select, textarea, a')) return;
      if (e.button !== 0) return;
      e.preventDefault();
      materialize();
      panel.classList.add('is-dragging');

      const startX = e.clientX;
      const startY = e.clientY;
      const r = panel.getBoundingClientRect();
      const origLeft = r.left;
      const origTop  = r.top;

      function onMove(ev) {
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;
        const maxLeft = window.innerWidth  - panel.offsetWidth;
        const maxTop  = window.innerHeight - panel.offsetHeight;
        panel.style.left = clamp(origLeft + dx, 0, maxLeft) + 'px';
        panel.style.top  = clamp(origTop  + dy, 0, maxTop)  + 'px';
      }
      function onUp() {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup',   onUp);
        panel.classList.remove('is-dragging');
      }
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup',   onUp);
    });

    // ---------- Resize via any edge/corner handle ----------
    panel.querySelectorAll('.event-log__handle').forEach((h) => {
      h.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        materialize();
        panel.classList.add('is-resizing');

        const edge = h.dataset.resize; // n, s, e, w, ne, nw, se, sw
        const startX = e.clientX;
        const startY = e.clientY;
        const r = panel.getBoundingClientRect();
        const orig = { left: r.left, top: r.top, width: r.width, height: r.height };

        function onMove(ev) {
          const dx = ev.clientX - startX;
          const dy = ev.clientY - startY;
          let { left, top, width, height } = orig;

          if (edge.includes('e')) {
            width = clamp(orig.width + dx, MIN_W, window.innerWidth - orig.left);
          }
          if (edge.includes('w')) {
            const newW = clamp(orig.width - dx, MIN_W, orig.left + orig.width);
            left = orig.left + (orig.width - newW);
            width = newW;
          }
          if (edge.includes('s')) {
            height = clamp(orig.height + dy, MIN_H, window.innerHeight - orig.top);
          }
          if (edge.includes('n')) {
            const newH = clamp(orig.height - dy, MIN_H, orig.top + orig.height);
            top = orig.top + (orig.height - newH);
            height = newH;
          }

          panel.style.left   = left   + 'px';
          panel.style.top    = top    + 'px';
          panel.style.width  = width  + 'px';
          panel.style.height = height + 'px';
        }
        function onUp() {
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup',   onUp);
          panel.classList.remove('is-resizing');
        }
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup',   onUp);
      });
    });

    // If the viewport shrinks (window resize) we might leave the panel
    // partially off-screen. Nudge it back into bounds.
    window.addEventListener('resize', () => {
      if (!panel.style.top) return; // still using CSS anchors, nothing to fix
      const maxLeft = Math.max(0, window.innerWidth  - panel.offsetWidth);
      const maxTop  = Math.max(0, window.innerHeight - panel.offsetHeight);
      const curLeft = parseFloat(panel.style.left) || 0;
      const curTop  = parseFloat(panel.style.top)  || 0;
      panel.style.left = clamp(curLeft, 0, maxLeft) + 'px';
      panel.style.top  = clamp(curTop,  0, maxTop)  + 'px';
    });
  })();

  // --- Event log -----------------------------------------------------------
  // Builds one DOM entry per log line so we can style the time + direction
  // with bolder type and give each entry its own vertical rhythm.
  function log(dir, type, payload) {
    const entry = document.createElement('div');
    entry.className = 'event-log__entry';

    const head = document.createElement('div');
    head.className = 'event-log__head';
    const t = document.createElement('span');
    t.className = 'event-log__time';
    t.textContent = new Date().toLocaleTimeString();
    const d = document.createElement('span');
    d.className = 'event-log__dir';
    d.textContent = dir;
    const ty = document.createElement('span');
    ty.className = 'event-log__type';
    ty.textContent = type;
    head.append(t, d, ty);
    entry.append(head);

    if (payload && Object.keys(payload).length) {
      const body = document.createElement('div');
      body.className = 'event-log__payload';
      body.textContent = JSON.stringify(payload);
      entry.append(body);
    }

    $eventLog.append(entry);
    $eventLog.scrollTop = $eventLog.scrollHeight;
  }

  // --- Decorative countdown timer ------------------------------------------
  let secondsRemaining = 7 * 3600 + 58 * 60;
  function formatCountdown(s) {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return `${h} Hr ${m} Min Remaining`;
  }
  setInterval(() => {
    secondsRemaining = Math.max(0, secondsRemaining - 60);
    $timer.textContent = formatCountdown(secondsRemaining);
  }, 60_000);
  $timer.textContent = formatCountdown(secondsRemaining);

  // --- Boot ----------------------------------------------------------------
  renderCurrentPage();
  ensureMentorLoaded();
})();
