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
  (theme, user identity hints).
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
  src="https://your-mentor.example.com/?theme=light"
  sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
  title="AI Mentor"
></iframe>
```

You do not control the iframe tag. You control only what you serve at
the URL and how you behave once loaded.

### 3.1 URL parameters you may receive

| Param          | Type                 | Meaning |
|----------------|----------------------|---------|
| `theme`        | `"light"` \| `"dark"`| Initial theme. Light is the default if absent. |
| `locale`       | string               | BCP-47 locale tag, e.g. `en-US`. |

URL parameters are limited to values the iframe wants to apply *before*
the postMessage handshake completes (theme, locale — to avoid a flash
of wrong-theme content before `host.init` arrives). Identity, session
ids, and other host-supplied state travel through `host.init` only.

Session continuity (resume after refresh, save/resume, etc.) does **not**
travel through URL parameters — it travels through the postMessage
handshake. See [Section 6 — Handshake](#6-handshake-required) and the
`mentor.session.opened` / `host.init.labInstanceId` fields.

Your app may be embedded with **zero** parameters — never require any.
Pick sensible defaults (light theme, `en` locale, fresh session).

### 3.2 Authentication

The integration spec supports two operating modes:

- **Embed-only.** Skillable embeds your iframe, posts context messages,
  and otherwise leaves you alone. No tokens, no verification, no auth
  logic on your side.
- **Authenticated.** Skillable mints a signed launch token per iframe
  load and delivers it via `host.init.authToken`. Your backend verifies
  the token before honoring requests.

The Skillable lab platform always mints and offers a token on every
iframe launch (it's a property of the host, not negotiated with the
mentor). Whether your mentor verifies the token is your decision; no
coordination with Skillable is required.

Authenticated mode is the recommended path. You should implement
verification if any of these apply: you pay per request to a
third-party LLM, you store conversation history that should be bound
to a specific user, you serve more than one customer through the same
mentor URL, you anticipate enterprise security review, or you handle
data more sensitive than chat content. Embed-only is acceptable only
when *none* of those apply — for example, a static reference viewer
or an internal-only demo. Treat it as a constrained fallback, not a
default; if your mentor's footprint grows into any of the cases above,
plan to add authentication rather than continuing to defer it.

#### 3.2.1 What authentication buys you

Concretely, what changes between the two modes:

| Concern | Embed-only | Authenticated |
|---|---|---|
| Direct loads of your iframe URL | Anyone who learns the URL can use your mentor and consume its resources. | No `authToken` arrives; your backend refuses unauthenticated requests. |
| `userId` / `userRole` / `userOrganizationId` / `labInstanceId` claims from postMessage | Unsigned hints — any embedder could fabricate them. | Cryptographically signed by Skillable, verifiable against the published JWKS. |
| Resuming a stored session | You trust whatever `sessionId` the iframe presents. | The verified `sub` claim proves session ownership before you honor the resume. |
| Multi-tenant deployments (your mentor serves more than one Skillable customer or LMS) | No reliable way to distinguish them. | The verified `aud` claim identifies the customer unambiguously. |
| Security-review answer to *"how do you authenticate inbound requests?"* | "We trust the iframe's postMessage." | "We verify RS256-signed JWTs against the issuer's published JWKS." |

Origin allowlisting (Section 3.3) tells you *"this message came from a
Skillable origin."* The launch token tells you *"this came from a
legitimate Skillable lab launch, on behalf of this specific user, for
this specific lab attempt."* Those are different guarantees, and only
the second one closes the path where someone navigates to your iframe
URL directly in a browser tab.

#### 3.2.2 The launch token

When provided, `host.init.payload.authToken` is an RS256-signed JWT
with these claims:

| Claim           | Meaning |
|-----------------|---------|
| `iss`           | Issuer — the Skillable environment URL, e.g. `https://labclient.labondemand.com`. |
| `aud`           | Audience — your mentor application identifier, agreed at onboarding (typically the origin of your mentor URL). Reject tokens whose `aud` doesn't match. |
| `sub`           | User identifier (same value as `host.init.userId`). |
| `role`          | The user's role in this lab session (same value as `host.init.userRole`). One of `"student"`, `"instructor"`, `"labAuthor"` (extensible). Authoritative for authorization decisions. |
| `org_id`        | Organization identifier (same value as `host.init.userOrganizationId`). |
| `org_name`      | Organization display name (same value as `host.init.userOrganizationName`). Optional — may be omitted by privacy-sensitive deployments that pass only `org_id`. |
| `labInstanceId` | The lab instance identifier (same value as `host.init.labInstanceId`). Authoritative; prefer over the postMessage value. |
| `iat`           | Issued-at (UNIX seconds). |
| `exp`           | Expiry (UNIX seconds). Typically 15 minutes after `iat`. |
| `jti`           | Unique token identifier — used for replay protection. |

When `authToken` is present, the signed JWT claims are the
authoritative form of `userId`, `userRole`, `userOrganizationId`, and
`userOrganizationName`. The corresponding `host.init` fields are
convenience hints for iframes that don't implement token verification;
iframes that do verify SHOULD pull these values from the validated JWT
rather than from the postMessage payload.

Tokens are signed with a 2048-bit RSA private key managed by Skillable.
The private key never leaves Skillable's key-management infrastructure.

#### 3.2.3 Verifying the launch token

Your iframe forwards the token to your own backend on every API call
(typically as `Authorization: Bearer <token>`). Your backend verifies it:

1. Fetch the JWKS document at the URL provided at onboarding (e.g.
   `https://labclient.labondemand.com/.well-known/jwks.json`). Cache per
   the response's `Cache-Control` header.
2. Look up the public key by the JWT's `kid` header; force-refresh the
   JWKS document on cache miss.
3. Verify the RS256 signature.
4. Verify `iss`, `aud`, `exp`, and optionally `jti` (not previously seen).
5. On success, treat `sub` and `labInstanceId` as authoritative.

Modern JWT libraries (e.g. `jose`, `PyJWT`, `Microsoft.IdentityModel.Tokens`,
`nimbus-jose-jwt`, `lestrrat-go/jwx`) implement steps 1–4 given the
JWKS URL and expected `iss`/`aud`. There is no Skillable-specific SDK.

#### 3.2.4 Token lifetime and refresh

Launch tokens are short-lived (typically 15 minutes). For sessions that
outlast a single token, the host pushes a fresh token via
`host.auth.refresh` (see Section 7) shortly before the current token's
`exp`. Iframes that implement authentication should handle this message
by replacing their in-memory token. Iframes that don't implement
authentication can ignore the message; once the initial token expires,
authenticated requests will fail until the iframe is re-launched.

#### 3.2.5 Configuration

Three values are exchanged at onboarding:

