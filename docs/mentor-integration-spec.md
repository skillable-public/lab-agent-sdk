# AI Chat Mentor Integration Spec

> **Audience:** developers building an AI Chat Mentor application that will
> be embedded inside the **Skillable hands-on lab platform**. You may already
> have a mentor product and are wiring it up for the first time, or you may
> be building one from scratch. Either way, this document is the full,
> authoritative specification of the integration surface — you need nothing
> else from Skillable to implement against it.

This spec covers:

- the architecture you're joining,
- the iframe embedding model and the URL parameters the lab passes you,
- the `postMessage` contract between the lab (host) and your mentor
  (iframe), including required vs. optional messages,
- origin / security expectations,
- authentication guidance (what the protocol carries and what it doesn't),
- forward compatibility and versioning.

---

## 1. Overview

The Skillable lab platform runs hands-on labs — a student gets a live
environment (a VM, a web app, a terminal) alongside a sidebar with tabs
such as **Instructions**, **Resources**, and **Mentor**. Your application
is embedded as an `<iframe>` inside the Mentor tab.

All communication between your iframe and the surrounding lab page flows
through HTML5 `window.postMessage`. Your code and Skillable's code run in
separate browser origins and cannot reach into each other's DOM.

Your mentor app is otherwise free-standing. You own your UI, your backend
(LLM, session store, tracing, whatever), and your deployment. Skillable
does not talk to your backend directly and has no visibility into it.
The only integration surface you must implement is the postMessage
contract defined in this document.

### What the Skillable lab platform does for you

- Embeds your iframe at the right time, with the URL parameters you need
  (parent origin, theme, user identity hints).
- Sends lab context to your iframe: which lab, which instructions page
  the student is on, facts about the environment (OS, shell, cwd, etc.).
- Honors your requests to paste text into the lab environment and
  navigate to specific instructions pages — if it supports them.
- Cleans up the iframe when the lab session ends.

### What you are responsible for

- Hosting your chat UI over HTTPS with a publicly-trusted certificate.
- Optionally, a backend API of your own. Skillable doesn't talk to it.
- Implementing the **Required** parts of the postMessage contract.
- Validating the origin of every inbound message, and posting outbound
  messages to the exact parent origin (never `"*"` in production).
- Degrading gracefully if the lab sends nothing — a bare iframe load
  should still produce a usable, context-free mentor.

---

## 2. Architecture

```
  +----------------------- lab page (parent origin) ------------------------+
  |                                                                         |
  |   [   live environment (VM / web app / terminal)   ]                    |
  |                                                                         |
  |   [ sidebar ]                                                           |
  |     Instructions | Resources | Mentor                                   |
  |                                   |                                     |
  |                                   v                                     |
  |                        +-----------------------+                        |
  |                        |  <iframe src=...>    |                        |
  |                        |                      |                        |
  |                        |   YOUR mentor UI     |                        |
  |                        |                      |                        |
  |                        |   JS   <->  your     |                        |
  |                        |             backend  |                        |
  |                        +-----------------------+                        |
  |                              ^              |                           |
  |                              |  postMessage |                           |
  +------------------------------v--------------+---------------------------+
```

Three trust boundaries:

1. The lab page and your iframe are in **different browser origins**. The
   only cross-boundary channel is `window.postMessage`.
2. If your iframe talks to your own backend, that is entirely your
   concern — Skillable has no visibility into it.
3. The Skillable lab has a backend of its own. Your iframe does not
   interact with it directly.

---

## 3. Embedding model

Skillable will load your app into an `<iframe>` along these lines:

```html
<iframe
  src="https://your-mentor.example.com/?parentOrigin=https://lab.skillable.com&theme=light"
  sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
  title="AI Mentor"
></iframe>
```

You do not control the iframe tag. You control only what you serve at
the URL and how you behave once loaded.

### 3.1 URL parameters you may receive

| Param          | Type                 | Meaning |
|----------------|----------------------|---------|
| `parentOrigin` | string               | The exact origin of the lab page. Use this to validate inbound `postMessage` sources and to target your outbound posts. |
| `theme`        | `"light"` \| `"dark"`| Initial theme. Light is the default if absent. |
| `locale`       | string               | BCP-47 locale tag, e.g. `en-US`. |
| `userId`       | string               | Opaque user identifier at Skillable's discretion. Not guaranteed to be stable across sessions. Identity hint only — **not a credential**. |

Session continuity (resume after refresh, save/resume, etc.) does **not**
travel through URL parameters — it travels through the postMessage
handshake. See [Section 6 — Handshake](#6-handshake-required) and the
`mentor.session.opened` / `host.init.labInstanceId` fields.

Your app may be embedded with **zero** parameters — never require any.
Pick sensible defaults (light theme, `en` locale, fresh session).

### 3.2 Authentication

The postMessage contract does **not** carry credentials. `userId` is an
identity hint for personalization, not an authentication token.

If your backend needs to authenticate calls from Skillable (or from your
own iframe), arrange that out-of-band during onboarding:

- API keys you issue to Skillable, attached as HTTP headers on requests
  from the iframe;
- IP allowlisting if your infrastructure supports it;
- mTLS;
- signed request headers — whatever fits your stack.

Tell the Skillable integration team what your backend expects, and they
will configure the lab to provide it. None of that plumbing shows up in
the postMessage channel.

### 3.3 Origin security

Both sides of the protocol MUST restrict traffic by origin.

In your iframe:

```js
const allowedOrigin = new URL(window.location.href)
  .searchParams.get('parentOrigin');

window.addEventListener('message', (event) => {
  if (allowedOrigin && event.origin !== allowedOrigin) return;
  const msg = event.data;
  if (!msg || msg.source !== 'lab-host' || msg.version !== 1) return;
  // ... dispatch on msg.type
});
```

When you post back:

```js
window.parent.postMessage(outgoing, allowedOrigin || '*');
```

Passing `"*"` is acceptable only during local development. In
production always use the specific `parentOrigin` value.

### 3.4 HTTPS and mixed content

The lab runs over HTTPS. Serve your iframe over HTTPS as well — browsers
will block mixed-content loads and your iframe will not appear.

### 3.5 Sandboxing

Skillable applies a `sandbox` attribute of roughly
`allow-scripts allow-same-origin allow-forms allow-popups`. `allow-popups`
is present so your iframe can open external links itself (via
`window.open(url)` or an `<a target="_blank">` in rendered chat content);
there is no protocol message for "open a URL in a new tab" — render a
normal anchor and let the student click it.

Do not design features that require `allow-top-navigation`,
`allow-popups-to-escape-sandbox`, or other high-risk flags — Skillable
will not grant them.

### 3.6 Content Security Policy

If your iframe sets a CSP, allow the Skillable lab origin in
`frame-ancestors` (otherwise the browser will refuse to embed you).
Allow your own backend origin in `connect-src`.

---

## 4. Message envelope

Every message in either direction is a JSON object with this shape:

```jsonc
{
  "source":  "lab-host" | "mentor-chat",   // who is sending
  "version": 1,                              // protocol version
  "type":    "<message-type>",               // see sections 7-8
  "id":      "<optional correlation id>",
  "payload": { /* type-specific */ }
}
```

Rejection rules (both sides):

- Messages whose `source` does not match the expected peer are dropped
  (Skillable only accepts `mentor-chat`; your iframe only accepts
  `lab-host`).
- Messages whose `version` is not `1` are dropped.
- Messages from unexpected origins are dropped.

**Forward compatibility:** receivers must ignore unknown `type` values
and unknown `payload` fields rather than erroring. See section 14.

---

## 5. Conformance

Each message in this spec is labeled one of:

- **Required** — the receiver must handle it. Omitting a handler causes
  observable feature loss (no handshake, no lab grounding).
- **Optional** — the sender emits it only when relevant, and the
  receiver may safely ignore it. A minimal integration can handle only
  the required messages; everything else is a hook for richer UX.

Even Required messages are only required for *grounded* operation. Your
mentor must still load and run when the lab sends nothing, producing
context-free generic responses.

---

## 6. Handshake (required)

```
  iframe -> host : mentor.ready          (handshake; no session yet)
  host  -> iframe: host.init             (may carry labInstanceId, sessionId)
  iframe -> host : mentor.session.opened  (the active sessionId)
```

1. On load, your iframe attaches its `message` listener and posts
   `mentor.ready`. This is a pure handshake — **do not** put a
   sessionId on it.
2. The lab responds with `host.init`. Among other things, it MAY include:
   - `labInstanceId` — a stable id for the student's current lab
     attempt (see [Resume across reloads](#resume-across-reloads));
   - `sessionId` — a chat session id the host previously persisted
     (i.e., one your iframe announced on a prior `mentor.session.opened`).
3. Your iframe resolves the active session (resume / mirror / mint —
   see priority below), then posts `mentor.session.opened` with that id
   in the payload, exactly once.
4. From then on you may send any of the `mentor.*` messages and the lab
   may send any of the `host.*` messages.

If the lab never sends `host.init`, your mentor should still work — fall
back to a fresh session (no resume, no labInstanceId scoping) and fire
`mentor.session.opened` against that id.

### Resolving the active sessionId

The iframe is the authoritative *announcer* of the sessionId; how it
arrives at one is an implementation choice. Recommended priority:

1. **Resume.** If `host.init.sessionId` is present and your backend
   recognizes it, use it. This is the normal path after the first load.
2. **Mirror or look up.** If `host.init.labInstanceId` is present but
   no `sessionId`, you MAY mirror `labInstanceId` directly as your
   sessionId, derive an id from it, or use it as a key into your own
   session storage. Whatever fits your backend.
3. **Mint.** Otherwise, generate a fresh id.

In every case, you announce the result via `mentor.session.opened` so
the host can persist it.

### Resume across reloads

The host's job is to *round-trip* the chat's announced sessionId so the
same conversation picks back up after a refresh, lab save/resume, or
any other re-mount of the iframe. The mechanism is entirely over
postMessage — there is **no** URL handoff.

- After session resolution, iframe posts
  `mentor.session.opened { sessionId }`.
- Host persists `sessionId`, typically scoped under the
  `labInstanceId` it issued.
- On the next iframe load, host emits `host.init` carrying both
  `labInstanceId` (still the same — same lab attempt) and the stored
  `sessionId`.
- Iframe resumes that id, fires `mentor.session.opened` against it.

This is opt-in on both sides:

- A host that doesn't persist anything sends only `labInstanceId` (or
  nothing). Iframe mints fresh each load. Bound still fires; the host
  ignores it. Conversations don't resume — fine for hosts that don't
  care.
- A host that persists fully sends both fields. Iframe resumes.
- An iframe that doesn't model sessions just doesn't fire
  `mentor.session.opened`. Host has nothing to persist. Also fine.

`labInstanceId` is also useful **outside** session management — it's a
stable handle on the lab attempt that the chat can attach to its own
analytics, logs, transcripts, etc. Treat it as opaque: don't parse it,
don't display it as anything user-facing.

`labInstanceId` is host-supplied data over postMessage. Treat it as a
hint for state lookup and analytics, **not** as an authentication or
authorization signal — same posture we already apply to `userId`.

### Example

Your iframe, on load:

```jsonc
{
  "source": "mentor-chat",
  "version": 1,
  "type": "mentor.ready",
  "payload": {
    "protocolVersion": 1,
    "capabilities": [
      "mentor.gotoInstructionsPage",
      "mentor.sendTextToEnvironment",
      "mentor.message.sent",
      "mentor.response",
      "mentor.session.opened",
      "mentor.environmentScreenshot.request",
      "mentor.error"
    ]
  }
}
```

The `capabilities` array lists every outbound message type your iframe
may produce. Defensive hosts can light up the corresponding UI
affordances and hide others; a minimal host may ignore the array.

The lab, in response:

```jsonc
{
  "source": "lab-host",
  "version": 1,
  "type": "host.init",
  "payload": {
    "labInstanceId": "li_4f3a2b1c",
    "sessionId": "9a3b1c0e7f2d4a8b9c1d2e3f4a5b6c7d",
    "userName": "Corey",
    "userId": "u-8e2c9a",
    "theme": "light",
    "locale": "en",
    "labContext": { /* see LabContext below */ },
    "capabilities": [
      "host.environmentScreenshot.response"
    ]
  }
}
```

Your iframe, after resolving the session:

```jsonc
{
  "source": "mentor-chat",
  "version": 1,
  "type": "mentor.session.opened",
  "payload": {
    "sessionId": "9a3b1c0e7f2d4a8b9c1d2e3f4a5b6c7d",
    "kind": "resumed"
  }
}
```

---

## 7. Messages from host &rarr; iframe

### Summary

| Type                                 | Status    | Purpose |
|--------------------------------------|-----------|---------|
| `host.init`                          | Required  | Handshake; identity, theme, initial context. |
| `host.context.update`                | Optional  | New `LabContext` (page change, env change). |
| `host.hint.request`                  | Optional  | Ask the mentor for a proactive hint. |
| `host.theme.change`                  | Optional  | Theme switched at runtime. |
| `host.locale.change`                 | Optional  | Locale switched at runtime. |
| `host.send.message`                  | Optional  | Inject a user-authored message on the student's behalf. |
| `host.environmentScreenshot.response`| Optional  | Reply to `mentor.environmentScreenshot.request` with image data or a failure reason. |

### `host.init`
**Required.** Sent once after the lab receives `mentor.ready`. If your
iframe receives nothing, carry on with defaults.

| Field            | Type                           | Notes |
|------------------|--------------------------------|-------|
| `labInstanceId`  | string?                        | Stable opaque id for the **student's current lab attempt**. Survives save/resume; not shared across users. Useful as a scope for the host's own session-id storage and for chat-side analytics. Treat as opaque (do not parse) and as a hint, not a credential. See [Resume across reloads](#resume-across-reloads). |
| `sessionId`      | string?                        | A chat session id the host previously persisted from a prior `mentor.session.opened`. The iframe SHOULD prefer this over any other resume channel. Omitted on first connection or if the host doesn't persist sessions. **Maximum 128 characters.** |
| `userName`       | string?                        | Display-name hint. May be anonymized by the lab platform. |
| `userId`         | string?                        | Opaque user id (identity hint, not a credential). |
| `theme`          | `"light"` \| `"dark"`          | Apply immediately. |
| `locale`         | string?                        | BCP-47 locale. |
| `labContext`     | [`LabContext`](#10-labcontext) | Initial grounding. |
| `capabilities`   | string[]?                      | **Response** message types the host fulfills. Used by iframes to gate UI for chat-initiated request/response patterns (e.g., hide the "Get screenshot" button when the host doesn't advertise `host.environmentScreenshot.response`). Host-initiated messages (`host.context.update`, `host.hint.request`, `host.theme.change`, `host.locale.change`, `host.send.message`) are **not** advertised here — the iframe handles them passively when they arrive, so there's no UI to gate. Currently `host.environmentScreenshot.response` is the only entry; the array will grow as the protocol gains more request/response patterns. Iframes should also tolerate the array being absent (missing or empty) by either hiding the corresponding UI or attempting the request and handling failure responses gracefully. |

### `host.context.update`
**Optional.** Push a new `LabContext` snapshot. The lab sends this
whenever the student flips to a new instructions page, the environment
state changes materially, or the lab simply wants the mentor to
re-ground.

| Field      | Type                             |
|------------|----------------------------------|
| `context`  | [`LabContext`](#10-labcontext)   |

### `host.hint.request`
**Optional.** Ask the mentor to produce a proactive hint without the
student having typed anything. Typical trigger: the student clicked an
"I'm stuck" button in the host chrome.

| Field     | Type     | Notes |
|-----------|----------|-------|
| `reason`  | string?  | Free-form reason code, e.g. `"stuck-button"`, `"idle-30s"`. |

### `host.theme.change`
**Optional.** Switch theme at runtime.

| Field    | Type                   |
|----------|------------------------|
| `theme`  | `"light"` \| `"dark"`  |

### `host.locale.change`
**Optional.** Switch locale at runtime.

| Field    | Type     |
|----------|----------|
| `locale` | string   |

### `host.send.message`
**Optional.** Inject a user-authored message into the chat on the
student's behalf. The lab uses this to support UX like "copy this
question into the mentor".

| Field      | Type     |
|------------|----------|
| `content`  | string   |

### `host.environmentScreenshot.response`
**Optional.** Reply to a prior `mentor.environmentScreenshot.request`.
The host correlates request/response by echoing the request's envelope
`id` on the response.

The payload uses `snake_case` field names to match its `snake_case`
`reason` enum values; this is a localized exception to the otherwise
`camelCase` payload convention used elsewhere in the spec, kept this
way so a single payload doesn't mix conventions.

| Field      | Type                  | Notes |
|------------|-----------------------|-------|
| `ok`       | boolean               | `true` iff the host produced image data. |
| `data_url` | string?               | Data URL (`data:image/<format>;base64,…`) when `ok` is `true`; `null`/omitted otherwise. The host picks the mime type — PNG, JPEG, and WebP are all fine. |
| `reason`   | string?               | Machine-readable failure category. `null` on success. See enum below. Receivers must tolerate unknown values. |
| `message`  | string?               | Optional human-readable detail (logging / tooltips). |

`reason` enum (extensible):

- `"not_supported"` — the lab environment cannot produce screen data at all (e.g., a non-VM lab, a remote-controller type without screen-capture support). Steady-state condition; the iframe should consider the capability unavailable for the rest of the session.
- `"not_available"` — the lab supports screen data but cannot produce it right now (e.g., no target selected, no controller, not connected). Transient; retrying later may succeed.
- `"capture_failed"` — the underlying capture call threw. Treat as transient unless it persists.

Hosts that don't implement screenshots at all should omit
`host.environmentScreenshot.response` from their
`host.init.capabilities` array — that hides the iframe's screenshot
affordance entirely. The `not_supported` reason is for hosts that *do*
generally support screenshots but for which this particular lab /
environment can't produce them.

---

## 8. Messages from iframe &rarr; host

### Summary

| Type                            | Status    | Purpose |
|---------------------------------|-----------|---------|
| `mentor.ready`                  | Required  | Announce iframe is loaded and listening. |
| `mentor.session.opened`          | Optional  | Announce the active mentor sessionId for this iframe load. |
| `mentor.gotoInstructionsPage`   | Optional  | Ask the lab to navigate to a specific instructions page. |
| `mentor.sendTextToEnvironment`  | Optional  | Ask the lab to paste text into the lab environment. |
| `mentor.environmentScreenshot.request` | Optional | Ask the lab for a screenshot of the lab environment. Reply via `host.environmentScreenshot.response`. |
| `mentor.message.sent`           | Optional  | Notification: student posted a message. |
| `mentor.response`               | Optional  | Notification: mentor replied. |
| `mentor.error`                  | Optional  | Notification: the iframe failed to do something. |

### `mentor.ready`
**Required.** The iframe is loaded and its message listener is
attached. Send this exactly once, as early as you can (typically right
after your bridge wires up its `message` listener). This is a pure
handshake — no sessionId yet.

| Field               | Type       | Notes |
|---------------------|------------|-------|
| `protocolVersion`   | number     | `1` |
| `capabilities`      | string[]   | Every outbound type your iframe may produce. Hosts may use this to light up corresponding UI affordances. |

### `mentor.session.opened`
**Optional.** Announces the sessionId the iframe has committed to for
this iframe load. Send this exactly once, after the session has been
resolved (resumed, mirrored, or minted — see
[Resolving the active sessionId](#resolving-the-active-sessionid)). The
host SHOULD persist this id, typically scoped under
`host.init.labInstanceId`, so it can be re-supplied as
`host.init.sessionId` on the next iframe load.

The iframe does **not** re-fire `mentor.session.opened` for the same
session later — once announced, the id is fixed for the lifetime of
the iframe. If your backend ever needs to swap to a different
sessionId, treat that as a fresh iframe lifecycle (e.g., reload).

Iframes that don't model sessions can omit this message entirely.

| Field        | Type                                                  | Notes |
|--------------|-------------------------------------------------------|-------|
| `sessionId`  | string                                                | Active mentor session id. Opaque to the host. **Maximum 128 characters** — iframes that mint or mirror longer values must truncate or hash to fit. Hosts SHOULD reject (or at least flag) values longer than this. |
| `kind`       | `"started" \| "resumed" \| "mirrored"` (extensible)   | How this iframe arrived at the sessionId. `"started"` = freshly minted; `"resumed"` = picked up from `host.init.sessionId`; `"mirrored"` = derived from `host.init.labInstanceId`. Hosts that don't care about the distinction can ignore this field. Receivers must tolerate unknown values. |

### `mentor.gotoInstructionsPage`
**Optional.** Ask the lab to navigate to a specific page of
instructions. Equivalent to the student clicking Previous / Next enough
times to land on that page. Your mentor does not need (and should not
assume) any DOM selectors inside the instructions content.

| Field    | Type     | Notes |
|----------|----------|-------|
| `index`  | integer  | **Zero-based** target page index (same frame of reference as `LabContext.currentPageIndex`). Out-of-range values are ignored. |

### `mentor.sendTextToEnvironment`
**Optional.** Ask the lab to paste text into the active lab
environment. This is the canonical mentor-driven side effect (e.g.,
"I'll paste that command for you"). The lab decides where the text goes
(the focused input, the active terminal, etc.); your iframe does not
select a target.

| Field     | Type     | Notes |
|-----------|----------|-------|
| `text`    | string   | Text to paste. |

**Security note.** Skillable is ultimately responsible for what reaches
the environment. Assume the lab will not auto-execute your text but
will paste it for the student to review. Do not use this channel to
attempt to escape the lab.

### `mentor.environmentScreenshot.request`
**Optional.** Ask the lab to capture and return an image of the current
lab environment (a VM screen, a remote-controller framebuffer, etc.).
Typical trigger: the student clicks a "share screenshot" affordance in
the chat composer so the mentor can reason over the visual state.

The host correlates the response by echoing the envelope `id` of this
request on its `host.environmentScreenshot.response`. Always assign an
`id` so concurrent requests don't get mixed up.

This message has no payload fields beyond what's in the envelope;
`payload` may be `{}` or omitted.

Iframes SHOULD only show the screenshot affordance when
`host.environmentScreenshot.response` is present in
`host.init.capabilities`. Iframes SHOULD apply a client-side timeout
(10 seconds is a reasonable default) and surface a failure if no
response arrives.

### `mentor.message.sent`
**Optional.** Notification that the student posted a message. Useful
for host-side unread-badge UX, analytics, or transcript capture. Safe
to ignore.

| Field     | Type                                |
|-----------|-------------------------------------|
| `message` | [`ChatMessage`](#11-chatmessage)    |

### `mentor.response`
**Optional.** Notification that the mentor replied. Same purpose and
payload shape as `mentor.message.sent`.

| Field     | Type                                |
|-----------|-------------------------------------|
| `message` | [`ChatMessage`](#11-chatmessage)    |

### `mentor.error`
**Optional.** Surface a failure to the host (your backend unreachable,
an action failed, etc.). Skillable may render a toast or just log it.

| Field      | Type     | Notes |
|------------|----------|-------|
| `code`     | string   | Short stable code, e.g. `"send_failed"`. |
| `message`  | string   | Human-readable detail. |

---

## 9. Suggesting actions in-chat

When your mentor produces a message that includes a suggested side
effect (e.g. "Paste this command into your terminal" or "Jump back to
the first page"), the recommended pattern is:

1. Render the message plus one or more buttons for the suggested
   actions.
2. If the student clicks a button, your iframe posts the corresponding
   outbound message — `mentor.sendTextToEnvironment`,
   `mentor.gotoInstructionsPage`, etc.
3. The lab decides whether and how to honor it.

This keeps the lab in control of its own DOM and environment; your
iframe never touches them directly.

For static links to external documentation, just render markdown links
in the message body (`[label](https://...)`). The iframe's `sandbox`
includes `allow-popups`, so an `<a target="_blank">` opens in a new tab
without any postMessage involvement.

---

## 10. `LabContext`

The `LabContext` is the central grounding object. You will receive one
in `host.init.payload.labContext` and again in every
`host.context.update`.

The unit of navigation in the lab is a **page** of instructions — what
the Previous / Next controls in the lab chrome flip between. Steps
within a page are a lab-authoring concept and are not modeled here.

| Field              | Type                         | Notes |
|--------------------|------------------------------|-------|
| `labId`            | string?                      | Stable id of the lab. |
| `labTitle`         | string?                      | Human-readable title. |
| `currentPageIndex` | integer?                     | **Zero-based** index of the page the student is on. |
| `totalPages`       | integer?                     | Total number of pages. |
| `pageTitle`        | string?                      | The page's heading text, if it starts with one. When absent, display as `Page {currentPageIndex + 1}`. |
| `pageInstructions` | string?                      | Current page body as **markdown**. Use this to ground mentor responses. |
| `environment`      | `{ [key: string]: string }`? | Free-form facts (OS, shell, cwd, last command, etc.). |

All fields are optional. Build your mentor to degrade gracefully when
any one is missing, and to re-ground on every update.

**Timing note.** Some fields — `environment` in particular — depend on
lab subsystems that may not be ready when the lab fires `host.init`. The
host is expected to send `host.init` eagerly on receipt of `mentor.ready`
with whatever context is available at that moment, and then deliver the
remaining fields via a follow-up `host.context.update` once they
populate. Treat `environment` (and any field) as *may arrive later* — do
not assume the value present in `host.init` is final.

Example:

```jsonc
{
  "labId": "intro-to-linux",
  "labTitle": "Intro to Linux",
  "currentPageIndex": 1,
  "totalPages": 4,
  "pageTitle": "List files in your home directory",
  "pageInstructions": "# List files\n\nRun `ls -la` to see hidden files\u2026",
  "environment": { "os": "ubuntu-22.04", "shell": "bash", "cwd": "/home/student" }
}
```

---

## 11. `ChatMessage`

Payload shape for the optional `mentor.message.sent` and
`mentor.response` notifications.

```jsonc
{
  "id": "string",
  "role": "user" | "mentor",
  "content": "string (markdown allowed)",
  "createdAt": "ISO-8601 UTC",
  "actions": [
    {
      "kind": "sendText" | "gotoInstructionsPage",
      "label": "string",
      "payload": { /* type-specific; maps 1:1 onto the outbound postMessage payload */ }
    }
  ]
}
```

You are free to evolve this internally; Skillable only reads these
notifications when it has opted in, and treats unknown action `kind`s
as inert.

---

## 12. Lifecycle

- **Load.** Skillable mounts your iframe. Your code runs as usual.
- **Ready.** Post `mentor.ready` once as soon as your message listener
  is attached. No sessionId yet — this is a pure handshake.
- **Init.** Skillable replies with `host.init`, optionally carrying
  `labInstanceId` and a previously-persisted `sessionId`.
- **Open.** Resolve the active session (resume / mirror / mint), then
  post `mentor.session.opened` with that id. This is what makes
  refresh + save/resume pick up the same conversation: Skillable
  persists the announced id under your `labInstanceId` and re-supplies
  it on the next `host.init`.
- **Runtime.** Messages flow in both directions. You may send
  `mentor.*` events at any time; Skillable may send `host.*` events at
  any time. Do not re-post `mentor.ready` or `mentor.session.opened` on
  every navigation; use `host.context.update` to re-ground.
- **Teardown.** Skillable may unmount the iframe at any point (session
  end, student quits). Do not rely on a goodbye handshake.

Theme and locale can change at any point in the lifecycle. Treat them
as reactive values.

---

## 13. Visual style

**Optional.** Everything in this section is guidance, not a requirement.
Your mentor is free to ship whatever visual design you want, and the
`host.theme.change` handler itself is optional — if your UI doesn't
adapt to light/dark modes, just ignore theme messages.

These tokens exist only as a convenience: if you'd like the iframe to
feel continuous with the surrounding Skillable lab chrome (usually the
nicer UX for students), matching the values here is the shortest path.

The Skillable lab uses a CSS-variable theming system keyed off a
`data-theme` attribute on the document root; every color, font, and
spacing value is defined twice (once per mode) and the browser
re-resolves them instantly when the attribute flips. You can do the
same, fake it, or completely ignore it.

### 13.1 Theming convention

Define tokens under both selectors and key your styles off the CSS
variables rather than literal colors:

```css
:root,
:root[data-theme="light"] { /* light-mode tokens */ }
:root[data-theme="dark"]  { /* dark-mode tokens */ }
```

On `host.init.theme` or `host.theme.change`, set the attribute:

```js
document.documentElement.setAttribute('data-theme', payload.theme);
```

Nothing else needs to happen — every `var(--token)` reference in your
CSS re-resolves.

### 13.2 Core palette

| Token | Light | Dark | Use |
|---|---|---|---|
| `--primary-main` | `#136945` | `#00CA72` | Brand green — primary buttons, links, accents |
| `--primary-dark` | `#0A3E28` | `#00954D` | Hover, signature green header bar |
| `--primary-soft` | `#DFF0EB` | `#E0FFF1` | Active-row highlights, soft backgrounds |
| `--primary-contrast` | `#FFFFFF` | `#FFFFFF` | Text on primary surfaces |
| `--accent-main` | `#00CA72` | `#00CA72` | Focus rings, emphasis accent |
| `--accent-light` | `#E0FFF1` | `#E0FFF1` | Focus background, hover on accent controls |
| `--accent-contrast` | `#141414` | `#141414` | Text on accent backgrounds |
| `--background-default` | `#FFFFFF` | `#141414` | Page background |
| `--background-contrast-xs` | `#FBFBFB` | `#1D1D1D` | Slight variance (headers, input backgrounds) |
| `--background-contrast-sm` | `#F2F2F2` | `#333333` | Card backgrounds, code blocks |
| `--text-primary` | `#141414` | `#FFFFFF` | Body text |
| `--text-secondary` | `#4A4A4A` | `#E7E7E7` | Secondary copy |
| `--text-light` | `#676767` | `#BDBDBD` | Captions, placeholders, muted metadata |
| `--divider` | `#D2D2D2` | `#4A4A4A` | Borders, dividers |
| `--error-main` | `#D32F2F` | `#D32F2F` | Error / destructive states |
| `--warning-main` | `#FFA726` | `#FFA726` | Warning |
| `--success-main` | `#2E7D32` | `#66BB6A` | Success |

Dark mode uses neutral blacks and grays for surfaces — **green is
reserved for brand accents, status indicators, and focus**, not for
tinting backgrounds.

### 13.3 Typography

| Role | Family | Weight | Line height |
|---|---|---|---|
| Headings | `'Lora', serif` | 500 – 600 | 1.2 |
| Body | `'Inter', sans-serif` | 400 – 500 | 1.4 |
| Code / monospace | `'JetBrains Mono', 'Consolas', monospace` | 400 – 500 | 1.45 |

Size scale used in the lab:

- Headings: 32 / 24 / 20 / 18 px (H1 &rarr; H4).
- Body: 18 / 16 / 14 px.
- Caption: 12 px.

Heading text tends to be tight (`line-height: 1.2`), body copy relaxed
(`1.4`). Lora and Inter are both available on Google Fonts.

### 13.4 Structure

- **Border-radius:** `8px` on cards, buttons, inputs; `4px` on status
  tags and chips.
- **Focus ring:** `outline: 3px solid var(--accent-main); outline-offset: 1px;`
  — keep the same color in both modes so keyboard users always see
  where they are.
- **Divider lines** are thin (1 px) in `var(--divider)`.
- **Mission-critical chrome** (top bars, exit controls) in the lab
  stays dark across themes. If your iframe has a top bar, consider
  doing the same.
- The brand green `#00CA72` often appears as a 2–10 px border / underline
  accent (active tab underline, signature top-bar border). Using it as
  an active-state underline in your UI matches the lab's visual
  language.

### 13.5 Reference CSS

Drop this into a `variables-common.css` (or equivalent) and reference
`var(--token-name)` throughout:

```css
:root,
:root[data-theme="light"] {
  --primary-main:           #136945;
  --primary-dark:           #0A3E28;
  --primary-soft:           #DFF0EB;
  --primary-contrast:       #FFFFFF;

  --accent-main:            #00CA72;
  --accent-light:           #E0FFF1;
  --accent-contrast:        #141414;

  --background-default:     #FFFFFF;
  --background-contrast-xs: #FBFBFB;
  --background-contrast-sm: #F2F2F2;

  --text-primary:           #141414;
  --text-secondary:         #4A4A4A;
  --text-light:             #676767;

  --divider:                #D2D2D2;

  --error-main:             #D32F2F;
  --warning-main:           #FFA726;
  --success-main:           #2E7D32;

  --border-radius:          8px;

  --heading-font-family:    'Lora', Georgia, serif;
  --body-font-family:       'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  --mono-font-family:       'JetBrains Mono', 'Consolas', monospace;
}

:root[data-theme="dark"] {
  --primary-main:           #00CA72;
  --primary-dark:           #00954D;
  --primary-soft:           #E0FFF1;
  --primary-contrast:       #FFFFFF;

  --accent-main:            #00CA72;
  --accent-light:           #E0FFF1;
  --accent-contrast:        #141414;

  --background-default:     #141414;
  --background-contrast-xs: #1D1D1D;
  --background-contrast-sm: #333333;

  --text-primary:           #FFFFFF;
  --text-secondary:         #E7E7E7;
  --text-light:             #BDBDBD;

  --divider:                #4A4A4A;

  --error-main:             #D32F2F;
  --warning-main:           #FFA726;
  --success-main:           #66BB6A;
}
```

These values are the floor of what the lab uses; the full Skillable
design system has additional tokens for status severity levels, soft
grays, and typography sizes. Skillable can share the full palette on
request if you need the extra fidelity.

### 13.6 A note on the third option

The lab offers a third color mode — **High Contrast** — for
accessibility. Skillable does not currently require your iframe to
implement it; if `host.theme.change` ever carries a value other than
`"light"` or `"dark"`, fall back to `"light"` and carry on. A future
version of this spec may formalize a high-contrast track.

---

## 14. Building and testing

Practical guidance:

- **Serve over HTTPS** as early as possible in development; browsers
  now block `postMessage` in many cross-origin HTTP scenarios.
- **Validate every message.** Reject anything without a matching
  `source`, `version`, or origin. Unknown `type` values must be
  ignored, not fatal.
- **Build for standalone.** Open your iframe's URL directly in a
  browser (no parent). Confirm it loads and produces a usable,
  context-free experience.
- **Build a throwaway host.** A single-page static HTML that embeds
  your iframe, logs every inbound message, and exposes buttons to send
  each outbound `host.*` type is the fastest way to exercise the whole
  surface area of the contract.
- **Respect `pageInstructions` markdown.** When your mentor reasons
  over the current page body, feed the markdown as-is to your LLM so
  code fences, lists, and links survive.
- **Zero-based `currentPageIndex`.** Every other numeric field can be
  1-indexed; this one isn't.

Skillable will provide you with a staging lab URL to embed against
during onboarding. Until then, a local throwaway host is sufficient.

---

## 15. Versioning

This document describes protocol version **1**. Future bumps will:

- ship alongside a deprecation window during which both versions are
  supported on Skillable's side;
- only remove fields if a prior minor version marked them deprecated;
- never re-use a message `type` with different semantics.

Unknown `type` values or extra `payload` fields are always safe to
ignore. If you see a `version` other than `1` on an inbound message,
drop it.

---

## 16. Getting in touch

Onboarding a new mentor involves:

- whitelisting your iframe origin in Skillable's CSP and iframe
  embedding logic,
- agreeing on an authentication scheme between your backend and
  Skillable's,
- light smoke testing in a staging lab before production embed.

Work with your Skillable integration contact for the specific
allowlisting steps and the staging URL. This document covers
everything on the wire; the rest is ops.
