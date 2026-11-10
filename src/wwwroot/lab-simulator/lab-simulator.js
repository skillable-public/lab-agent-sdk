/**
 * lab-simulator.js
 *
 * Reference "lab host" that mimics the Skillable lab shell and embeds the
 * Lab Agent iframe.
 *
 *   [ VM tabs (Windows 11 / RDP / HTTPS / ...) |  brand   X Exit Lab ]
 *   [                                          |  Instructions | Resources | Lab Agent ? gear |
 *   [                                          |  (or Settings / Help overlay) |
 *   [   Live environment (screenshot)          |                    |
 *   [                                          | [ Prev ]  [ Next ] |
 *   [                                          | 7 Hr 58 Min Rem    |
 *
 * The Color Mode dropdown in Settings posts host.session.theme to the chat
 * iframe so you can watch the postMessage contract drive theme switching
 * in real time.
 */
(function () {
  'use strict';

  const PROTOCOL_VERSION = 2;
  const SOURCE_HOST = 'lab-host';
  const SOURCE_AGENT = 'lab-agent';

  // Inbound (chat -> host)
  const IN = {
    READY:                          'agent.session.ready',
    SESSION_OPENED:                 'agent.session.opened',
    GOTO_PAGE_REQUEST:              'agent.instructions.gotoPage.request',
    SEND_TEXT_REQUEST:              'agent.environment.sendText.request',
    SCREENSHOT_REQUEST:             'agent.environment.screenshot.request',
    LABCLIENT_SCREENSHOT_REQUEST:   'agent.labClient.screenshot.request',
    CONNECTION_QUALITY_REQUEST:     'agent.environment.connectionQuality.request',
    RECONNECT_REQUEST:              'agent.environment.reconnect.request',
    LAB_INSTRUCTIONS_REQUEST:       'agent.instructions.pages.request',
    ENVIRONMENT_COMMAND_REQUEST:    'agent.environment.command.request',
    ENVIRONMENT_COMMAND_CANCEL:     'agent.environment.command.cancel',
    TYPE_CREDENTIAL_REQUEST:        'agent.environment.typeCredential.request',
    SHOW_IN_INSTRUCTIONS_REQUEST:   'agent.instructions.show.request',
    ENVIRONMENT_KEYS_REQUEST:       'agent.environment.keys.request',
    ENVIRONMENT_MOUSE_REQUEST:      'agent.environment.mouse.request',
    ENVIRONMENT_WAIT_REQUEST:       'agent.environment.wait.request',
    SHOW_IN_ENVIRONMENT_REQUEST:    'agent.environment.show.request',
    CLEAR_IN_ENVIRONMENT:           'agent.environment.clear',
    LAB_VARIABLE_REQUEST:           'agent.lab.variable.request',
    MINUTES_REMAINING_REQUEST:      'agent.lab.minutesRemaining.request',
    LAB_STATUS_REQUEST:             'agent.lab.status.request',
    MESSAGE_SENT:                  'agent.session.messageSent',
    MENTOR_RESPONSE:                'agent.session.reply',
    ERROR:                          'agent.session.error',
  };
  // Outbound (host -> chat)
  const OUT = {
    INIT:                           'host.session.init',
    CONTEXT_UPDATE:                 'host.session.context',
    HINT_REQUEST:                   'host.session.hint',
    THEME_CHANGE:                   'host.session.theme',
    LOCALE_CHANGE:                  'host.session.locale',
    SEND_MESSAGE:                   'host.session.sendMessage',
    ENVIRONMENT_TOUR_ENDED:         'host.environment.tourEnded',
    SCREENSHOT_RESPONSE:           'host.environment.screenshot.response',
    LABCLIENT_SCREENSHOT_RESPONSE:  'host.labClient.screenshot.response',
    CONNECTION_QUALITY_RESPONSE:    'host.environment.connectionQuality.response',
    RECONNECT_RESPONSE:             'host.environment.reconnect.response',
    LAB_INSTRUCTIONS_RESPONSE:      'host.instructions.pages.response',
    ENVIRONMENT_COMMAND_RESPONSE:   'host.environment.command.response',
    TYPE_CREDENTIAL_RESPONSE:       'host.environment.typeCredential.response',
    SHOW_IN_INSTRUCTIONS_RESPONSE:  'host.instructions.show.response',
    GOTO_PAGE_RESPONSE:             'host.instructions.gotoPage.response',
    SEND_TEXT_RESPONSE:             'host.environment.sendText.response',
    ENVIRONMENT_KEYS_RESPONSE:      'host.environment.keys.response',
    ENVIRONMENT_MOUSE_RESPONSE:     'host.environment.mouse.response',
    ENVIRONMENT_WAIT_RESPONSE:      'host.environment.wait.response',
    SHOW_IN_ENVIRONMENT_RESPONSE:   'host.environment.show.response',
    AUTH_REFRESH:                   'host.session.authRefresh',
    LAB_VARIABLE_RESPONSE:          'host.lab.variable.response',
    MINUTES_REMAINING_RESPONSE:     'host.lab.minutesRemaining.response',
    LAB_STATUS_RESPONSE:            'host.lab.status.response',
  };

  // Sandbox-fixed identity for the simulated student. In a real lab
  // platform this comes from the authenticated user's session.
  const SANDBOX_USER_ID = 'u-john-doe';
  const SANDBOX_USER_ROLE = 'student';

  // The learner policies the simulator can apply, picked in Settings > Lab Agent
  // policy. A real host gets its policy from the lab's Lab Agent profile; the
  // fields and values are the spec's (docs/spec/core.md, section 9).
  const LEARNER_BASE = {
    screenshots: 'on', showOnScreen: 'on', actInEnvironment: 'ask', offerAllowForLab: 'off', actionsPerRequest: 10,
    typeCredentials: 'on', runCommands: 'on', checkTasks: 'off', activities: 'off', setVariables: 'off',
    evaluateActivities: 'off', suggestEdits: 'off', applyEdits: 'off', pasteImages: 'off',
    learnerNotice: 'notRequired', scope: 'lab', qaRuns: 'off',
  };
  const POLICIES = {
    ask: { ...LEARNER_BASE },
    actInEnvironment: { ...LEARNER_BASE, actInEnvironment: 'on' },
    lookOnly: { ...LEARNER_BASE, actInEnvironment: 'off', typeCredentials: 'off', runCommands: 'off' },
    nothing: { ...LEARNER_BASE, screenshots: 'off', showOnScreen: 'off', actInEnvironment: 'off', typeCredentials: 'off', runCommands: 'off' },
  };
  const POLICY_KEY = 'lab-simulator::policy';
  function policyName() {
    try {
      const name = localStorage.getItem(POLICY_KEY);
      return POLICIES[name] ? name : 'ask';
    } catch {
      return 'ask';
    }
  }
  const policy = POLICIES[policyName()];
  const allows = (field) => policy[field] === 'on';
  const allowsConsoleWork = () => policy.actInEnvironment === 'on' || policy.actInEnvironment === 'ask';

  // The modes the agent declared in its ready message. Absent or empty means a mentor.
  let declaredModes = ['mentor'];

  // Response message types we advertise to the iframe via
  // host.session.init.capabilities: what the simulated lab can do, trimmed by
  // the policy, as a real host trims them. The iframe gates its UI on them.
  function advertisedCapabilities() {
    const capabilities = [OUT.LAB_INSTRUCTIONS_RESPONSE, OUT.LAB_VARIABLE_RESPONSE, OUT.MINUTES_REMAINING_RESPONSE, OUT.LAB_STATUS_RESPONSE, OUT.ENVIRONMENT_WAIT_RESPONSE];
    if (allows('screenshots')) capabilities.push(OUT.SCREENSHOT_RESPONSE, OUT.LABCLIENT_SCREENSHOT_RESPONSE, OUT.CONNECTION_QUALITY_RESPONSE, OUT.RECONNECT_RESPONSE);
    if (allows('showOnScreen')) capabilities.push(OUT.SHOW_IN_INSTRUCTIONS_RESPONSE, OUT.SHOW_IN_ENVIRONMENT_RESPONSE, OUT.GOTO_PAGE_RESPONSE);
    if (allowsConsoleWork()) {
      capabilities.push(OUT.SEND_TEXT_RESPONSE, OUT.ENVIRONMENT_KEYS_RESPONSE);
      if (allows('runCommands')) capabilities.push(OUT.ENVIRONMENT_COMMAND_RESPONSE);
      if (allows('typeCredentials')) capabilities.push(OUT.TYPE_CREDENTIAL_RESPONSE);
      if (allows('screenshots')) capabilities.push(OUT.ENVIRONMENT_MOUSE_RESPONSE);
    }
    return capabilities;
  }

  // host.session.init.agent for the simulated learner. The simulated user is a
  // learner, so the agent is a mentor whatever modes it declared.
  function agentSettings() {
    return {
      profileId: 'simulated-profile',
      mode: 'mentor',
      prompts: { organization: null, lab: 'Coach the learner. Never do the lab for them.' },
      qa: { allowed: false },
      policy,
      qaRequest: null,
      challengePrompt: null,
    };
  }

  // --- Asking before the agent works in the console --------------------------
  //
  // With actInEnvironment at ask, the agent's first console action for a learner message
  // puts a question over the console and is refused with "asking"; Not now
  // refuses with "declined" until the next message. Each message allows at most
  // actionsPerRequest console actions, and with a cap set none before the first.
  let consoleAnswer = null; // 'allowed' | 'declined' | null, for the latest learner message
  let consoleActions = 0;
  let learnerMessageSeen = false;
  let questionUp = false;

  function startLearnerMessage() {
    learnerMessageSeen = true;
    consoleActions = 0;
    consoleAnswer = null;
  }

  function refusal(reason, message) {
    return { ok: false, reason, message };
  }

  function showConsoleQuestion() {
    if (questionUp) return;
    questionUp = true;
    const box = document.createElement('div');
    box.className = 'sim-console-question';
    const text = document.createElement('p');
    text.textContent = 'Let the Lab Agent work in this console?';
    box.appendChild(text);
    const answer = (value) => {
      consoleAnswer = value;
      questionUp = false;
      box.remove();
      log('host', 'learner answered the console question', { answer: value });
    };
    for (const [label, value] of [['Not now', 'declined'], ['Allow once', 'allowed']]) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'button';
      button.textContent = label;
      button.addEventListener('click', (e) => { e.stopPropagation(); answer(value); });
      box.appendChild(button);
    }
    $envCanvas.appendChild(box);
  }

  // Runs a console action when the policy allows it, or answers the refusal.
  function workInConsole(perform) {
    if (!allowsConsoleWork()) return refusal('not_allowed', 'This lab does not let the Lab Agent work in the console (actInEnvironment).');
    const limit = policy.actionsPerRequest;
    const hasActionLeft = !Number.isInteger(limit) || (learnerMessageSeen && consoleActions < limit);
    if (hasActionLeft && policy.actInEnvironment === 'ask' && consoleAnswer !== 'allowed') {
      if (consoleAnswer === 'declined') return refusal('declined', 'The learner said Not now. Help them do it themselves.');
      showConsoleQuestion();
      return refusal('asking', 'The learner is being asked whether the Lab Agent may work in the console. Try again once they answer.');
    }
    if (!hasActionLeft) return refusal('not_allowed', 'The Lab Agent has taken as many console actions as this lab allows for one message (actionsPerRequest).');
    consoleActions++;
    return perform();
  }

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

If you do not see a prompt, ask the Lab Agent for help from the **Lab Agent** tab.`,

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

  // Tiny markdown renderer - supports #/## headings, paragraphs, unordered
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

  // The simulated lab's machines, matching the VM tabs. Sent in host.session.init
  // only; context updates leave it out, which means unchanged.
  // The simulated lab's variables, as @lab.Variable(name) reads them.
  const LAB_VARIABLES = { resourceGroup: 'rg-lab-123' };

  const LAB_MACHINES = [
    {
      alias: 'windows11', name: 'Windows 11', os: 'windows-11', studentVisible: true,
      endpoints: [
        { alias: 'pwsh', name: 'PowerShell', description: null, protocol: 'powershell', studentVisible: false, agentAccessible: true },
      ],
    },
    {
      alias: 'ubuntu', name: 'Ubuntu 26', os: 'ubuntu-26.04', studentVisible: true,
      endpoints: [
        { alias: 'ssh', name: 'SSH', description: null, protocol: 'ssh', studentVisible: true, agentAccessible: true },
        { alias: 'web', name: 'Web app', description: 'The lab web server', protocol: 'https', studentVisible: true, agentAccessible: false },
      ],
    },
  ];

  function currentContext(includeMachines) {
    const md = lab.pages[currentPageIndex];
    const heading = extractPageHeading(md);
    const context = {
      labId: lab.labId,
      labTitle: lab.labTitle,
      currentPageIndex,                            // zero-based
      totalPages: lab.pages.length,
      pageTitle: heading ?? undefined,             // omit when the page has no heading
      pageInstructions: md,                        // raw markdown
      environment: { name: 'Windows 11', os: 'windows-11', machine: 'windows11', endpoint: null, shell: 'powershell', cwd: 'C:\\Users\\student' },
    };
    if (includeMachines) context.machines = LAB_MACHINES;
    return context;
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

  // --- Session persistence -------------------------------------------------
  //
  // The mentor iframe owns the sessionId namespace; our job is to round-trip
  // it. The handoff is entirely over postMessage - there is no URL handoff
  // (per integration spec section 6). The flow is:
  //
  //   1. We mint a stable labInstanceId on first load and persist it. This
  //      is the host's id for the student's lab attempt; it survives
  //      refresh and lab save/resume.
  //   2. On every iframe load we send labInstanceId on host.session.init, plus any
  //      sessionId we previously stored under it.
  //   3. The chat resolves its session and replies with
  //      agent.session.opened { sessionId }. We capture that id and
  //      persist it under labInstanceId for next time.
  //
  // We use the lab id + mentor origin as the persistence scope so swapping
  // mentors or reloading a different lab in the same browser starts fresh.
  const MENTOR_ORIGIN = MENTOR_URL ? new URL(MENTOR_URL, window.location.href).origin : '';
  const PERSISTENCE_SCOPE = `${lab.labId}::${MENTOR_ORIGIN}`;
  const LAB_INSTANCE_KEY = `lab-instance::${PERSISTENCE_SCOPE}`;

  function newLabInstanceId() {
    // Stand-in for the production lab platform's labInstanceId, which
    // is a server-assigned numeric id (a long, serialized as a string
    // per the spec). The simulator uses a timestamp here for stability
    // across reloads. Treat it as opaque - no entropy guarantees, and
    // do NOT derive a sessionId from it (see spec section 6).
    return String(Date.now());
  }
  function getLabInstanceId() {
    try {
      let id = localStorage.getItem(LAB_INSTANCE_KEY);
      if (!id) {
        id = newLabInstanceId();
        localStorage.setItem(LAB_INSTANCE_KEY, id);
      }
      return id;
    } catch {
      // Private mode etc.; fall back to a session-scoped id so we still
      // produce a stable value within this page lifetime.
      return getLabInstanceId._fallback ||= newLabInstanceId();
    }
  }
  // Each persisted sessionId lives under the labInstanceId so multiple
  // attempts (same student, same lab, different runs) don't collide.
  function sessionStorageKey(labInstanceId) {
    return `mentor-session::${PERSISTENCE_SCOPE}::${labInstanceId}`;
  }
  function getStoredSessionId(labInstanceId) {
    try { return localStorage.getItem(sessionStorageKey(labInstanceId)) || null; }
    catch { return null; }
  }
  function setStoredSessionId(labInstanceId, id) {
    try {
      if (id) localStorage.setItem(sessionStorageKey(labInstanceId), id);
      else localStorage.removeItem(sessionStorageKey(labInstanceId));
    } catch { /* persistence is best-effort */ }
  }

  function iframeUrl() {
    // Resolve the (possibly-relative) mentor URL against this page first,
    // then layer on the theme. Note: sessionId / labInstanceId are NOT
    // URL parameters - they travel through postMessage (host.session.init ->
    // agent.session.opened) per the integration spec.
    const base = new URL(MENTOR_URL, window.location.href);
    base.searchParams.set('theme', currentThemePayload().theme);
    return base.toString();
  }
  function ensureMentorLoaded() {
    if (mentorLoaded || !MENTOR_URL) return;
    $iframe.src = iframeUrl();
    mentorLoaded = true;
  }

  // --- postMessage plumbing -------------------------------------------------
  // `correlationId` echoes back a request's envelope id so the iframe can
  // pair the response to the original request (used by
  // host.environment.screenshot.response). Omit for fire-and-forget messages.
  function post(type, payload, correlationId) {
    if (!mentorLoaded || !$iframe.contentWindow) return;
    const msg = { source: SOURCE_HOST, version: PROTOCOL_VERSION, type, payload };
    if (correlationId) msg.id = correlationId;
    $iframe.contentWindow.postMessage(msg, new URL(iframeUrl()).origin);
    log('host \u2192 agent', type, payload);
  }

  // --- Launch token minting + refresh push ---------------------------------
  // Per spec section 3.2, the host always offers a launch token in
  // host.session.init and pushes a fresh one via host.session.authRefresh shortly before
  // the current token's exp. We delegate signing to the backend
  // (/api/lab/launch-token) \u2014 in production that would call into Azure
  // Key Vault.
  async function fetchLaunchToken({ userId, labInstanceId }) {
    try {
      const res = await fetch('/api/lab/launch-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, labInstanceId, role: SANDBOX_USER_ROLE }),
      });
      if (!res.ok) {
        log('host', 'launch-token mint failed', { status: res.status });
        return null;
      }
      return await res.json(); // { authToken, expiresAt }
    } catch (e) {
      log('host', 'launch-token mint error', { error: String(e) });
      return null;
    }
  }

  let refreshTimerId = null;
  function scheduleTokenRefresh({ userId, labInstanceId, expiresAt }) {
    if (refreshTimerId) clearTimeout(refreshTimerId);
    if (!expiresAt) return;
    // Refresh ~60 seconds before exp (spec 3.2.3). Clamp to a 1s minimum
    // so we don't busy-loop if the server returned a token that's already
    // near expiry.
    const refreshAt = new Date(expiresAt).getTime() - 60_000;
    const delay = Math.max(1000, refreshAt - Date.now());
    refreshTimerId = setTimeout(async () => {
      const result = await fetchLaunchToken({ userId, labInstanceId });
      if (!result) return;
      post(OUT.AUTH_REFRESH, { authToken: result.authToken });
      scheduleTokenRefresh({ userId, labInstanceId, expiresAt: result.expiresAt });
    }, delay);
  }

  // Fake background commands still running, by request envelope id, so a
  // agent.environment.command.cancel can stop one before it answers.
  const runningCommands = new Map();

  window.addEventListener('message', async (event) => {
    if (!$iframe || event.source !== $iframe.contentWindow) return;
    if (event.origin !== MENTOR_ORIGIN) return;
    const msg = event.data;
    if (!msg || msg.source !== SOURCE_AGENT || msg.version !== PROTOCOL_VERSION) return;

    log('agent → host', msg.type, msg.payload);

    switch (msg.type) {
      case IN.READY: {
        if ($bridgeStatus) {
          $bridgeStatus.textContent = 'Connected';
          $bridgeStatus.classList.add('is-connected');
        }
        // agent.session.ready is a pure handshake carrying the agent's modes;
        // the agent doesn't yet know its sessionId. We respond with
        // host.session.init carrying:
        //   - resume hints (labInstanceId + previously-stored sessionId);
        //   - a launch token, when a token endpoint is there to mint one;
        //   - the capabilities and agent settings the policy gives.
        // The agent resolves the session and replies with agent.session.opened.
        declaredModes = Array.isArray(msg.payload?.modes) && msg.payload.modes.length ? msg.payload.modes : ['mentor'];
        const labInstanceId = getLabInstanceId();
        const tokenResult = await fetchLaunchToken({
          userId: SANDBOX_USER_ID,
          labInstanceId,
        });
        post(OUT.INIT, {
          labInstanceId,
          authToken: tokenResult?.authToken,
          sessionId: getStoredSessionId(labInstanceId),
          userName: 'John Doe',
          userId: SANDBOX_USER_ID,
          userRole: SANDBOX_USER_ROLE,
          userOrganizationId: 'org-acme',
          userOrganizationName: 'Acme',
          ...currentThemePayload(),
          locale: 'en',
          labContext: currentContext(true),
          capabilities: advertisedCapabilities(),
          agent: agentSettings(),
        });
        if (tokenResult) {
          scheduleTokenRefresh({
            userId: SANDBOX_USER_ID,
            labInstanceId,
            expiresAt: tokenResult.expiresAt,
          });
        }
        break;
      }
      case IN.SESSION_OPENED: {
        // Capture the agent's announced sessionId and persist it under
        // our labInstanceId. On the next iframe load (refresh, lab
        // save/resume, etc.) we'll re-supply it on host.session.init.sessionId.
        const sessionId = msg.payload?.sessionId;
        if (sessionId) setStoredSessionId(getLabInstanceId(), sessionId);
        break;
      }
      case IN.SCREENSHOT_REQUEST: {
        // Environment screenshot - captures only the VM/desktop surface.
        // A real lab host would call its capture primitive against the
        // active environment target.
        if (!allows('screenshots')) {
          post(OUT.SCREENSHOT_RESPONSE, { data_url: null, ...refusal('not_allowed', 'This lab does not let the Lab Agent take screenshots (screenshots).') }, msg.id);
          break;
        }
        const placed = placeScreenshotRegion(msg.payload?.region);
        if (placed.failure) {
          post(OUT.SCREENSHOT_RESPONSE, { data_url: null, ...placed.failure }, msg.id);
          break;
        }
        post(OUT.SCREENSHOT_RESPONSE, captureEnvironment(placed.area), msg.id);
        break;
      }
      case IN.ENVIRONMENT_MOUSE_REQUEST: {
        const refused = refusedBeforeAction(msg.payload);
        if (refused) {
          post(OUT.ENVIRONMENT_MOUSE_RESPONSE, refused, msg.id);
          break;
        }
        const answer = !allows('screenshots') && allowsConsoleWork()
          ? refusal('not_allowed', 'This lab does not let the Lab Agent take screenshots, which the mouse aims by (screenshots).')
          : workInConsole(() => useFakeMouse(msg.payload || {}));
        answerAction(OUT.ENVIRONMENT_MOUSE_RESPONSE, msg, answer);
        break;
      }
      case IN.ENVIRONMENT_WAIT_REQUEST:
        waitForFakeScreen(msg.payload || {}, (response) => post(OUT.ENVIRONMENT_WAIT_RESPONSE, response, msg.id));
        break;
      case IN.SHOW_IN_ENVIRONMENT_REQUEST:
        post(OUT.SHOW_IN_ENVIRONMENT_RESPONSE, allows('showOnScreen')
          ? showFakeEnvironmentMark(msg.payload || {}, msg.id)
          : refusal('not_allowed', 'This lab does not let the Lab Agent show things on screen (showOnScreen).'), msg.id);
        break;
      case IN.CLEAR_IN_ENVIRONMENT:
        clearEnvironmentMark('cleared');
        break;
      case IN.LABCLIENT_SCREENSHOT_REQUEST: {
        // Lab-client screenshot - captures the entire lab-client UI
        // (instructions pane + chrome + environment area). A real host
        // would capture its own DOM or window.
        const responsePayload = allows('screenshots')
          ? produceFakeScreenshot('labClient')
          : { data_url: null, ...refusal('not_allowed', 'This lab does not let the Lab Agent take screenshots (screenshots).') };
        post(OUT.LABCLIENT_SCREENSHOT_RESPONSE, responsePayload, msg.id);
        break;
      }
      case IN.CONNECTION_QUALITY_REQUEST: {
        // Sample host generates a random latency in [0,600] and maps it
        // to the spec's quality enum. A real host would consult its
        // controller / network measurement subsystem.
        const responsePayload = allows('screenshots')
          ? produceFakeConnectionQuality()
          : { latencyMilliseconds: null, quality: 'Unknown', reason: 'not_allowed', message: 'This lab does not let the Lab Agent check the connection (screenshots).' };
        post(OUT.CONNECTION_QUALITY_RESPONSE, responsePayload, msg.id);
        break;
      }
      case IN.RECONNECT_REQUEST: {
        // The simulated console has nothing to reconnect, so it says the reconnect started.
        post(OUT.RECONNECT_RESPONSE, allows('screenshots')
          ? { ok: true }
          : refusal('not_allowed', 'This lab does not let the Lab Agent reconnect the console (screenshots).'), msg.id);
        break;
      }
      case IN.LAB_INSTRUCTIONS_REQUEST: {
        // Return the full set of instruction pages. The simulator builds
        // its lab content statically in `lab.pages` (markdown strings);
        // we map each to a LabPage object using the same heading
        // extractor that drives LabContext.pageTitle. A real host would
        // serve whatever its authoring system provides.
        const responsePayload = produceLabInstructions();
        post(OUT.LAB_INSTRUCTIONS_RESPONSE, responsePayload, msg.id);
        break;
      }
      case IN.ENVIRONMENT_COMMAND_REQUEST: {
        // Out-of-band command. A real host runs it in a background session
        // on the active environment and returns what it printed; the
        // simulator has no machine, so it flashes the command on the fake
        // desktop and returns canned output after a short delay. It runs out
        // of the learner's sight, but it acts in the environment: actInEnvironment gates it,
        // the learner is asked first under ask, and it counts toward the
        // message's console actions.
        const commandRefusal = (reason, message) => ({ stdout: '', stderr: '', exitCode: null, ...refusal(reason, message) });
        if (!allows('runCommands')) {
          post(OUT.ENVIRONMENT_COMMAND_RESPONSE, commandRefusal('not_allowed', 'This lab does not let the Lab Agent run commands (runCommands).'), msg.id);
          break;
        }
        const command = String(msg.payload?.command || '');
        const machine = msg.payload?.machine || 'windows11';
        const target = resolveCommandEndpoint(machine, msg.payload?.endpoint);
        if (!target.ok) {
          post(OUT.ENVIRONMENT_COMMAND_RESPONSE, commandRefusal(target.reason, target.message), msg.id);
          break;
        }
        const answer = workInConsole(() => {
          showEnvToast(`[background on ${machine}/${target.endpoint}] ${command}`);
          runningCommands.set(msg.id, setTimeout(() => {
            runningCommands.delete(msg.id);
            post(OUT.ENVIRONMENT_COMMAND_RESPONSE, produceFakeCommandResult(command, machine), msg.id);
          }, 800));
          return null;
        });
        if (answer) post(OUT.ENVIRONMENT_COMMAND_RESPONSE, commandRefusal(answer.reason, answer.message), msg.id);
        break;
      }
      case IN.ENVIRONMENT_COMMAND_CANCEL: {
        // Fire-and-forget. A command that already finished, or an unknown
        // id, is ignored; a running one is ended and its original request
        // answered as cancelled.
        const requestId = msg.payload?.requestId;
        const timer = runningCommands.get(requestId);
        if (timer === undefined) break;
        clearTimeout(timer);
        runningCommands.delete(requestId);
        post(OUT.ENVIRONMENT_COMMAND_RESPONSE, {
          ok: false, stdout: '', stderr: '', exitCode: null,
          reason: 'cancelled',
          message: 'The command was cancelled.',
        }, requestId);
        break;
      }
      case IN.TYPE_CREDENTIAL_REQUEST: {
        // A real host looks the value up and types it into the selected
        // console. The simulator has no credentials, so the toast names
        // the credential instead of showing one.
        const answer = allowsConsoleWork() && !allows('typeCredentials')
          ? refusal('not_allowed', 'This lab does not let the Lab Agent type credentials (typeCredentials).')
          : workInConsole(() => typeFakeCredential(msg.payload || {}));
        post(OUT.TYPE_CREDENTIAL_RESPONSE, answer, msg.id);
        break;
      }
      case IN.ENVIRONMENT_KEYS_REQUEST: {
        // The simulated console has nothing to press keys in, so the toast
        // names them instead.
        const keys = msg.payload?.keys;
        const repeat = msg.payload?.repeat;
        const refused = refusedBeforeAction(msg.payload);
        if (refused) {
          post(OUT.ENVIRONMENT_KEYS_RESPONSE, refused, msg.id);
          break;
        }
        if (typeof keys !== 'string' || !keys.trim()) {
          post(OUT.ENVIRONMENT_KEYS_RESPONSE, refusal('failed', 'Name the keys to press.'), msg.id);
          break;
        }
        answerAction(OUT.ENVIRONMENT_KEYS_RESPONSE, msg, workInConsole(() => {
          showEnvToast(`[pressed ${keys.trim()}${Number.isInteger(repeat) && repeat > 1 ? ` x${repeat}` : ''}]`);
          return { ok: true, reason: null, message: null };
        }));
        break;
      }
      case IN.SHOW_IN_INSTRUCTIONS_REQUEST:
        post(OUT.SHOW_IN_INSTRUCTIONS_RESPONSE, allows('showOnScreen')
          ? showFakePointer(msg.payload || {})
          : refusal('not_allowed', 'This lab does not let the Lab Agent show things on screen (showOnScreen).'), msg.id);
        break;
      case IN.LAB_VARIABLE_REQUEST: {
        const name = typeof msg.payload?.name === 'string' ? msg.payload.name.trim() : '';
        post(OUT.LAB_VARIABLE_RESPONSE, name
          ? { ok: true, reason: null, message: null, value: LAB_VARIABLES[name] ?? null }
          : refusal('failed', 'Name the variable.'), msg.id);
        break;
      }
      case IN.MINUTES_REMAINING_REQUEST:
        post(OUT.MINUTES_REMAINING_RESPONSE, { ok: true, reason: null, message: null, minutes: Math.max(0, Math.floor(secondsRemaining / 60)) }, msg.id);
        break;
      // The simulated lab is always running, so it answers at once, whatever waitSeconds asks.
      case IN.LAB_STATUS_REQUEST:
        post(OUT.LAB_STATUS_RESPONSE, { ok: true, reason: null, message: null, ready: true, state: 'running', waitedSeconds: 0, timedOut: false }, msg.id);
        break;
      case IN.GOTO_PAGE_REQUEST: {
        const index = msg.payload?.index;
        let answer;
        if (!allows('showOnScreen')) {
          answer = refusal('not_allowed', 'This lab does not let the Lab Agent show things on screen (showOnScreen).');
        } else if (!Number.isInteger(index)) {
          answer = refusal('failed', 'index must be a zero-based page index.');
        } else if (index < 0 || index >= lab.pages.length) {
          answer = refusal('not_found', `The instructions have no page ${index}. They have pages 0 to ${lab.pages.length - 1}.`);
        } else {
          gotoInstructionsPage(index, msg.payload?.show === true);
          answer = { ok: true, reason: null, message: null, page: currentPageIndex };
        }
        post(OUT.GOTO_PAGE_RESPONSE, answer, msg.id);
        break;
      }
      case IN.SEND_TEXT_REQUEST: {
        // The simulated console has nothing to type into, so the toast shows
        // the text. ok says only that it was delivered, as on a real host.
        const text = msg.payload?.text;
        if (typeof text !== 'string' || !text) {
          post(OUT.SEND_TEXT_RESPONSE, refusal('failed', 'Give the text to type.'), msg.id);
          break;
        }
        answerAction(OUT.SEND_TEXT_RESPONSE, msg, workInConsole(() => {
          showEnvToast(text);
          return { ok: true, reason: null, message: null, sent: text.length };
        }));
        break;
      }
      case IN.MESSAGE_SENT:
        startLearnerMessage();
        break;
      case IN.MENTOR_RESPONSE:
        showMentorBadge();
        break;
      default:
        // A request the simulator doesn't fulfill still gets its one response.
        if (typeof msg.type === 'string' && msg.type.startsWith('agent.') && msg.type.endsWith('.request')) {
          post(msg.type.replace(/^agent\./, 'host.').replace(/\.request$/, '.response'),
            refusal('not_supported', 'The lab simulator does not do this.'), msg.id);
        }
    }
  });

  // Outlines the first block on the page that holds the text, or the image.
  // A real host marks the exact words, scrolls them a third of the way down
  // the pane and adds a caption that links back to the mentor; the simulator
  // outlines the block and shows the note in a toast. Its pages have no
  // activities.
  function showFakePointer({ text, image, activity, page, note }) {
    const named = [text, image, activity].filter((v) => typeof v === 'string' && v.trim());
    if (named.length !== 1) {
      return { ok: false, reason: 'failed', message: 'Name exactly one of text, image or activity.' };
    }
    const index = Number.isInteger(page) ? page : currentPageIndex;
    if (index < 0 || index >= lab.pages.length) {
      return { ok: false, reason: 'not_found', message: `The instructions have no page ${index}.` };
    }
    if (activity) {
      return { ok: false, reason: 'not_found', message: 'The simulated lab has no activities.' };
    }
    const previous = currentPageIndex;
    if (index !== previous) gotoInstructionsPage(index);
    const fold = (s) => s.replace(/\s+/g, '').toLowerCase();
    let target;
    if (text) {
      const wanted = fold(text);
      target = Array.from($labPage.querySelectorAll('p, li, h1, h2, h3, h4, pre, td, blockquote'))
        .find((el) => fold(el.textContent).includes(wanted));
    } else {
      const wanted = image.trim().toLowerCase();
      target = Array.from($labPage.querySelectorAll('img'))
        .find((img) => (img.alt || '').toLowerCase() === wanted
          || (img.getAttribute('src') || '').split('/').pop().toLowerCase() === wanted);
    }
    if (!target) {
      if (index !== previous) gotoInstructionsPage(previous);
      return { ok: false, reason: 'not_found', message: `Page ${index} has no ${text ? 'text' : 'image'} matching that.` };
    }
    activateTab('instructions');
    $labPage.querySelectorAll('.sim-pointer').forEach((el) => el.classList.remove('sim-pointer'));
    target.classList.add('sim-pointer');
    $labPage.addEventListener('click', () => target.classList.remove('sim-pointer'), { once: true });
    target.scrollIntoView({ block: 'center', behavior: 'smooth' });
    if (typeof note === 'string' && note.trim()) showEnvToast(`[pointed at the instructions] ${note.trim()}`);
    return { ok: true, reason: null, message: null };
  }

  function typeFakeCredential({ credential, machine, endpoint, pressEnter }) {
    if (credential !== 'username' && credential !== 'password') {
      return { ok: false, reason: 'failed', message: `Unknown credential '${credential}'.` };
    }
    // Naming neither types the selected endpoint's credentials, or the
    // selected VM's when no endpoint is selected. Naming either targets
    // explicitly: machine defaults to the selected VM, and an endpoint's
    // credentials are typed only when it is named.
    const selected = currentContext(false).environment;
    const machineAlias = machine || selected.machine;
    const endpointAlias = machine || endpoint ? endpoint : selected.endpoint;
    const target = LAB_MACHINES.find((m) => m.alias === machineAlias);
    if (!target) {
      return { ok: false, reason: 'not_available', message: `There is no virtual machine with the alias '${machineAlias}'.` };
    }
    if (endpointAlias && !target.endpoints.some((e) => e.alias === endpointAlias)) {
      return { ok: false, reason: 'not_available', message: `There is no endpoint with the alias '${endpointAlias}' on '${machineAlias}'.` };
    }
    const owner = endpointAlias ? `${machineAlias}/${endpointAlias}` : machineAlias;
    showEnvToast(`[typed ${credential} for ${owner}${pressEnter ? ' + Enter' : ''}]`);
    return { ok: true, reason: null, message: null };
  }

  // --- The mentor's mouse and marks on the simulated screen ------------------
  //
  // The mentor names spots in pixels on its latest environment screenshot,
  // with that screenshot's size. A real host scales them to the VM's screen;
  // the simulator has no VM, so it places them at the same fraction of the
  // simulated desktop. Spots before any screenshot answer stale, as they do
  // on a real host.
  const ENV_CAPTURE_WIDTH = 800;
  const ENV_CAPTURE_HEIGHT = 480;
  const MOUSE_ACTIONS = ['move', 'click', 'double_click', 'triple_click', 'right_click', 'drag', 'scroll'];
  // The latest screenshot's size and the part of the screen it shows, { x, y, width, height } in
  // capture pixels, or null before the first.
  let screenshotFrame = null;

  const isWithin = (value, limit) => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= limit;

  // A spot on the screenshot as fractions of the screen, or the failure to answer with.
  function screenSpot(p, x, y) {
    if (!Number.isInteger(p.screenshotWidth) || p.screenshotWidth <= 0 || !Number.isInteger(p.screenshotHeight) || p.screenshotHeight <= 0) {
      return { failure: { ok: false, reason: 'failed', message: 'screenshotWidth and screenshotHeight must be the size in pixels of the screenshot the spot is on.' } };
    }
    if (!isWithin(x, p.screenshotWidth) || !isWithin(y, p.screenshotHeight)) {
      return { failure: { ok: false, reason: 'failed', message: 'The spot must be on the screenshot, in its pixels.' } };
    }
    if (!screenshotFrame) {
      return { failure: { ok: false, reason: 'stale', message: 'There is no screenshot of this console yet. Take one and find the spot on it.' } };
    }
    const area = screenshotFrame.area;
    const shown = area.width / area.height;
    if (Math.abs(p.screenshotWidth / p.screenshotHeight - shown) / shown > 0.02) {
      return { failure: { ok: false, reason: 'failed', message: `The screenshot was ${area.width} by ${area.height} pixels; screenshotWidth and screenshotHeight must be its size, or its size scaled down.` } };
    }
    return {
      fx: (area.x + (x / p.screenshotWidth) * area.width) / ENV_CAPTURE_WIDTH,
      fy: (area.y + (y / p.screenshotHeight) * area.height) / ENV_CAPTURE_HEIGHT,
    };
  }

  // A screenshot's region, given on the latest screenshot, as the part of the
  // simulated screen it shows: { area } in capture pixels, null for the whole
  // screen, or { failure }.
  function placeScreenshotRegion(region) {
    if (region === undefined || region === null) return { area: null };
    const corner = screenSpot(region, region.x, region.y);
    if (corner.failure) return corner;
    if (!(region.width > 0) || !(region.height > 0)
      || !isWithin(region.x + region.width, region.screenshotWidth) || !isWithin(region.y + region.height, region.screenshotHeight)) {
      return { failure: { ok: false, reason: 'failed', message: 'A region needs x and y for its top left corner and a width and height that keep it on the screenshot.' } };
    }
    const scale = screenshotFrame.area.width / region.screenshotWidth;
    return {
      area: {
        x: Math.round(corner.fx * ENV_CAPTURE_WIDTH),
        y: Math.round(corner.fy * ENV_CAPTURE_HEIGHT),
        width: Math.max(1, Math.round(region.width * scale)),
        height: Math.max(1, Math.round(region.height * (screenshotFrame.area.height / region.screenshotHeight))),
      },
    };
  }

  // The simulated screen, or the area of it given, recorded as the latest
  // screenshot so the agent's next spots are read against it.
  function captureEnvironment(area) {
    const shot = produceFakeScreenshot('environment', area);
    if (!shot.ok) return shot;
    const shown = area ?? { x: 0, y: 0, width: ENV_CAPTURE_WIDTH, height: ENV_CAPTURE_HEIGHT };
    screenshotFrame = { area: shown };
    if (area) Object.assign(shot, { region: { ...area }, screenWidth: ENV_CAPTURE_WIDTH, screenHeight: ENV_CAPTURE_HEIGHT });
    return shot;
  }

  function placeOnScreen(el, fx, fy) {
    el.style.left = `${(fx * 100).toFixed(2)}%`;
    el.style.top = `${(fy * 100).toFixed(2)}%`;
    $envCanvas.appendChild(el);
  }

  function rippleAt(fx, fy, delay = 0) {
    const ripple = document.createElement('div');
    ripple.className = 'sim-env-ripple';
    ripple.style.animationDelay = `${delay}ms`;
    placeOnScreen(ripple, fx, fy);
    setTimeout(() => ripple.remove(), 900 + delay);
  }

  function useFakeMouse(p) {
    if (!MOUSE_ACTIONS.includes(p.action)) {
      return { ok: false, reason: 'failed', message: `action must be one of ${MOUSE_ACTIONS.join(', ')}.` };
    }
    const from = screenSpot(p, p.x, p.y);
    if (from.failure) return from.failure;
    let to = null;
    if (p.action === 'drag') {
      if (!isWithin(p.toX, p.screenshotWidth) || !isWithin(p.toY, p.screenshotHeight)) {
        return { ok: false, reason: 'failed', message: 'A drag needs toX and toY, where it ends on the screenshot.' };
      }
      to = screenSpot(p, p.toX, p.toY);
    }
    const amount = p.amount ?? 1;
    if (p.action === 'scroll' && (!['up', 'down', undefined].includes(p.direction) || !Number.isInteger(amount) || amount < 1 || amount > 20)) {
      return { ok: false, reason: 'failed', message: 'A scroll needs direction up or down and amount, a whole number of notches from 1 to 20.' };
    }
    if (!envTour) clearEnvironmentMark();
    if (p.action !== 'move' && p.action !== 'scroll') rippleAt(from.fx, from.fy);
    if (p.action === 'double_click' || p.action === 'triple_click') rippleAt(from.fx, from.fy, 150);
    if (p.action === 'triple_click') rippleAt(from.fx, from.fy, 300);
    if (to) rippleAt(to.fx, to.fy, 300);
    const where = `${Math.round(p.x)},${Math.round(p.y)}`;
    showEnvToast(p.action === 'scroll'
      ? `[scrolled ${p.direction || 'down'} ${amount} at ${where}]`
      : `[${p.action.replace('_', '-')} at ${where}${to ? ` to ${Math.round(p.toX)},${Math.round(p.toY)}` : ''}]`);
    return { ok: true, reason: null, message: null };
  }

  // Answers a text, keys or mouse request. One that asks for the screen back gets
  // the simulated capture with its size, recorded like a screenshot request's
  // so the mentor's next spots are read against it, after a short pause
  // standing in for a real host waiting for the screen to settle.
  const ACTION_SETTLE_MS = 500;
  // A keys or mouse request's waitUntil or screenshotRegion that the host
  // would refuse before acting, as the failed response, or null when they're
  // fine or absent.
  function refusedBeforeAction(payload) {
    const wait = payload?.waitUntil;
    const inRange = (value, max) => value === undefined || (typeof value === 'number' && value > 0 && value <= max);
    if (wait !== undefined && wait !== null
      && ((wait.until !== 'changes' && wait.until !== 'settles') || !inRange(wait.timeoutSeconds, 60) || !inRange(wait.quietSeconds, 10))) {
      return { ok: false, reason: 'failed', message: 'waitUntil needs until "changes" or "settles", timeoutSeconds up to 60 and quietSeconds up to 10.' };
    }
    if (payload?.screenshotRegion === undefined || payload.screenshotRegion === null) return null;
    if (payload.screenshot !== true) return { ok: false, reason: 'failed', message: 'screenshotRegion needs screenshot: true.' };
    return placeScreenshotRegion(payload.screenshotRegion).failure ?? null;
  }

  // Answers a text, keys or mouse request once its action is done: after the wait
  // it asked for in waitUntil, reported in waited, and with the screen when it
  // asked for screenshot.
  function answerAction(type, msg, response) {
    const wantsScreenshot = msg.payload?.screenshot === true;
    const wait = msg.payload?.waitUntil;
    // A keys or mouse request's region was checked before the action, by refusedBeforeAction.
    const placed = wantsScreenshot ? placeScreenshotRegion(msg.payload?.screenshotRegion) : { area: null };
    if (!response.ok || (!wantsScreenshot && !wait)) {
      post(type, response, msg.id);
      return;
    }
    const finish = (waited) => {
      const answer = waited ? { ...response, waited } : { ...response };
      if (!wantsScreenshot) {
        post(type, answer, msg.id);
        return;
      }
      setTimeout(() => {
        // Typed text's region is placed only now, so a bad one fails just the screenshot.
        const shot = placed.failure ? { data_url: null, ...placed.failure } : captureEnvironment(placed.area);
        if (shot.ok) Object.assign(shot, { width: screenshotFrame.area.width, height: screenshotFrame.area.height });
        post(type, { ...answer, screenshot: shot }, msg.id);
      }, ACTION_SETTLE_MS);
    };
    if (wait) waitForFakeScreen(wait, finish);
    else finish(null);
  }

  // --- Waiting on the simulated screen ---------------------------------------
  //
  // A real host watches a small thumbnail of the console's screen. The
  // simulated desktop only changes when something is shown on it (a toast, a
  // ripple, a mark) or the student clicks it, so those times stand in for
  // what a real host would see change.
  let lastScreenChangeAt = 0;
  function noteScreenChange() {
    lastScreenChangeAt = Date.now();
  }

  // An action taken just before the request may still be drawing, so it
  // counts as the change a "changes" wait is for.
  const RECENT_CHANGE_MS = 1500;
  const WAIT_POLL_MS = 200;

  function waitForFakeScreen(p, answer) {
    const started = Date.now();
    const respond = (ok, reason, message) => answer({ ok, reason, message, waitedMs: Date.now() - started });
    const inRange = (value, max) => value === undefined || (typeof value === 'number' && value > 0 && value <= max);
    if (p.until !== 'changes' && p.until !== 'settles') {
      respond(false, 'failed', 'until must be "changes" or "settles".');
      return;
    }
    if (!inRange(p.timeoutSeconds, 60) || !inRange(p.quietSeconds, 10)) {
      respond(false, 'failed', 'timeoutSeconds must be over 0 and at most 60, and quietSeconds over 0 and at most 10.');
      return;
    }
    const timeoutMs = (p.timeoutSeconds ?? 10) * 1000;
    const quietMs = (p.quietSeconds ?? 2) * 1000;
    const changedSince = started - (p.until === 'changes' ? RECENT_CHANGE_MS : 0);
    const timer = setInterval(() => {
      const now = Date.now();
      const done = p.until === 'changes'
        ? lastScreenChangeAt > changedSince
        : now - Math.max(started, lastScreenChangeAt) >= quietMs;
      if (done) {
        clearInterval(timer);
        respond(true, null, null);
      } else if (now - started >= timeoutMs) {
        clearInterval(timer);
        respond(false, 'timeout', p.until === 'changes'
          ? `The screen didn't change within ${timeoutMs / 1000} seconds.`
          : `The screen didn't stop changing within ${timeoutMs / 1000} seconds.`);
      }
    }, WAIT_POLL_MS);
  }

  // The tour on screen, if any: { requestId, steps, index }. Its steps are
  // already checked and placed, so moving through them can't fail.
  let envTour = null;

  // Takes the mark or tour off the screen. A tour that goes tells the mentor
  // how it ended, with `reason` as host.environment.tourEnded carries it.
  function clearEnvironmentMark(reason) {
    $envCanvas.querySelectorAll('.sim-env-mark, .sim-env-tip').forEach((el) => el.remove());
    if (!envTour) return;
    const tour = envTour;
    envTour = null;
    post(OUT.ENVIRONMENT_TOUR_ENDED, {
      requestId: tour.requestId,
      completed: reason === 'done',
      reason,
      step: tour.index + 1,
      steps: tour.steps.length,
    });
  }

  // One mark checked against the screenshot: { note, spot, region }, or the failure to answer with.
  function checkEnvironmentMark(m, size) {
    const note = typeof m.note === 'string' ? m.note.trim().slice(0, 200) : '';
    const hasSpot = m.x !== undefined && m.x !== null;
    const hasRegion = m.width !== undefined && m.width !== null;
    if (!hasSpot && !note) {
      return { failure: { ok: false, reason: 'failed', message: 'Give a note, a spot (x and y), or both.' } };
    }
    if (!hasSpot) return { note, spot: null, region: null };
    const spot = screenSpot(size, m.x, m.y);
    if (spot.failure) return spot;
    if (hasRegion && (!(m.width > 0) || !(m.height > 0)
      || !isWithin(m.x + m.width, size.screenshotWidth) || !isWithin(m.y + m.height, size.screenshotHeight))) {
      return { failure: { ok: false, reason: 'failed', message: 'A region needs x and y for its top left corner and a width and height that keep it on the screenshot.' } };
    }
    const area = screenshotFrame.area;
    const region = hasRegion ? { fw: (m.width / size.screenshotWidth) * area.width / ENV_CAPTURE_WIDTH, fh: (m.height / size.screenshotHeight) * area.height / ENV_CAPTURE_HEIGHT } : null;
    return { note, spot, region };
  }

  // Draws a checked mark with its caption. `tour` adds the step count and
  // Back, Next and Done; without it the caption is a single mark's.
  function drawEnvironmentMark({ note, spot, region }, tour) {
    noteScreenChange();
    $envCanvas.querySelectorAll('.sim-env-mark, .sim-env-tip').forEach((el) => el.remove());
    const caption = document.createElement('div');
    caption.className = 'sim-env-tip';
    const body = document.createElement('div');
    body.className = 'sim-env-tip__body';
    const text = document.createElement('span');
    text.textContent = note || 'Here';
    const backToMentor = document.createElement('button');
    backToMentor.type = 'button';
    backToMentor.className = 'sim-env-tip__link';
    backToMentor.textContent = 'Back to mentor';
    // The desktop stays in view beside the mentor, so the mark stays up.
    backToMentor.addEventListener('click', () => activateTab('mentor'));
    body.append(text, backToMentor);
    if (tour) {
      const nav = document.createElement('div');
      nav.className = 'sim-env-tip__nav';
      const count = document.createElement('span');
      count.textContent = `${tour.index + 1} of ${tour.steps.length}`;
      nav.append(count);
      if (tour.index > 0) {
        const back = document.createElement('button');
        back.type = 'button';
        back.textContent = 'Back';
        back.addEventListener('click', () => showTourStep(tour.index - 1));
        nav.append(back);
      }
      const last = tour.index === tour.steps.length - 1;
      const next = document.createElement('button');
      next.type = 'button';
      next.textContent = last ? 'Done' : 'Next';
      next.addEventListener('click', () => (last ? clearEnvironmentMark('done') : showTourStep(tour.index + 1)));
      nav.append(next);
      body.append(nav);
    }
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'sim-env-tip__close';
    close.textContent = '×';
    close.setAttribute('aria-label', 'Close');
    close.addEventListener('click', () => clearEnvironmentMark('closed'));
    caption.append(body, close);
    if (spot) {
      const mark = document.createElement('div');
      mark.className = region ? 'sim-env-mark sim-env-mark--region' : 'sim-env-mark';
      if (region) {
        mark.style.width = `${(region.fw * 100).toFixed(2)}%`;
        mark.style.height = `${(region.fh * 100).toFixed(2)}%`;
      }
      placeOnScreen(mark, spot.fx, spot.fy);
      caption.classList.add('sim-env-tip--at-spot');
      placeOnScreen(caption, spot.fx, region ? spot.fy + region.fh : spot.fy);
    } else {
      $envCanvas.appendChild(caption);
    }
  }

  function showTourStep(index) {
    if (!envTour) return;
    envTour.index = index;
    drawEnvironmentMark(envTour.steps[index], envTour);
  }

  const MAX_TOUR_STEPS = 10;
  const MARK_FIELDS = ['note', 'x', 'y', 'width', 'height'];

  // `requestId` is the request's envelope id, which host.environment.tourEnded echoes.
  function showFakeEnvironmentMark(p, requestId) {
    const size = { screenshotWidth: p.screenshotWidth, screenshotHeight: p.screenshotHeight };
    if (p.steps !== undefined) {
      if (MARK_FIELDS.some((f) => p[f] !== undefined && p[f] !== null)) {
        return { ok: false, reason: 'failed', message: 'Give steps or a single mark, not both.' };
      }
      if (!Array.isArray(p.steps) || p.steps.length < 1 || p.steps.length > MAX_TOUR_STEPS) {
        return { ok: false, reason: 'failed', message: `steps must be an array of 1 to ${MAX_TOUR_STEPS} marks.` };
      }
      const steps = [];
      for (const [i, step] of p.steps.entries()) {
        const checked = checkEnvironmentMark(step && typeof step === 'object' ? step : {}, size);
        if (checked.failure) {
          return checked.failure.reason === 'stale'
            ? checked.failure
            : { ...checked.failure, message: `Step ${i + 1}: ${checked.failure.message}` };
        }
        steps.push(checked);
      }
      clearEnvironmentMark('replaced');
      envTour = { requestId: requestId || null, steps, index: 0 };
      showTourStep(0);
      return { ok: true, reason: null, message: null };
    }
    const checked = checkEnvironmentMark(p, size);
    if (checked.failure) return checked.failure;
    clearEnvironmentMark('replaced');
    drawEnvironmentMark(checked, null);
    return { ok: true, reason: null, message: null };
  }

  // The student using the console clears a single mark, as on a real host.
  // A tour stays, since its steps often ask them to click something.
  $envCanvas.addEventListener('pointerdown', (e) => {
    noteScreenChange();
    if (!envTour && !e.target.closest('.sim-env-tip')) clearEnvironmentMark();
  });

  // Picks the endpoint a command runs through, as a real host does. Any
  // endpoint open to the agent works, hidden from learners or not.
  function resolveCommandEndpoint(machineAlias, endpointAlias) {
    const target = LAB_MACHINES.find((m) => m.alias === machineAlias);
    if (!target) return refusal('failed', `There is no virtual machine with the alias '${machineAlias}'.`);
    if (endpointAlias) {
      const endpoint = target.endpoints.find((e) => e.alias === endpointAlias);
      if (!endpoint) return refusal('failed', `There is no endpoint with the alias '${endpointAlias}' on '${machineAlias}'.`);
      if (!endpoint.agentAccessible) return refusal('failed', `The endpoint '${endpointAlias}' on '${machineAlias}' isn't open to the Lab Agent.`);
      return { ok: true, endpoint: endpointAlias };
    }
    const usable = target.endpoints.filter((e) => e.agentAccessible);
    if (usable.length === 1) return { ok: true, endpoint: usable[0].alias };
    if (usable.length > 1) return refusal('failed', `'${machineAlias}' has several endpoints the Lab Agent can use; name one.`);
    return refusal('failed', `'${machineAlias}' has no endpoint open to the Lab Agent.`);
  }

  function produceFakeCommandResult(command, machine) {
    if (!command.trim()) {
      return { ok: false, stdout: '', stderr: '', exitCode: null, reason: 'failed', message: 'Empty command.' };
    }
    const stdout = /whoami/.test(command) ? 'student\n'
      : /hostname/.test(command) ? `${machine}\n`
      : `(simulated on ${machine}) ${command}\n`;
    return { ok: true, stdout, stderr: '', exitCode: 0, reason: null, message: null };
  }

  // --- Fake screenshot generator -------------------------------------------
  //
  // We don't have a real VM to capture in the simulator, so we draw a
  // representative PNG on a hidden canvas and return its data URL. The
  // image surfaces enough state (lab title, page, timestamp) that each
  // capture looks meaningfully different - useful for end-to-end demos.
  //
  // To exercise the failure paths from the spec's `reason` enum, set
  // window.__simulatedScreenshotFailure to one of "not_supported",
  // "not_available", "capture_failed" before triggering a capture. The
  // simulator returns the matching {ok:false, reason} payload instead of
  // generating an image. (Non-spec, internal-test affordance.) Applies to
  // both environment and lab-client screenshots.
  //
  // `kind`: "environment" draws a mock VM desktop with terminal output;
  //         "labClient" draws the lab-client chrome (instructions pane +
  //         title bar + environment area) so the two screenshots look
  //         visually distinct in demos.
  function produceFakeScreenshot(kind, area = null) {
    const forced = window.__simulatedScreenshotFailure;
    if (forced) {
      return {
        ok: false,
        data_url: null,
        reason: forced,
        message: `Simulated failure: window.__simulatedScreenshotFailure = "${forced}".`,
      };
    }

    try {
      return kind === 'labClient'
        ? drawLabClientCapture()
        : drawEnvironmentCapture(area);
    } catch (e) {
      return {
        ok: false,
        data_url: null,
        reason: 'capture_failed',
        message: String(e?.message || e),
      };
    }
  }

  function drawEnvironmentCapture(area) {
    const canvas = document.createElement('canvas');
    canvas.width = ENV_CAPTURE_WIDTH;
    canvas.height = ENV_CAPTURE_HEIGHT;
    const ctx2d = canvas.getContext('2d');

    // Background (VM desktop)
    ctx2d.fillStyle = '#1f2933';
    ctx2d.fillRect(0, 0, canvas.width, canvas.height);

    // Faux taskbar stripe
    ctx2d.fillStyle = '#0f172a';
    ctx2d.fillRect(0, canvas.height - 36, canvas.width, 36);

    // Heading
    ctx2d.fillStyle = '#e2e8f0';
    ctx2d.font = '600 22px Inter, system-ui, sans-serif';
    ctx2d.fillText('Lab Environment - simulated capture', 28, 48);

    // Lab + page lines
    ctx2d.font = '500 16px Inter, system-ui, sans-serif';
    ctx2d.fillStyle = '#94a3b8';
    const ctx = currentContext();
    [
      `Lab: ${ctx.labTitle ?? '(untitled)'}`,
      `Page ${(ctx.currentPageIndex ?? 0) + 1} of ${ctx.totalPages ?? '?'} - ${ctx.pageTitle ?? '(no heading)'}`,
      `Captured: ${new Date().toLocaleString()}`,
    ].forEach((line, i) => ctx2d.fillText(line, 28, 84 + i * 24));

    // Mock terminal
    ctx2d.fillStyle = '#0b1220';
    ctx2d.fillRect(28, 180, canvas.width - 56, 240);
    ctx2d.fillStyle = '#22c55e';
    ctx2d.font = '500 14px JetBrains Mono, ui-monospace, monospace';
    ctx2d.fillText('PS C:\\Users\\student>', 44, 210);
    ctx2d.fillStyle = '#cbd5e1';
    ctx2d.fillText('Get-ChildItem -Force', 200, 210);
    ctx2d.fillStyle = '#94a3b8';
    [
      '    Directory: C:\\Users\\student',
      '',
      'Mode    LastWriteTime         Length Name',
      '----    -------------         ------ ----',
      'd----   2026-04-30 10:15             Desktop',
      'd----   2026-04-30 10:15             Documents',
      'd----   2026-04-30 10:15             Downloads',
      '-a---   2026-04-30 10:42         15  hello.txt',
    ].forEach((line, i) => ctx2d.fillText(line, 44, 240 + i * 18));

    let shown = canvas;
    if (area) {
      shown = document.createElement('canvas');
      shown.width = area.width;
      shown.height = area.height;
      shown.getContext('2d').drawImage(canvas, area.x, area.y, area.width, area.height, 0, 0, area.width, area.height);
    }
    return {
      ok: true,
      data_url: shown.toDataURL('image/png'),
      reason: null,
      message: null,
    };
  }

  function drawLabClientCapture() {
    // Larger canvas - we're depicting the whole lab-client UI, not just
    // the environment. Title bar across the top, instructions pane on
    // the left, environment area on the right.
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 600;
    const ctx2d = canvas.getContext('2d');
    const ctx = currentContext();

    // App background
    ctx2d.fillStyle = '#f7f8fa';
    ctx2d.fillRect(0, 0, canvas.width, canvas.height);

    // Title bar
    ctx2d.fillStyle = '#1f2933';
    ctx2d.fillRect(0, 0, canvas.width, 48);
    ctx2d.fillStyle = '#ffffff';
    ctx2d.font = '600 16px Inter, system-ui, sans-serif';
    ctx2d.fillText('Skillable Lab Client - simulated capture', 18, 30);
    ctx2d.fillStyle = '#94a3b8';
    ctx2d.font = '500 13px Inter, system-ui, sans-serif';
    ctx2d.fillText(new Date().toLocaleString(), canvas.width - 220, 30);

    // Instructions pane (left ~40%)
    const paneRight = 410;
    ctx2d.fillStyle = '#ffffff';
    ctx2d.fillRect(0, 48, paneRight, canvas.height - 48);
    ctx2d.fillStyle = '#e2e8f0';
    ctx2d.fillRect(paneRight - 1, 48, 1, canvas.height - 48);

    // Instructions tab strip
    ctx2d.fillStyle = '#212121';
    ctx2d.font = '600 14px Inter, system-ui, sans-serif';
    ctx2d.fillText('Instructions', 24, 78);
    ctx2d.fillStyle = '#94a3b8';
    ctx2d.fillText('Resources', 132, 78);
    ctx2d.fillText('Lab Agent', 220, 78);
    ctx2d.fillStyle = '#008750';
    ctx2d.fillRect(24, 88, 80, 2);

    // Instructions content
    ctx2d.fillStyle = '#94a3b8';
    ctx2d.font = '500 11px Inter, system-ui, sans-serif';
    ctx2d.fillText(`Page ${(ctx.currentPageIndex ?? 0) + 1} of ${ctx.totalPages ?? '?'}`, 24, 116);

    ctx2d.fillStyle = '#212121';
    ctx2d.font = '600 18px Lora, Georgia, serif';
    ctx2d.fillText(ctx.pageTitle ?? '(no page title)', 24, 144);

    ctx2d.font = '400 13px Inter, system-ui, sans-serif';
    ctx2d.fillStyle = '#495057';
    const bodySample = [
      'Use the active terminal in the lab environment',
      'to run the following command and observe the',
      'output:',
      '',
      '    Get-ChildItem -Force',
      '',
      'You should see Desktop, Documents, and Downloads',
      'folders listed alongside any hidden items.',
    ];
    bodySample.forEach((line, i) => ctx2d.fillText(line, 24, 178 + i * 20));

    // Environment area (right ~60%) with embedded mock VM
    const envLeft = paneRight + 24;
    const envRight = canvas.width - 24;
    const envTop = 80;
    const envBottom = canvas.height - 24;
    ctx2d.fillStyle = '#0f172a';
    ctx2d.fillRect(envLeft, envTop, envRight - envLeft, envBottom - envTop);

    ctx2d.fillStyle = '#e2e8f0';
    ctx2d.font = '500 12px Inter, system-ui, sans-serif';
    ctx2d.fillText('Active VM: windows-11 / student', envLeft + 12, envTop + 22);

    ctx2d.fillStyle = '#22c55e';
    ctx2d.font = '500 13px JetBrains Mono, ui-monospace, monospace';
    ctx2d.fillText('PS C:\\Users\\student>', envLeft + 12, envTop + 56);
    ctx2d.fillStyle = '#cbd5e1';
    ctx2d.fillText('Get-ChildItem -Force', envLeft + 168, envTop + 56);
    ctx2d.fillStyle = '#94a3b8';
    [
      '    Directory: C:\\Users\\student',
      '',
      'Mode    LastWriteTime         Length Name',
      '----    -------------         ------ ----',
      'd----   2026-04-30 10:15             Desktop',
      'd----   2026-04-30 10:15             Documents',
      'd----   2026-04-30 10:15             Downloads',
      '-a---   2026-04-30 10:42         15  hello.txt',
    ].forEach((line, i) => ctx2d.fillText(line, envLeft + 12, envTop + 86 + i * 18));

    return {
      ok: true,
      data_url: canvas.toDataURL('image/png'),
      reason: null,
      message: null,
    };
  }

  // Build the labInstructions response payload from the simulator's static
  // page list. Title is the page's first H1/H2 heading (extractPageHeading);
  // null when the page has no heading. Instructions is the raw markdown.
  function produceLabInstructions() {
    return {
      pages: lab.pages.map((md, i) => ({
        index: i,
        title: extractPageHeading(md),
        instructions: md,
      })),
    };
  }

  // Random environment-connection-quality reading. The latency is uniformly
  // distributed across [0, 600] and mapped to the spec's quality enum:
  //   Excellent <= 100, Good <= 250, OK <= 500, Poor > 500.
  //
  // For deterministic testing, set window.__simulatedConnectionLatency to a
  // number - that exact latency is used (still mapped to the corresponding
  // quality). Set window.__simulatedConnectionFailure to a value to suppress
  // the response entirely (lets you exercise the iframe's timeout path).
  function produceFakeConnectionQuality() {
    if (window.__simulatedConnectionFailure) {
      // Sleep this branch - the iframe will time out client-side. We model
      // "host stopped responding" by simply not posting back. The caller
      // already invokes us synchronously, but we can't actually block the
      // post here - so for the demo, return a payload with extreme latency
      // that maps to Poor. A real "no response" scenario is exercised by
      // editing the request handler to skip the post.
      return { latencyMilliseconds: 9999, quality: 'Poor' };
    }
    const forced = window.__simulatedConnectionLatency;
    const latencyMilliseconds = Number.isFinite(forced)
      ? Math.max(0, Math.round(forced))
      : Math.floor(Math.random() * 601); // 0..600 inclusive
    const quality =
      latencyMilliseconds <= 100 ? 'Excellent' :
      latencyMilliseconds <= 250 ? 'Good' :
      latencyMilliseconds <= 500 ? 'OK' :
      'Poor';
    return { latencyMilliseconds, quality };
  }

  // Turns the page. Only show brings the instructions into view, as a real host does.
  function gotoInstructionsPage(index, show) {
    if (typeof index !== 'number' || index < 0 || index >= lab.pages.length) return;
    currentPageIndex = index;
    renderCurrentPage();
    if (show) activateTab('instructions');
    post(OUT.CONTEXT_UPDATE, { context: currentContext() });
  }
  function showEnvToast(text) {
    noteScreenChange();
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
    startLearnerMessage();
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

  // --- Settings: Color Mode - flips theme + posts host.session.theme --------
  // The color mode, with this page's primary and text colors for it, as the
  // Skillable lab sends them.
  function currentThemePayload() {
    const style = getComputedStyle(document.documentElement);
    return {
      theme: document.documentElement.getAttribute('data-theme') || 'light',
      primaryColor: style.getPropertyValue('--primary-main').trim() || null,
      textColor: style.getPropertyValue('--text-primary').trim() || null,
    };
  }

  function applyColorMode(mode) {
    document.documentElement.setAttribute('data-theme', mode);
    if (mentorLoaded) post(OUT.THEME_CHANGE, currentThemePayload());
  }
  $colorMode.addEventListener('change', (e) => applyColorMode(e.target.value));
  // Initialize dropdown from whatever the page booted with
  $colorMode.value = document.documentElement.getAttribute('data-theme') || 'light';

  // --- Settings: Lab Agent policy ------------------------------------------
  const $policy = $('agent-policy');
  if ($policy) {
    $policy.value = policyName();
    $policy.addEventListener('change', (e) => {
      try { localStorage.setItem(POLICY_KEY, e.target.value); } catch { /* best effort */ }
      window.location.reload();
    });
  }

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