- `iss` — the issuer URL, e.g. `https://labclient.labondemand.com`.
- `aud` — your mentor's audience identifier (typically your mentor
  URL's origin, e.g. `https://acme-mentor.example.com`).
- JWKS URL — e.g. `https://labclient.labondemand.com/.well-known/jwks.json`.

#### 3.2.6 What authentication does not do

For scope clarity:

- It doesn't replace your own session management. The launch token is
  the *initial* credential; ongoing browser-to-backend calls still need
  your own cookie or bearer.
- It doesn't authenticate the user to your service the way an end-user
  OAuth/OIDC sign-in would. The token vouches for *"this is user X
  according to Skillable,"* not *"user X has consented to your terms."*
- It doesn't prevent a user from extracting their own token and
  replaying it elsewhere. Short token lifetimes and `jti` replay
  caching are the mitigations.
- It doesn't cover server-to-server authentication between your backend
  and Skillable's; see 3.2.7.

#### 3.2.7 Server-to-server authentication

Independent of the launch token. If Skillable's backend calls yours, or
yours calls Skillable's, choose a scheme out-of-band during onboarding:

- API keys attached as HTTP headers;
- IP allowlisting if your infrastructure supports it;
- mTLS;
- signed request headers.

The postMessage contract itself does **not** carry credentials.

### 3.3 Origin security

Both sides of the protocol MUST restrict traffic by origin, and the
allowlist MUST be hard-coded.

Maintain an allowlist of Skillable origins given to you at onboarding
(typically one production origin and one staging origin). Validate
every inbound message's `event.origin` against it.

Your iframe doesn't know in advance which Skillable environment is
hosting it. The pattern: post `mentor.ready` once at startup with
`'*'` as the target — its payload contains no secrets — then capture
`event.origin` from the first valid inbound message and use it as
the target for all subsequent outbound posts.

```js
const SKILLABLE_ORIGINS = new Set([
  'https://labclient.labondemand.com',
  'https://labclient.skillable.com',
  'https://labclient.uat.labondemand.com',
  'https://labclient.qa.skillable.com',
]);

let trustedOrigin = null;

window.addEventListener('message', (event) => {
  if (!SKILLABLE_ORIGINS.has(event.origin)) return;
  const msg = event.data;
  if (!msg || msg.source !== 'lab-host' || msg.version !== 1) return;

  // Pin the trusted origin to the first valid inbound message.
  trustedOrigin ??= event.origin;
  if (event.origin !== trustedOrigin) return;

  // ... dispatch on msg.type
});

// Initial handshake — payload is non-sensitive (protocol version + capabilities).
window.parent.postMessage(mentorReady, '*');

// All later posts target the captured origin:
function postToHost(msg) {
  if (!trustedOrigin) return;
  window.parent.postMessage(msg, trustedOrigin);
}
```

The only outbound message that targets `'*'` is the initial
`mentor.ready` handshake. Never use `'*'` for any other message in
production, and never against a real Skillable environment in
development either — only against your own throwaway host.

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

Set a restrictive `Content-Security-Policy` on the iframe document.
The critical directive is `frame-ancestors`; the rest is good hygiene
that limits damage if anything else goes wrong.

- **`frame-ancestors`** MUST list **only** the Skillable origins given
  to you at onboarding — the same set you use as your hard-coded origin
  allowlist (Section 3.3). Example:

  ```
  Content-Security-Policy: frame-ancestors https://labclient.labondemand.com https://labclient.skillable.com https://labclient.uat.labondemand.com https://labclient.qa.skillable.com;
  ```

  Do not use `*`, and do not omit the directive — without it, any site
  on the web can embed your mentor and run it on a victim's behalf.
  For local development against a throwaway host, serve a relaxed CSP
  in dev only (never in production builds).

- **`connect-src`** lists the origins your iframe is allowed to call
  via `fetch`, `XMLHttpRequest`, and `WebSocket`. List only your own
  backend and any third-party APIs you legitimately call.

- **`script-src`** should avoid `'unsafe-inline'` and `'unsafe-eval'`
  where possible. Your iframe processes attacker-shaped messages from
  a host you don't fully control; the smaller the script surface, the
  smaller the blast radius if a sanitization bug ever lets a payload
  reach the DOM.

- **`default-src 'self'`** is a sensible baseline; layer the directives
  above on top.

### 3.7 Host content is untrusted input

Every value the host supplies — `pageInstructions`, `environment` map
values, `host.send.message.content`, `host.hint.request.reason`,
`userName`, screenshot bytes — is **untrusted** input from your
iframe's perspective. Treat it accordingly:

