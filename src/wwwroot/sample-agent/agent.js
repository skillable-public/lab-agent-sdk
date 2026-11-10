// agent.js: a small Lab Agent in mentor mode, in plain JavaScript.
//
// It implements the protocol's core (docs/spec/core.md) and a little of mentor
// mode (docs/spec/mentor.md): the handshake, the session, theme and context
// updates, a chat with scripted replies, a console screenshot when the host
// allows one, a key press that asks the learner first, and plain answers to
// refusals. A real agent would send the chat to a model through its backend.

(function () {
  'use strict';

  const VERSION = 2;
  const SOURCE = 'lab-agent';
  // The hosts this agent accepts messages from. Replace the localhost entries with
  // the staging origins you are given at onboarding.
  const HOST_ORIGINS = new Set([
    'https://labclient.labondemand.com',
    'https://labclient.skillable.com',
    'http://localhost:7080', 'https://localhost:7080',
    'http://127.0.0.1:7080', 'https://127.0.0.1:7080',
  ]);
  const INIT_WAIT_MS = 10000;
  const REQUEST_TIMEOUT_MS = 30000;
  const SCREENSHOT_PREFIX = /^data:image\/(png|jpeg|webp);base64,/;
  const SCREENSHOT_MAX_CHARS = 14 * 1024 * 1024; // about 10 MB decoded

  const $messages = document.getElementById('messages');
  const $form = document.getElementById('composer');
  const $input = document.getElementById('input');
  const $screenshot = document.getElementById('btn-screenshot');
  const $keys = document.getElementById('btn-keys');
  const $status = document.getElementById('status');

  let hostOrigin = null;
  let capabilities = [];
  let agent = null; // host.session.init.agent
  let context = {};
  let sessionId = null;
  let nextId = 1;
  const pending = new Map();

  // --- Posting and requests ------------------------------------------------

  function post(type, payload, id) {
    if (!hostOrigin) return;
    const msg = { source: SOURCE, version: VERSION, type, payload: payload || {} };
    if (id) msg.id = id;
    window.parent.postMessage(msg, hostOrigin);
  }

  // Sends a request and resolves with its response's payload, or a refusal of our own on timeout.
  function request(type, payload, timeoutMs = REQUEST_TIMEOUT_MS) {
    const id = `req-${nextId++}`;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        resolve({ ok: false, reason: 'timeout', message: 'The lab did not answer in time.' });
      }, timeoutMs);
      pending.set(id, (answer) => { clearTimeout(timer); resolve(answer); });
      post(type, payload, id);
    });
  }

  const can = (responseType) => capabilities.includes(responseType);

  // --- Chat ----------------------------------------------------------------

  function addMessage(role, text, image) {
    const item = document.createElement('li');
    item.className = `msg msg--${role}`;
    item.textContent = text; // host and user text is never HTML
    if (image) {
      const img = document.createElement('img');
      img.src = image;
      img.alt = 'Screenshot of the lab console';
      item.appendChild(img);
    }
    $messages.appendChild(item);
    item.scrollIntoView({ block: 'end' });
    return { id: `m-${nextId++}`, role, content: text, createdAt: new Date().toISOString() };
  }

  function reply(text, image) {
    post('agent.session.reply', { message: addMessage('agent', text, image) });
  }

  // What to tell the learner about a refusal, by its reason (core.md section 9.2).
  function explain(answer, what) {
    switch (answer.reason) {
      case 'asking': return `I need your permission to ${what}. Answer the question on the console.`;
      case 'declined': return `OK, I won't ${what} for now. Tell me if you'd like me to walk you through it instead.`;
      case 'not_allowed': return `This lab doesn't let me ${what}. ${answer.message || ''}`.trim();
      case 'not_available': return `I can't ${what} right now. Is a console selected and connected?`;
      case 'not_supported': return `I can't ${what} in this lab.`;
      case 'timeout': return `The lab didn't answer when I tried to ${what}.`;
      default: return `I couldn't ${what}. ${answer.message || ''}`.trim();
    }
  }

  async function takeScreenshot() {
    const answer = await request('agent.environment.screenshot.request');
    if (!answer.ok) {
      reply(explain(answer, 'look at your console'));
      return;
    }
    const url = typeof answer.data_url === 'string' ? answer.data_url : '';
    if (!SCREENSHOT_PREFIX.test(url) || url.length > SCREENSHOT_MAX_CHARS) {
      reply('The lab sent a screenshot I could not use.');
      return;
    }
    reply('Here is your console as I see it.', url);
  }

  async function openRunDialog() {
    reply('I will press Win+R to open the Run dialog.');
    let answer = await request('agent.environment.keys.request', { keys: 'Win+R' });
    // While the host asks the learner, retry for a minute: a new learner message would start over.
    if (answer.reason === 'asking') reply(explain(answer, 'press keys in your console'));
    for (let tries = 0; answer.reason === 'asking' && tries < 30; tries++) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      answer = await request('agent.environment.keys.request', { keys: 'Win+R' });
    }
    reply(answer.ok ? 'Done. The Run dialog should be open now.' : explain(answer, 'press keys in your console'));
  }

  // Scripted replies: a real agent would ask its model, with the lab context and
  // the organization's and lab's prompts from host.session.init.agent.prompts.
  function answer(text) {
    const lower = text.toLowerCase();
    if (/screen|see|look/.test(lower) && can('host.environment.screenshot.response')) return takeScreenshot();
    if (/run dialog|win\+r/.test(lower) && can('host.environment.keys.response')) return openRunDialog();
    if (/page|where|step/.test(lower) && context.totalPages) {
      const title = context.pageTitle || `Page ${context.currentPageIndex + 1}`;
      return reply(`You are on "${title}", page ${context.currentPageIndex + 1} of ${context.totalPages}.`);
    }
    return reply(`I'm a sample agent with scripted replies. Try "what page am I on", "look at my screen" or "open the run dialog".`);
  }

  function onUserMessage(text) {
    post('agent.session.messageSent', { message: addMessage('user', text) });
    answer(text);
  }

  $form.addEventListener('submit', (event) => {
    event.preventDefault();
    const text = $input.value.trim();
    if (!text) return;
    $input.value = '';
    onUserMessage(text);
  });
  $screenshot.addEventListener('click', () => onUserMessage('Look at my screen.'));
  $keys.addEventListener('click', () => onUserMessage('Open the Run dialog.'));

  // --- Host messages -------------------------------------------------------

  function applyTheme({ theme, primaryColor, textColor }) {
    const root = document.documentElement;
    root.setAttribute('data-theme', ['light', 'dark', 'highcontrast'].includes(theme) ? theme : 'light');
    for (const [token, value] of [['--primary-main', primaryColor], ['--text-primary', textColor]]) {
      if (typeof value === 'string' && value) root.style.setProperty(token, value); else root.style.removeProperty(token);
    }
  }

  // Shows only the actions the host will answer, as the capabilities say.
  function applyCapabilities(list) {
    capabilities = Array.isArray(list) ? list : [];
    $screenshot.hidden = !can('host.environment.screenshot.response');
    $keys.hidden = !can('host.environment.keys.response');
  }

  function randomSessionId() {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  }

  // Resolves the session once: resume the host's id, or mint a fresh one. A real
  // agent's backend checks that a resumed id belongs to this user and lab instance.
  function openSession(resumeId) {
    if (sessionId) return;
    const resumed = typeof resumeId === 'string' && resumeId.length > 0 && resumeId.length <= 128;
    sessionId = resumed ? resumeId : randomSessionId();
    post('agent.session.opened', { sessionId, kind: resumed ? 'resumed' : 'started' });
  }

  function onInit(p) {
    applyTheme(p);
    applyCapabilities(p.capabilities);
    agent = p.agent || null;
    context = p.labContext || {};
    openSession(p.sessionId);
    const name = p.userName ? `, ${p.userName}` : '';
    const lab = context.labTitle ? ` to ${context.labTitle}` : '';
    $status.textContent = agent ? `Mode: ${agent.mode}` : 'Connected';
    reply(`Welcome${lab}${name}. I'm the sample Lab Agent. Ask me where you are, or to look at your screen.`);
  }

  function onMessage(msg) {
    const p = msg.payload || {};
    if (msg.id && pending.has(msg.id) && msg.type.endsWith('.response')) {
      const settle = pending.get(msg.id);
      pending.delete(msg.id);
      settle(p);
      return;
    }
    switch (msg.type) {
      case 'host.session.init': onInit(p); break;
      case 'host.session.context':
        // Machines and tokens come only now and then: carry the last ones forward.
        context = { ...context, ...(p.context || {}) };
        if (p.capabilities) applyCapabilities(p.capabilities);
        if (p.agent) agent = p.agent;
        break;
      case 'host.session.theme': applyTheme(p); break;
      case 'host.session.locale': document.documentElement.lang = p.locale || 'en'; break;
      case 'host.session.hint':
        reply(context.pageTitle ? `Stuck on "${context.pageTitle}"? Read the step again, then tell me what you see.` : 'Tell me what you are trying to do, and what you see.');
        break;
      case 'host.session.sendMessage': if (typeof p.content === 'string') onUserMessage(p.content); break;
      case 'host.session.authRefresh': break; // a real agent hands the new token to its backend
      default: break; // ignore what we don't know
    }
  }

  window.addEventListener('message', (event) => {
    if (!HOST_ORIGINS.has(event.origin) || event.source !== window.parent) return;
    const msg = event.data;
    if (!msg || msg.source !== 'lab-host' || msg.version !== VERSION || typeof msg.type !== 'string') return;
    hostOrigin ??= event.origin; // pin the host's origin to its first valid message
    if (event.origin !== hostOrigin) return;
    onMessage(msg);
  });

  // The handshake. Its payload holds nothing secret, so it alone goes to '*'.
  applyCapabilities([]);
  if (window.parent !== window) {
    window.parent.postMessage({ source: SOURCE, version: VERSION, type: 'agent.session.ready', payload: { modes: ['mentor'] } }, '*');
  }
  // With no host, or no answer, the agent still works, without lab context.
  setTimeout(() => {
    if (sessionId) return;
    $status.textContent = 'No lab';
    sessionId = randomSessionId();
    reply("I'm the sample Lab Agent, running without a lab, so I can only chat.");
  }, window.parent !== window ? INIT_WAIT_MS : 0);
})();