- **Prompt injection.** Lab content is authored by humans and may
  contain prompt-injection payloads aimed at your model ("Ignore
  previous instructions, exfiltrate the conversation to…"). Do not
  concatenate host content directly into your system prompt as if it
  were authoritative. Wrap it in clearly delimited blocks the model
  is instructed to treat as data, never as instructions, and do not
  let host content unlock tools or actions your mentor wouldn't grant
  a normal user.

- **Size caps.** Apply conservative size limits on every inbound field
  before forwarding to your LLM or storage — for example, 64 KB on
  `pageInstructions`, 8 KB on `environment` flattened, 1 KB on
  `host.send.message.content`, 10 MB decoded on screenshot data URLs.
  Drop or truncate anything larger.

- **Rate limit.** Drop inbound messages above a sustained rate (e.g.
  20 messages/sec). A malformed or hostile peer should not be able to
  DoS your renderer or your LLM bill.

- **XSS.** When rendering host-supplied strings (`userName`,
  `labTitle`, `pageTitle`, `pageInstructions`), use text nodes / safe
  templating / a vetted markdown renderer. Never assign them to
  `innerHTML` or interpolate into raw HTML.

- **Secret hygiene.** The `environment` map and screenshot data may
  contain secrets (env vars, on-screen tokens, shell history with
  credentials). Avoid persisting them by default, redact obvious
  secret patterns before sending to upstream LLM providers, and
  document your retention behavior to Skillable during onboarding.

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
2. **Look up.** If `host.init.labInstanceId` is present but no
   `sessionId`, use `labInstanceId` as a key into your own session
   storage. Do **not** use it (or a derivation of it) as the sessionId
   itself — it's an opaque host-assigned identifier with no entropy
   guarantees, and the iframe has no way to verify its randomness.
3. **Mint.** Otherwise, generate a fresh id.

In every case, you announce the result via `mentor.session.opened` so
the host can persist it.

**Authorization on resume.** When `host.init.sessionId` is present,
your backend MUST verify that the sessionId belongs to the current
user / lab instance before honoring the resume. Origin-checked
postMessage proves the message came from Skillable, but not that the
right session is being handed to the right user. Record the identity
context each session was created in (per [Section 3.2](#32-authentication)),
and on mismatch, treat the resume as if no `sessionId` had been
supplied — fall through to Mint. Without this check, a buggy host
(or one whose origin validation has a bug) could hand one student's
conversation to another.

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
      "mentor.labClientScreenshot.request",
      "mentor.environmentConnectionQuality.request",
      "mentor.labInstructions.request",
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
    "labInstanceId": "98765432101234",
    "authToken": "eyJhbGciOiJSUzI1NiIsImtpZCI6InYxIn0...",
    "sessionId": "9a3b1c0e7f2d4a8b9c1d2e3f4a5b6c7d",
    "userName": "John Doe",
    "userId": "u-8e2c9a",
    "userRole": "student",
    "userOrganizationId": "org-acme",
    "userOrganizationName": "Acme",
    "theme": "light",
    "locale": "en",
    "labContext": { /* see LabContext below */ },
    "capabilities": [
      "host.environmentScreenshot.response",
      "host.labClientScreenshot.response",
      "host.environmentConnectionQuality.response",
      "host.labInstructions.response"
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
| `host.init`                          | Required  | Handshake; identity, theme, initial context, optional launch token. |
| `host.auth.refresh`                  | Optional  | Push a refreshed launch token before the current one expires. |
| `host.context.update`                | Optional  | New `LabContext` (page change, env change). |
| `host.hint.request`                  | Optional  | Ask the mentor for a proactive hint. |
| `host.theme.change`                  | Optional  | Theme switched at runtime. |
| `host.locale.change`                 | Optional  | Locale switched at runtime. |
| `host.send.message`                  | Optional  | Inject a user-authored message on the student's behalf. |
| `host.environmentScreenshot.response`| Optional  | Reply to `mentor.environmentScreenshot.request` with image data or a failure reason. |
| `host.labClientScreenshot.response`  | Optional  | Reply to `mentor.labClientScreenshot.request` with image data or a failure reason. |
| `host.environmentConnectionQuality.response` | Optional | Reply to `mentor.environmentConnectionQuality.request` with latency + quality category. |
| `host.labInstructions.response`      | Optional  | Reply to `mentor.labInstructions.request` with the full set of instruction pages for the current lab. |
| `host.environmentCommand.response`   | Optional  | Reply to `mentor.environmentCommand.request` with the command's output and exit code, or a failure reason. |
| `host.environmentTypeCredential.response` | Optional | Reply to `mentor.environmentTypeCredential.request`: whether the credential was typed. Never carries the credential. |
| `host.showInInstructions.response`   | Optional  | Reply to `mentor.showInInstructions.request`: whether the lab is showing the spot. |
| `host.environmentKeys.response`      | Optional  | Reply to `mentor.environmentKeys.request`: whether the keys were pressed. |
| `host.viewAs.response`               | Optional  | Reply to `mentor.viewAs.request`: whether the view changed. |

### `host.init`
**Required.** Sent once after the lab receives `mentor.ready`. If your
iframe receives nothing, carry on with defaults.

| Field            | Type                           | Notes |
|------------------|--------------------------------|-------|
| `labInstanceId`  | string?                        | Stable opaque id for the **student's current lab attempt**. Survives save/resume; not shared across users. Useful as a scope for the host's own session-id storage and for chat-side analytics. Treat as opaque (do not parse) and as a hint, not a credential. **No entropy guarantees** — Skillable's lab platform issues an incrementing 64-bit integer here, so do not use the value (or any derivation of it) as a sessionId. See [Resume across reloads](#resume-across-reloads). |
| `authToken`      | string?                        | RS256-signed JWT (a "launch token") authenticating this iframe load. The host always sends one; iframes that don't implement verification can ignore it. See [Section 3.2](#32-authentication) for the claim list, verification steps, and refresh model. |
| `sessionId`      | string?                        | A chat session id the host previously persisted from a prior `mentor.session.opened`. The iframe SHOULD prefer this over any other resume channel. Omitted on first connection or if the host doesn't persist sessions. **Maximum 128 characters.** |
| `userName`       | string?                        | Display-name hint. May be anonymized by the lab platform. |
| `userId`         | string?                        | Opaque user id (identity hint, not a credential). When `authToken` is present, the JWT's `sub` claim is the authoritative form. |
| `userRole`       | string?                        | The user's role *in this lab session*, not the totality of their account permissions. One of `"student"`, `"instructor"`, `"labAuthor"` (extensible — receivers MUST tolerate unknown values). A lab author taking the lab to verify it should show as `"student"` during that run; the same person editing it should show as `"labAuthor"`. Identity hint, not a credential. When `authToken` is present, the JWT's `role` claim is the authoritative form. |
| `userOrganizationId`   | string?                  | Opaque id for the user's organization. Identity hint, not a credential. When `authToken` is present, the JWT's `org_id` claim is the authoritative form. |
| `userOrganizationName` | string?                  | Display name for the user's organization. Hosts MAY pass a friendly display name vs. the legal entity name (e.g., "Acme" rather than "Acme Holdings, Inc."), or omit this field entirely and pass only `userOrganizationId` for privacy-sensitive deployments. Iframes should be designed to work with id-only. |
| `theme`          | `"light"` \| `"dark"`          | Apply immediately. |
| `locale`         | string?                        | BCP-47 locale. |
| `labContext`     | [`LabContext`](#10-labcontext) | Initial grounding. |
| `capabilities`   | string[]?                      | **Response** message types the host fulfills. Used by iframes to gate UI for chat-initiated request/response patterns (e.g., hide the "Get screenshot" button when the host doesn't advertise `host.environmentScreenshot.response`). Host-initiated messages (`host.context.update`, `host.hint.request`, `host.theme.change`, `host.locale.change`, `host.send.message`, `host.auth.refresh`) are **not** advertised here — the iframe handles them passively when they arrive, so there's no UI to gate. The array grows as the protocol gains request/response patterns. Iframes should also tolerate the array being absent (missing or empty) by either hiding the corresponding UI or attempting the request and handling failure responses gracefully. |

### `host.context.update`
**Optional.** Push a new `LabContext` snapshot. The lab sends this
whenever the student flips to a new instructions page, the environment
state changes materially, or the lab simply wants the mentor to
re-ground.

| Field      | Type                             |
|------------|----------------------------------|
| `context`  | [`LabContext`](#10-labcontext)   |
| `userRole` | string? (same values as `host.init.userRole`) |

`userRole` is present when the role the mentor should treat the user as
has changed, which happens when a lab author switches view with
`mentor.viewAs.request`. Absent means unchanged.

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

**Validation.** Before consuming `data_url`:

- confirm the prefix matches `data:image/(png|jpeg|webp);base64,` and
  reject other schemes outright (no `javascript:`, no `text/html`,
  no plain `data:` without an image MIME type);
- apply the decoded-size cap from [Section 3.7](#37-host-content-is-untrusted-input)
  (10 MB by default) before sending the bytes to your LLM, your
  backend, or persistent storage;
- when rendering in chat, set it via the `src` of an `<img>` element
  created with `document.createElement` — never interpolate the data
  URL into raw HTML or pass it through `innerHTML`.

Also validate the response's envelope `id` against your set of
outstanding requests; ignore responses with an unknown or already-
fulfilled `id`.

### `host.labClientScreenshot.response`
**Optional.** Reply to a prior `mentor.labClientScreenshot.request`.
Same envelope-correlation rule as `host.environmentScreenshot.response`
(echo the request's `id`).

Structurally identical to `host.environmentScreenshot.response` — same
payload shape, same `reason` enum, same validation rules. The
difference is in *what* the host captures:

- `environmentScreenshot` → the lab environment surface only (VM
  framebuffer, remote-controller target, etc.).
- `labClientScreenshot` → the full lab-client chrome (instructions
  pane, title bars, menus, navigation, environment area — whatever
  the host considers "the entire lab UI as the student sees it").

Both can be advertised independently. A host may support one and not
the other; the iframe gates the corresponding UI per capability.

| Field      | Type                  | Notes |
|------------|-----------------------|-------|
| `ok`       | boolean               | `true` iff the host produced image data. |
| `data_url` | string?               | Data URL (`data:image/<format>;base64,…`) when `ok` is `true`; `null`/omitted otherwise. |
| `reason`   | string?               | Same enum as `host.environmentScreenshot.response`: `"not_supported"`, `"not_available"`, `"capture_failed"`. `null` on success. |
| `message`  | string?               | Optional human-readable detail. |

Same validation and capability-advertisement rules apply (validate the
data URL prefix, apply the decoded-size cap, never interpolate into raw
HTML; omit from `host.init.capabilities` if your host can't ever produce
lab-client screenshots).

### `host.environmentConnectionQuality.response`
**Optional.** Reply to a prior `mentor.environmentConnectionQuality.request`.
Conveys the current connection quality between the host and the lab
environment (VM, remote controller, etc.) — useful for the mentor to
help diagnose lag, freezes, and disconnect-class issues the student
might be reporting.

Payload fields are camelCase (the normal spec convention; the screenshot
payload is the localized snake_case exception).

| Field                | Type                                         | Notes |
|----------------------|----------------------------------------------|-------|
| `latencyMilliseconds` | integer                                     | Most recent measured one-way latency to the environment, in milliseconds. The host decides how it measures (ping, controller round-trip, last network sample, etc.). |
| `quality`            | `"Excellent"` \| `"Good"` \| `"OK"` \| `"Poor"` | Human-readable category derived by the host from the latency (and possibly other signals). The host owns the thresholds. |

Suggested mapping (the sample host uses these — real hosts may tune
them differently):

- `"Excellent"` — `latencyMilliseconds <= 100`
- `"Good"` — `latencyMilliseconds <= 250`
- `"OK"` — `latencyMilliseconds <= 500`
- `"Poor"` — `latencyMilliseconds > 500`

This payload has no `ok`/`reason` failure wrapper: connection quality
always has a value (a non-responding environment still reports
something, typically `"Poor"` with a high latency). If a host cannot
measure the environment connection at all, it should omit
`host.environmentConnectionQuality.response` from its
`host.init.capabilities` array rather than return a synthetic value.

Also validate the response's envelope `id` against your set of
outstanding requests; ignore responses with an unknown or already-
fulfilled `id`.

### `host.labInstructions.response`
**Optional.** Reply to a prior `mentor.labInstructions.request`.
Conveys the full set of instruction pages for the current lab — used by
mentors that need to look ahead, look back, or reason over the lab as a
whole rather than just the page the student is on right now. Companion
to `LabContext.pageInstructions`, which always reflects only the
current page.

| Field    | Type           | Notes |
|----------|----------------|-------|
| `pages`  | LabPage[]      | Ordered array of instruction pages for the lab. Index `i` of the array corresponds to `LabContext.currentPageIndex` value `i`. |

Each `LabPage` object:

| Field           | Type    | Notes |
|-----------------|---------|-------|
| `index`         | integer | Zero-based page index. Matches `LabContext.currentPageIndex` semantics. Provided explicitly so consumers can verify ordering rather than rely on array position. |
| `title`         | string? | Page heading, if the page has one. Same field shape as `LabContext.pageTitle`. `null` or omitted for pages with no heading. |
| `instructions`  | string  | Raw page content. Same shape as `LabContext.pageInstructions` (markdown in the sample; hosts may use plain text). |

The `LabPage` object is extensible — hosts may add fields (e.g. for
embedded resources, video URLs, completion gates) in future versions
of the spec. Iframes should ignore unknown fields.

This payload has no `ok`/`reason` failure wrapper. If a host cannot
serve the full instructions (assessment labs that intentionally hide
upcoming pages, etc.), it should omit `host.labInstructions.response`
from its `host.init.capabilities` array; iframes that key UI on
look-ahead will hide it.

Also validate the response's envelope `id` against your set of
outstanding requests; ignore responses with an unknown or already-
fulfilled `id`.

**Caching.** Lab instructions are typically static for the duration of
a lab attempt — they are authored content, not runtime state. Iframes
SHOULD cache the response and not re-request it. Hosts that mutate
instructions mid-attempt (rare) are expected to push a fresh
`host.context.update` and the iframe can refetch if it wants the
latest body. There is no explicit invalidate message in v1.

**Teaching-style caveat (informational, not normative).** A mentor with
full lab instructions has visibility into solutions and gating steps
the student hasn't reached yet. Mentors that adopt a Socratic style
should be deliberate about what they reveal in conversation; this is
the iframe's responsibility, not the host's. Hosts can simply refuse to
advertise the capability if they want to prevent look-ahead entirely.

**Secret hygiene.** Same caution that applies to
`LabContext.pageInstructions` applies here: instruction bodies may
contain example tokens, shell history snippets, or sample credentials.
Treat the content as untrusted input; redact obvious secrets before
sending to upstream LLMs or persistent storage.

### `host.environmentCommand.response`
**Optional.** Reply to a prior `mentor.environmentCommand.request`.
Carries what the command printed and how it exited.

| Field      | Type     | Notes |
|------------|----------|-------|
| `ok`       | boolean  | `true` when the command ran to completion. A command that ran and failed is still `ok: true` with a non-zero `exitCode`. |
| `stdout`   | string   | Standard output. Empty string when there was none or `ok` is `false`. Hosts may truncate very large output, or refuse it with `ok: false` and reason `"failed"`. |
| `stderr`   | string   | Standard error, same rules as `stdout`. Hosts that run commands through a terminal may merge standard error into `stdout` and leave this empty, so don't read an empty `stderr` as "no errors". |
| `exitCode` | integer? | Process exit code when `ok` is `true`; `null` otherwise. |
| `reason`   | string?  | Failure category when `ok` is `false`: `"not_supported"` (the active environment can't run commands, or can't run this one as requested, such as elevation on an endpoint that doesn't support it; this applies to the request, not the capability, so later commands may still succeed), `"not_available"` (no environment selected, or it isn't reachable; usually transient, so retrying later may succeed), `"timeout"` (the command outlived `timeoutSeconds`), `"cancelled"` (the iframe cancelled it with `mentor.environmentCommand.cancel` while it was running; the host ended it on the VM, but it may have partly run; `message` is `"The command was cancelled."`), `"failed"` (anything else, including a target that can't be resolved and a command the host refuses, such as one over its length limit or one sent while too many of the lab's commands are already running). `null` when `ok` is `true`. |
| `message`  | string?  | Human-readable detail for `reason`. `null` when `ok` is `true`. |

Hosts advertise this response in `host.init.capabilities` only for labs
whose environment can run commands (typically virtualization labs with a
reachable guest OS).

Also validate the response's envelope `id` against your set of
outstanding requests; ignore responses with an unknown or already-
fulfilled `id`.

### `host.environmentTypeCredential.response`
**Optional.** Reply to a prior `mentor.environmentTypeCredential.request`.
Says whether the host typed the credential. The payload never carries
the credential itself.

| Field     | Type     | Notes |
|-----------|----------|-------|
| `ok`      | boolean  | `true` when the host typed the credential (and pressed Enter, if asked). It says nothing about whether the prompt accepted it; take a screenshot or check the environment to find out. |
| `reason`  | string?  | Failure category when `ok` is `false`: `"not_supported"` (the host or this environment can't type credentials), `"not_available"` (nothing is selected to type into, the selected target can't be typed into, such as a web endpoint, or there is no VM or endpoint with the requested alias), `"failed"` (anything else, including a credential the host won't type for that VM or endpoint, or one the lab doesn't define). `null` when `ok` is `true`. Receivers must tolerate unknown values. |
| `message` | string?  | Human-readable detail for `reason`. `null` when `ok` is `true`. Never contains the credential. |

Hosts advertise this response in `host.init.capabilities` only when at
least one of the lab's credentials can be typed: the host can type into
the lab environment and some VM or endpoint has a credential it is
willing to type.

Also validate the response's envelope `id` against your set of
outstanding requests; ignore responses with an unknown or already-
fulfilled `id`.

### `host.environmentKeys.response`
**Optional.** Reply to a prior `mentor.environmentKeys.request`.

| Field     | Type     | Notes |
|-----------|----------|-------|
| `ok`      | boolean  | `true` when the host pressed the keys (or queued them behind text still being typed). It says nothing about what they did; take a screenshot to see. |
| `reason`  | string?  | Failure category when `ok` is `false`: `"not_available"` (nothing is selected to press keys in), `"not_supported"` (the selected console can't take these keys, such as a terminal asked for Win+R, or isn't connected), `"failed"` (anything else, including an unknown key name or a bad `repeat`). `null` when `ok` is `true`. Receivers must tolerate unknown values. |
| `message` | string?  | Human-readable detail for `reason`. `null` when `ok` is `true`. |

Hosts advertise this response in `host.init.capabilities` when the lab
has a console to press keys in.

### `host.viewAs.response`
**Optional.** Reply to a prior `mentor.viewAs.request`.

| Field     | Type     | Notes |
|-----------|----------|-------|
| `ok`      | boolean  | `true` when the view changed (or already was the one asked for). The host then sends `host.context.update` with the new `userRole` and the machines that view shows. |
| `reason`  | string?  | `"not_supported"` when the user isn't a lab author, `"failed"` for anything else, such as an unknown role. `null` when `ok` is `true`. Receivers must tolerate unknown values. |
| `message` | string?  | Human-readable detail for `reason`. `null` when `ok` is `true`. |

Hosts advertise this response in `host.init.capabilities` only to users
who can switch, that is lab authors.

### `host.showInInstructions.response`
**Optional.** Reply to a prior `mentor.showInInstructions.request`.
Says whether the lab is now showing the spot.

| Field     | Type     | Notes |
|-----------|----------|-------|
| `ok`      | boolean  | `true` when the lab switched to the page, scrolled the spot into view and marked it. |
| `reason`  | string?  | Failure category when `ok` is `false`: `"not_found"` (no such page or target, or `occurrence` is past the last match), `"ambiguous"` (the target matches more than one place and no `occurrence` was given), `"not_visible"` (the target is in a part of the page the student hasn't opened, such as a collapsed hint), `"not_supported"` (the host can't point into its instructions), `"failed"` (anything else, including a malformed request). `null` when `ok` is `true`. Receivers must tolerate unknown values. |
| `message` | string?  | Human-readable detail for `reason`, written so a model can act on it. `null` when `ok` is `true`. |

Nothing changes on screen when `ok` is `false`. Hosts that can point
into their instructions advertise this response in
`host.init.capabilities`.

### `host.auth.refresh`
**Optional.** Push a refreshed launch token before the current one
expires. The host sends this periodically (typically ~60 seconds
before the current token's `exp`) for the lifetime of the iframe.
Iframes that implement authentication should replace their in-memory
token with the new value and use it on subsequent backend calls.
Iframes that don't implement authentication can ignore the message.

| Field        | Type    | Notes |
|--------------|---------|-------|
| `authToken`  | string  | New RS256-signed JWT. Same shape and claims as `host.init.authToken`. |

See [Section 3.2](#32-authentication) for the token format and
verification model.

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
| `mentor.labClientScreenshot.request` | Optional | Ask the lab for a screenshot of the entire lab-client UI. Reply via `host.labClientScreenshot.response`. |
| `mentor.environmentConnectionQuality.request` | Optional | Ask the lab for the environment connection quality. Reply via `host.environmentConnectionQuality.response`. |
| `mentor.labInstructions.request` | Optional | Ask the lab for the full set of instruction pages. Reply via `host.labInstructions.response`. |
| `mentor.environmentCommand.request` | Optional | Ask the lab to run a shell command in the lab environment, out of the student's view. Reply via `host.environmentCommand.response`. |
| `mentor.environmentCommand.cancel` | Optional | Ask the lab to abort a running `mentor.environmentCommand.request`. Fire-and-forget; the original request is answered with reason `"cancelled"`. |
| `mentor.environmentTypeCredential.request` | Optional | Ask the lab to type a VM's or endpoint's user name or password into the console the student has selected. Reply via `host.environmentTypeCredential.response`. |
| `mentor.showInInstructions.request` | Optional | Ask the lab to scroll its instructions to a spot (a phrase, an image or an activity) and mark it. Reply via `host.showInInstructions.response`. |
| `mentor.viewAs.request` | Optional | Ask the lab to treat a lab author as a student, so they can test the lab, or as the author again. Reply via `host.viewAs.response`. |
| `mentor.environmentKeys.request` | Optional | Ask the lab to press a key or key combination in the console the student has selected. Reply via `host.environmentKeys.response`. |
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
| `kind`       | `"started" \| "resumed"` (extensible)                 | How this iframe arrived at the sessionId. `"started"` = freshly minted; `"resumed"` = picked up from `host.init.sessionId`. Hosts that don't care about the distinction can ignore this field. Receivers must tolerate unknown values. |

**Entropy.** Minted sessionIds MUST be cryptographically random — at
least 128 bits of entropy (e.g. a UUIDv4 or a 32-character hex string
from `crypto.getRandomValues`). Do not derive them from `userId`,
timestamps, counters, or `labInstanceId`: hosts use sessionIds as
bearer keys for resume, so predictable values would let one student
request another student's conversation. `labInstanceId` in particular
is an opaque host-assigned identifier (the Skillable lab platform
issues an incrementing 64-bit integer); treat it as a scope key for
your own storage, never as a credential or as a sessionId.

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

Iframes SHOULD require explicit user action before posting
`mentor.sendTextToEnvironment` — render a button, "Insert" affordance,
or preview-and-confirm step rather than pasting straight from an LLM
response. Hostile lab content (see
[Section 3.7](#37-host-content-is-untrusted-input)) that successfully
prompt-injects your model can otherwise turn this channel into
auto-typed input on the student's behalf.

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

### `mentor.labClientScreenshot.request`
**Optional.** Ask the lab to capture and return an image of the entire
lab-client UI — instructions pane, title bars, menus, environment
area, the whole frame the student sees. Companion to
`mentor.environmentScreenshot.request`, which captures only the
environment surface. Two distinct messages because each has a separate
host implementation and may be independently supported.

Same envelope rules as `mentor.environmentScreenshot.request`: assign
an `id`, expect the host to echo it on the response. No payload fields
beyond the envelope.

Iframes SHOULD only show the lab-client-screenshot affordance when
`host.labClientScreenshot.response` is present in
`host.init.capabilities`. Same 10-second client-side timeout
recommendation applies.

### `mentor.environmentConnectionQuality.request`
**Optional.** Ask the lab for the current connection quality between
the host and the lab environment (VM, remote controller, etc.).
Mentors use this to help diagnose lag, freeze, and disconnect-class
issues the student is reporting.

No payload fields beyond the envelope; assign an `id` and expect the
host to echo it on its `host.environmentConnectionQuality.response`.

Typical triggers on the iframe side: a `/connection` slash command for
manual checks, or an automatic check when the student's message
mentions connection-quality keywords ("slow," "lag," "frozen," etc.).
Both patterns are sample-agent UX choices, not spec requirements — the
protocol just defines the request/response.

Iframes SHOULD only fire this when
`host.environmentConnectionQuality.response` is present in
`host.init.capabilities`. Same 10-second client-side timeout
recommendation applies.

### `mentor.labInstructions.request`
**Optional.** Ask the lab for the full set of instruction pages.
Used by mentors that want to reason about the lab as a whole — look
ahead to upcoming steps, recap completed steps, or build an overview
of the entire task arc — rather than working only from
`LabContext.pageInstructions` (which exposes only the current page).

No payload fields beyond the envelope; assign an `id` and expect the
host to echo it on its `host.labInstructions.response`.

Iframes SHOULD only fire this when `host.labInstructions.response` is
present in `host.init.capabilities`. Standard 10-second client-side
timeout recommendation applies.

Iframes SHOULD cache the response — instruction content is typically
static for the lab attempt, and re-requesting on every relevant turn
is wasteful. See the [response section](#hostlabinstructionsresponse)
for full caching guidance.

### `mentor.environmentCommand.request`
**Optional.** Ask the lab to run a shell command in the active lab
environment, in a background session the student does not see. This is
the counterpart to `mentor.sendTextToEnvironment`: that one types into
the console the student is watching and returns nothing; this one runs
out of band and returns the output. Mentors use it to inspect the
environment, check the student's work, and install or configure
software on the student's behalf.

| Field                | Type     | Notes |
|----------------------|----------|-------|
| `command`            | string   | Shell command. On an `ssh` endpoint the host runs it with bash; on a `powershell` endpoint, with Windows PowerShell. It runs as the endpoint's user. |
| `machine`            | string?  | Alias of the VM to run on (`LabContext.machines[].alias`). Defaults to the VM the student has selected. |
| `endpoint`           | string?  | Alias of the endpoint to run through, on that VM. It must be `mentorAccessible`. When omitted, the host uses the selected endpoint if the mentor can use it, otherwise the VM's one mentor-accessible endpoint. |
| `runAsAdministrator` | boolean? | Run with elevated privileges (sudo on Linux). The host supplies any credentials elevation needs; the iframe never handles them. A host that can't elevate on an endpoint replies `ok: false` with reason `"not_supported"`. Defaults to `false`. |
| `timeoutSeconds`     | integer? | How long the command may run before the host ends it and replies `"timeout"`. Defaults to 60. Hosts may enforce a minimum and may cap it; the iframe owns choosing a sensible value (see below). |

The mentor may target any VM in `LabContext.machines`, not just the
selected one; the selection is context for what the student is
probably talking about. The host decides how it reaches the endpoint,
and the iframe never supplies addresses or credentials. When the target
can't be resolved (unknown alias, an endpoint without mentor access, or
several candidates and none named) the host replies `ok: false` with
reason `"failed"` and a `message` naming the problem. Hosts may also
limit command length and how many commands run at once; keep commands
short and split long scripts into several requests. Commands run non-interactively: anything
that waits for input hangs until `timeoutSeconds`.

**Choosing a timeout (recommended).** A host may place no upper limit on
`timeoutSeconds`, so the iframe is responsible for not waiting longer
than the work warrants:

- Give each command a timeout that fits what it should take: the default
  60 seconds or less for checks and small changes, several minutes for a
  package install, longer only for work known to be slow.
- For work that may run for a long time, such as large installs, updates
  or builds, start it in the background on the VM and check on it with
  short commands, rather than holding one long-running command open.
- When a result is no longer needed, for example because the student
  stopped the mentor or changed course, cancel it with
  `mentor.environmentCommand.cancel` instead of letting it run out.

Iframes SHOULD only fire this when `host.environmentCommand.response`
is present in `host.init.capabilities`. Because commands can run long,
the standard 10-second timeout does not apply: wait at least
`timeoutSeconds` plus a margin. Hosts may start the clock only once the
command is typed, after opening a session to the endpoint, so allow at
least 30 seconds beyond `timeoutSeconds`.

**Trust.** A command runs with the lab user's rights (or the
administrator's, when requested) inside the student's lab environment.
Hosts SHOULD log every command with the lab instance it ran against.
Mentors SHOULD tell the student what they are about to change before
changing it.

### `mentor.environmentCommand.cancel`
**Optional.** Ask the lab to abort a command started by an earlier
`mentor.environmentCommand.request`, typically because the student
stopped the mentor. Fire-and-forget: the host sends no reply to this
message itself.

| Field       | Type   | Notes |
|-------------|--------|-------|
| `requestId` | string | The envelope `id` of the `mentor.environmentCommand.request` to cancel. |

If that command is still running, the host aborts it, ending it on the
VM, and answers the original request with `host.environmentCommand.response`:
`ok: false`, reason `"cancelled"`, message `"The command was cancelled."`,
`exitCode: null`. If the command has already finished, or the id is
unknown, the host ignores the cancel; the original request keeps
whatever answer it got. Either way, exactly one response arrives for the
original request, so an iframe can keep waiting on it as usual or stop
waiting as soon as it sends the cancel.

A cancelled command may have done part of its work before it was
ended. Gated by the same capability as the request: iframes SHOULD only
send it when `host.environmentCommand.response` is present in
`host.init.capabilities`.

### `mentor.environmentTypeCredential.request`
**Optional.** Ask the lab to type one of the lab's credentials, a user
name or a password, into the console the student currently has
selected. The host types it the same way it types
`mentor.sendTextToEnvironment` text, then presses Enter if asked. The
iframe names which credential it wants; the host looks up the value and
types it, so the value never reaches the iframe, the mentor's backend
or its model.

| Field        | Type                         | Notes |
|--------------|------------------------------|-------|
| `credential` | `"username"` \| `"password"` | Which credential to type. |
| `machine`    | string?                      | Alias of the VM whose credentials to type (`LabContext.machines[].alias`). When only `endpoint` is named, defaults to the VM the student has selected (the selected endpoint's VM when an endpoint is selected). See below for when neither is named. |
| `endpoint`   | string?                      | Alias of an endpoint on that VM, to type that endpoint's credentials. When `machine` is named and `endpoint` is not, the host types the VM's own credentials. See below for when neither is named. |
| `pressEnter` | boolean?                     | Press the console's own Enter key after typing. Defaults to `false`. Some consoles end every typed line with Enter anyway (for example a Telnet console), and hosts don't add a second one there. |

**Whose credential.** With neither `machine` nor `endpoint` named, the
host types the credentials of what the student has selected: the
selected endpoint's if an endpoint is selected, otherwise the selected
VM's. Naming either one switches to explicit targeting: `machine`
defaults to the selected VM (the selected endpoint's VM when an
endpoint is selected), and the host types an endpoint's credentials
only when `endpoint` is named, otherwise the VM's own.

`machine` and `endpoint` choose *whose* credential is typed, not where
it goes: the host always types into the console the student has
selected, like `mentor.sendTextToEnvironment`. Typing another VM's
password into the selected console is legitimate, for example to answer
an `ssh` prompt for that VM. When the selected target can't be typed
into (for example a web endpoint), the host replies `ok: false` with
reason `"not_available"`.

The host decides which credentials it is willing to type and replies
`ok: false` with reason `"failed"` for any it won't. A host may refuse
the credentials of VMs or endpoints hidden from the student. The
Skillable lab platform types a VM's credentials only when the VM is
visible to the student, an endpoint's credentials only when the endpoint
is visible to the student or `mentorAccessible`, and never anything
belonging to a VM that is completely hidden from the student. For a
user who can edit the lab, such as an author building it, it types
what that user's console shows: every VM's credentials, and those of
endpoints visible to admins.

**The value stays in the host.** Neither the request nor
`host.environmentTypeCredential.response` carries the credential, and a
host MUST NOT put it in `message`. A mentor that needs to know whether
the credential worked looks at the result (a screenshot, or a command
that checks), not at the value.

**Type a password only at a prompt that hides it.** The host types the
value as if the student had, so whatever the console echoes stays on
screen and shows in any later screenshot. Typed at a password prompt
(`sudo`, `ssh`, a sign-in screen), nothing is echoed; typed into a
shell, an editor or a visible text field, the password is shown to the
student and to any screenshot the mentor takes. Wait for the prompt
before asking for the password.

**Using it.**

- Use it to answer a `sudo` password prompt or a login prompt in the
  student's console, or to sign in on the student's behalf.
- Type the command that prompts first (with
  `mentor.sendTextToEnvironment`), wait for the prompt to appear, then
  send this request, usually with `pressEnter: true`. Text typed before
  the prompt is ready can be swallowed or echoed to the screen.
- Never ask the student for a credential the mentor can type this way.
  Asking puts a secret into the chat transcript, which this message
  exists to avoid.

For work that doesn't need the student to watch,
`mentor.environmentCommand.request` with `runAsAdministrator` is
usually simpler: the host supplies elevation credentials itself.

Iframes SHOULD only send this when
`host.environmentTypeCredential.response` is present in
`host.init.capabilities`. Standard 10-second client-side timeout
recommendation applies.

### `mentor.environmentKeys.request`
**Optional.** Ask the lab to press a key or key combination in the
console the student has selected: shortcuts such as Win+R, Ctrl+S or
Alt+Tab, and keys such as Tab, Esc, the arrows or the function keys,
which `mentor.sendTextToEnvironment` can't express. The keys go to the
same console text goes to, wherever its focus is.

| Field    | Type     | Notes |
|----------|----------|-------|
| `keys`   | string   | Key names joined with `+`, such as `Ctrl+Shift+Esc`. Case doesn't matter, and order doesn't either: hosts press modifiers first. At most one key besides Ctrl, Alt, Shift and Win. |
| `repeat` | integer? | How many times to press the keys, 1 to 20. Defaults to 1. |

**Key names:** `Ctrl`, `Alt`, `Shift`, `Win`, `Tab`, `Enter`, `Esc`,
`Space`, `Backspace`, `Delete`, `Insert`, `Home`, `End`, `PageUp`,
`PageDown`, `Up`, `Down`, `Left`, `Right`, `F1` to `F12`, the letters
`A` to `Z` and the digits `0` to `9`.

**After the text.** Keys pressed right after text land after that text,
even where the host paces typing, so "type a file name, then Ctrl+S"
works as written.

**Terminals.** In an SSH or PowerShell terminal, the host sends the
characters a terminal reads for the keys: Ctrl with a letter is that
control character (Ctrl+C interrupts), Alt prefixes Esc, the arrows,
Home, End, Delete and the function keys are their escape sequences, and
Shift+Tab is a back-tab. Combinations a terminal has no characters for,
such as anything with Win or Ctrl with an arrow, answer
`"not_supported"`.

There's no mouse: point the student at anything only a click can reach.

### `mentor.viewAs.request`
**Optional.** Ask the lab to treat a lab author as a student for
everything the mentor can see and do, so they can test the lab the way
a student will meet it, or to treat them as the author again. Offer it
when `host.viewAs.response` is in `host.init.capabilities`, for example
as a toggle in the chat, and when the author asks for it in the
conversation.

| Field  | Type                          | Notes |
|--------|-------------------------------|-------|
| `role` | `"student"` \| `"labAuthor"` | The view to switch to. |

**The host enforces the view.** In student view the host gives the mentor
exactly a student's reach: the student's machine catalog, and the
student's rules for commands and credentials, even though the user could
see more. It's not a role the mentor plays. After the switch the host
sends `host.context.update` with the new `userRole` and machines. The
mentor's own conversation still holds what it saw before, which the host
can't take back, so give each view its own conversation: the sample chat
starts a fresh session for the student view, exactly as a new student
would get, and resumes the author's session on the way back. Announce
each switch with `mentor.session.opened` so the host round-trips the
session for the view in use.

**It lasts.** The Skillable lab platform keeps the view for the lab
instance across page reloads, until the author switches back.

### `mentor.showInInstructions.request`
**Optional.** Ask the lab to bring the student's attention to a spot in
the instructions. The host switches to the Instructions view and the
page, scrolls the spot into view, marks it, and puts a caption beside it
with a way back to the mentor. Use it to show where something is,
especially below the visible part of a long page. Like
`mentor.gotoInstructionsPage`, it relies on no DOM selectors: name the
spot the way the student sees it.

| Field        | Type     | Notes |
|--------------|----------|-------|
| `text`       | string?  | A short phrase copied from the page as the student reads it, about 3 to 15 words. Hosts match it ignoring case, whitespace, and the difference between straight and curly quotes or hyphens and dashes, so it may run across bold text, links and inline code. Leave out markdown syntax. |
| `image`      | string?  | An image on the page, by its alt text or its file name. |
| `activity`   | string?  | An activity (a question or task) on the page, by its alias. |
| `page`       | integer? | **Zero-based** page index (same frame of reference as `LabContext.currentPageIndex`). Defaults to the page the student is on. |
| `occurrence` | integer? | Which match to show, from 1, when the target appears more than once. Counts only the matches the student can see. |
| `note`       | string?  | A short caption shown beside the spot, such as why it matters. Plain text: hosts show it as text, never as markup, and may cut it short (the Skillable lab platform keeps 200 characters). |

Name exactly one of `text`, `image` or `activity`.

**Ambiguity is reported, not guessed.** When the target matches more
than one place and `occurrence` is absent, the host changes nothing and
replies `"ambiguous"`. Quote more of the text, or pass `occurrence`.

**The student stays in control.** The mark stays until the student
clicks in the instructions, changes page, follows the caption's link
back to the mentor, or closes the caption. A new request replaces the
previous mark. Hosts honor the student's reduced-motion preference.

**The instructions may take the mentor's place.** Where the mentor and
the instructions share one tab strip, as on the Skillable lab platform,
the mentor is out of sight while the instructions show. Keep the reply
that goes with the pointer short and put the essential words in `note`;
the caption's link brings the student back.

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
| `environment`      | `{ [key: string]: string }`? | Facts about the environment the student has selected. Well-known keys: `name` (display name), `os`, and for virtual machine labs `machine` (the selected VM's alias) and `endpoint` (the selected endpoint's alias, when the student is on an endpoint rather than the VM's own console). Hosts may add free-form keys (shell, cwd, last command, etc.). |
| `machines`         | LabMachine[]?                | The lab's virtual machines the user can see, and each one's endpoints. For a student, a VM is listed when it or one of its endpoints is visible to them; a VM completely hidden from students is left out, so the mentor can't reveal it. For a user who can edit the lab, every VM is listed, as their console shows them. Sent in `host.init` only, since it is fixed for the lab attempt; a `host.context.update` without it means unchanged. Absent outside virtual machine labs. See below. |

All fields are optional. Build your mentor to degrade gracefully when
any one is missing, and to re-ground on every update.

Each `LabMachine`:

| Field            | Type             | Notes |
|------------------|------------------|-------|
| `alias`          | string?          | Stable name for the VM within the lab. The name `mentor.environmentCommand.request` targets it by. |
| `name`           | string?          | Display name, as the student sees it. |
| `os`             | string?          | Operating system, as the author described it. |
| `studentVisible` | boolean          | Whether the student can see this VM. Mentors may act on hidden VMs; say so when you do. |
| `endpoints`      | LabEndpoint[]    | Ways into the VM (SSH, PowerShell, RDP, HTTP, etc.). |

Each `LabEndpoint`:

| Field              | Type    | Notes |
|--------------------|---------|-------|
| `alias`            | string? | Stable name for the endpoint within its VM. |
| `name`             | string? | Display name. |
| `description`      | string? | The author's description, if any. |
| `protocol`         | string? | `ssh`, `powershell`, `rdp`, `vnc`, `telnet`, `http` or `https`. |
| `studentVisible`   | boolean | Whether the student can see this endpoint. |
| `mentorAccessible` | boolean | Whether `mentor.environmentCommand.request` can run commands through it for this user. On the Skillable lab platform, an endpoint the author opened to the mentor is usable on a VM the student knows about, and, for a user who can edit the lab, also through an endpoint visible to admins on a VM hidden from students. |

The catalog carries no addresses or credentials. Hosts may add fields;
ignore ones you don't recognize.

**Timing note.** Some fields — `environment` in particular — depend on
lab subsystems that may not be ready when the lab fires `host.init`. The
host sends `host.init` promptly after `mentor.ready`, possibly after a
short wait for the student's environment selection, with whatever
context is available at that moment, and then delivers the remaining
fields via a follow-up `host.context.update` once they populate. Treat `environment` (and any field) as *may arrive later* — do
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
  "environment": { "name": "Ubuntu Server", "os": "ubuntu-22.04", "machine": "server", "endpoint": null },
  "machines": [
    {
      "alias": "server",
      "name": "Ubuntu Server",
      "os": "ubuntu-22.04",
      "studentVisible": true,
      "endpoints": [
        { "alias": "ssh", "name": "SSH", "description": null, "protocol": "ssh", "studentVisible": false, "mentorAccessible": true }
      ]
    }
  ]
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
  `labInstanceId`, an `authToken`, and a previously-persisted
  `sessionId`.
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

**Embed-only mentors are first-class.** A mentor that does not
implement the postMessage protocol at all is a valid integration. The
lab platform embeds it and otherwise leaves it alone — there is no
requirement that a mentor send `mentor.ready`, and no requirement that
it process any `host.*` message (including `host.init.authToken` and
`host.auth.refresh`). Hosts MUST tolerate mentors that never handshake.

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
