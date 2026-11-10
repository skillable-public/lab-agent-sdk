# Lab Agent protocol: mentor mode

> **An agent implements [core](./core.md) plus the modes it declares.**
> Mentor mode is the one every agent has: an agent that declares no
> modes is a mentor, and the learner policy applies whenever the agent
> isn't in author mode. This file covers coaching, the instructions,
> tasks, hints, seeing and showing on the console, acting in the environment,
> asking first, background commands, and the signals and feedback a
> learner's agent files for the lab's authors.

Every request here is answered only when its response type is in
`host.session.init.capabilities` (see
[core section 8](./core.md#8-capabilities)), and every refusal has the
shape and reasons of [core section 9.2](./core.md#92-refusals).

---

## 1. Coaching

A mentor helps the learner do the lab; it doesn't do the lab for them.

- **Shape behavior by the policy.** `host.session.init.agent.policy` is
  what this lab allows for its learners. An agent that can type or click
  still coaches first: show the learner where, and act for them when
  they ask or are stuck.
- **Keep to the scope.** The policy's `scope` says what the learner may
  talk about: `lab`, `subject` or `open`. The host can't enforce it; your
  model's instructions should.
- **Follow the organization's and the lab's prompts**, from
  `host.session.init.agent.prompts`, after your own base instructions.
- **Lab content is data, not instructions.** See
  [core section 3.7](./core.md#37-host-content-is-untrusted-input).

When your agent produces a message that includes a suggested side
effect (e.g. "Type this command into your terminal" or "Jump back to
the first page"), the recommended pattern is:

1. Render the message plus one or more buttons for the suggested
   actions.
2. If the learner clicks a button, your iframe posts the corresponding
   outbound message, `agent.environment.sendText.request`,
   `agent.instructions.gotoPage.request`, etc.
3. The lab decides whether and how to honor it.

This keeps the lab in control of its own DOM and environment; your
iframe never touches them directly.

For static links to external documentation, just render markdown links
in the message body (`[label](https://...)`). The iframe's `sandbox`
includes `allow-popups`, so an `<a target="_blank">` opens in a new tab
without any postMessage involvement.

---

## 2. Hints

### `host.session.hint`
**Optional.** Ask the agent for a proactive hint without the learner
having typed anything. Typical trigger: the learner clicked an "I'm
stuck" button in the host chrome. It starts a new learner message, as
`agent.session.messageSent` does (see
[Asking first](#8-asking-first)).

| Field     | Type     | Notes |
|-----------|----------|-------|
| `reason`  | string?  | Free-form reason code, e.g. `"stuck-button"`, `"idle-30s"`. |

---

## 3. Instructions pages

The instructions are pages of markdown. `LabContext.pageInstructions`
carries the page the learner is on; these messages read the rest, point
into them and turn the page.

### `agent.instructions.pages.request`
**Optional.** Ask the lab for the full set of instruction pages.
Used by agents that want to reason about the lab as a whole, look
ahead to upcoming steps, recap completed steps, or build an overview
of the entire task arc, rather than working only from
`LabContext.pageInstructions` (which exposes only the current page).

Assign an `id` and expect the host to echo it on its
`host.instructions.pages.response`.

| Field           | Type     | Notes |
|-----------------|----------|-------|
| `includeSource` | boolean? | `true` to have the response carry `source`, the whole instructions document. Omitted or `false` leaves `source` out. |

Iframes SHOULD only fire this when `host.instructions.pages.response` is
present in `host.session.init.capabilities`. Standard 10-second client-side
timeout recommendation applies.

Iframes SHOULD cache the response, instruction content is typically
static for the lab attempt, and re-requesting on every relevant turn
is wasteful. See the [response section](#hostinstructionspagesresponse)
for full caching guidance.

### `host.instructions.pages.response`
**Optional.** Reply to a prior `agent.instructions.pages.request`.
Conveys the full set of instruction pages for the current lab, used by
agents that need to look ahead, look back, or reason over the lab as a
whole rather than just the page the learner is on right now. Companion
to `LabContext.pageInstructions`, which always reflects only the
current page.

| Field    | Type           | Notes |

| Field    | Type           | Notes |
|----------|----------------|-------|
| `pages`  | LabPage[]      | Ordered array of instruction pages for the lab. Index `i` of the array corresponds to `LabContext.currentPageIndex` value `i`. |
| `source` | string?        | The whole instructions document as one markdown string, the text the instructions editor saves, page breaks and any YAML header (which no page shows) included. Sent only when the request asks for it with `includeSource: true`. `null` when the host has none. |

Each `LabPage` object:

| Field           | Type     | Notes |
|-----------------|----------|-------|
| `index`         | integer | Zero-based page index. Matches `LabContext.currentPageIndex` semantics. Provided explicitly so consumers can verify ordering rather than rely on array position. |
| `title`         | string? | Page heading, if the page has one. Same field shape as `LabContext.pageTitle`. `null` or omitted for pages with no heading. |
| `instructions`  | string  | The page's markdown source, or the text the page shows when the host can't give the source. Same rules as `LabContext.pageInstructions`. |
| `includes`      | string[] | The names of the includes expanded into `instructions`, nested ones too. Empty when there are none. |
| `generated`     | boolean  | `true` when `instructions` holds generated content. |
| `tasks`         | LabTask[]? | The page's tasks as the learner sees the rendered page, in order, after its includes are expanded and with any part hidden from the learner, such as a section shown only for another value of a lab variable, left out. A collapsed part's tasks count, as the learner can open it. Empty when the page has none; omitted by a host that doesn't list them. |

Each `LabTask` object:

| Field     | Type    | Notes |
|-----------|---------|-------|
| `number`  | integer | The task's place among the page's `tasks`, from 1, as `agent.tasks.check.request` takes it in `taskNumber`. |
| `text`    | string  | The task's own line as the page reads it, without any tasks nested under it, as `host.tasks.changed` gives it. |
| `checked` | boolean | `true` when the task is ticked. |

The `LabPage` object is extensible, hosts may add fields (e.g. for
embedded resources, video URLs, completion gates) in future versions
of the spec. Iframes should ignore unknown fields.

This payload has no `ok`/`reason` failure wrapper. If a host cannot
serve the full instructions (assessment labs that intentionally hide
upcoming pages, etc.), it should omit `host.instructions.pages.response`
from its `host.session.init.capabilities` array; iframes that key UI on
look-ahead will hide it.

Also validate the response's envelope `id` against your set of
outstanding requests; ignore responses with an unknown or already-
fulfilled `id`.

**Caching.** Lab instructions are typically static for the duration of
a lab attempt, they are authored content, not runtime state. Iframes
SHOULD cache the response and not re-request it. Hosts that mutate
instructions mid-attempt (rare) are expected to push a fresh
`host.session.context` and the iframe can refetch if it wants the
latest body. There is no explicit invalidate message.

**Teaching-style caveat (informational, not normative).** An agent with
full lab instructions has visibility into solutions and gating steps
the learner hasn't reached yet. Agents that adopt a Socratic style
should be deliberate about what they reveal in conversation; this is
the iframe's responsibility, not the host's. Hosts can simply refuse to
advertise the capability if they want to prevent look-ahead entirely.

**Secret hygiene.** Same caution that applies to
`LabContext.pageInstructions` applies here, to `source` as well: instruction bodies may
contain example tokens, shell history snippets, or sample credentials.
Treat the content as untrusted input; redact obvious secrets before
sending to upstream LLMs or persistent storage.

### Includes and generated content

The page a learner sees can hold text the page's own source doesn't:
**includes**, shared documents the source references, and **generated
content**, such as what a Practice Generator wrote for this lab
instance. The Skillable lab platform puts both into `instructions` and
`LabContext.pageInstructions`, where the learner sees them, between
marker comments on lines of their own:

```markdown
<!-- lab-include start: Sign in to Azure -->
...the include's markdown, its own includes expanded the same way...
<!-- lab-include end: Sign in to Azure -->

@lab.AiPractice(...)
<!-- lab-generated start: Practice Generator -->
...what the generator made for this lab instance...
<!-- lab-generated end: Practice Generator -->
```

- An include is expanded once its document has loaded on the page;
  until then the source's include reference stays as written.
- A generated block follows the reference that made it.
- Text inside the markers that would itself read as a marker is
  rewritten to `<!--not-a-marker lab-...`, so the markers always pair.
  Names in markers lose any `--` and `>`.
- Content between markers isn't in the page's source. Say so when you
  quote it, and when you file a finding or a suggestion about it (see
  [author.md](./author.md#6-suggestions) and the finding's `include` and
  `generated` fields in [qa.md](./qa.md#4-findings-and-severity)).

`host.instructions.pages.response.source`, the whole document, is the
source as saved: it holds no expansions and no markers.

### `agent.instructions.image.request`
**Optional.** Ask the host for an image the instructions show or link
as an image, includes and generated content too, so your model can look
at it. The host fetches it the way the page does, with the page's own
credentials, so your agent needs none of the lab's.

| Field | Type   | Notes |
|-------|--------|-------|
| `url` | string | The image's URL exactly as the markdown writes it (relative URLs resolve against the document they are in, as the page resolves them), or the absolute URL the page renders it with. Any other URL is refused. |

Allow at least 30 seconds for the response.

### `host.instructions.image.response`

The host sends the image as `{ ok: true, mimeType, dataBase64 }`, with
`width` and `height` when it has them. This is not the screenshot
shape: a screenshot response carries one `data_url`, a whole
`data:image/...;base64,` URL, while an image response carries the type
and the bare base64 separately. To show it, build the URL yourself:
`data:${mimeType};base64,${dataBase64}`.

| Field        | Type     | Notes |
|--------------|----------|-------|
| `ok`         | boolean  | `true` with the image. |
| `mimeType`   | string?  | `image/png`, `image/jpeg`, `image/webp`, `image/gif` or `image/svg+xml`. |
| `dataBase64` | string?  | The image's bytes, base64-encoded. At most 5 MB before encoding. |
| `width`, `height` | integer? | The image's size in pixels, when the browser could decode it. |
| `reason`     | string?  | When `ok` is `false`: `"not_found"` (the instructions show no image at that URL), `"not_supported"` (it isn't one of the types above), `"too_large"` (over 5 MB), `"timeout"` (no answer within 25 seconds), `"failed"` (anything else, such as an HTTP error). |
| `message`    | string?  | Human-readable detail for `reason`. |

Validate the type and size again before you pass the image on.

### `agent.instructions.gotoPage.request`
**Optional.** Ask the lab to turn the instructions to a specific page.
Equivalent to the learner clicking Previous / Next enough times to land
on that page. Your agent does not need (and should not assume) any DOM
selectors inside the instructions content.

**It doesn't take the learner's attention unless asked.** By default the
host only turns the page, and the learner stays on what they are looking
at: where the instructions and the agent take turns in the same space,
as on the Skillable lab platform's tab strip, the learner stays with the
mentor. Pass `show: true` to bring the instructions into view on that
page too, such as when the learner asks to see it. To point at a spot on
a page, use `agent.instructions.show.request`.

| Field    | Type     | Notes |
|----------|----------|-------|
| `index`  | integer  | **Zero-based** target page index (same frame of reference as `LabContext.currentPageIndex`). |
| `show`   | boolean? | `true` to bring the instructions into view on the page as well. Defaults to `false`: the page turns and nothing else changes for the learner. |

Iframes SHOULD only send this when `host.instructions.gotoPage.response`
is in `host.session.init.capabilities`. Also needs the policy's
`showOnScreen`.

### `host.instructions.gotoPage.response`
**Optional.** Reply to a prior `agent.instructions.gotoPage.request`.
Says whether the page turned.

| Field     | Type     | Notes |
|-----------|----------|-------|
| `ok`      | boolean  | `true` when the instructions are on the requested page (and in view, if `show` asked for it). |
| `page`    | integer? | When `ok` is `true`: the **zero-based** index of the page the instructions are now on. |
| `reason`  | string?  | Failure category when `ok` is `false`: `"not_allowed"` (the policy's `showOnScreen` is off), `"not_found"` (no page has that index), `"not_supported"` (the host can't turn its instructions' pages), `"failed"` (anything else, including a malformed request). `null` when `ok` is `true`. Receivers must tolerate unknown values. |
| `message` | string?  | Human-readable detail for `reason`, written so a model can act on it. `null` when `ok` is `true`. |

Nothing changes on screen when `ok` is `false`. Hosts advertise this
response in `host.session.init.capabilities` when the lab has
instructions pages to turn and the policy's `showOnScreen` is on.

### `agent.instructions.show.request`
**Optional.** Ask the lab to bring the learner's attention to a spot in
the instructions. The host switches to the Instructions view and the
page, scrolls the spot into view, marks it, and puts a caption beside it
with a way back to the agent. Use it to show where something is,
especially below the visible part of a long page. Like
`agent.instructions.gotoPage.request`, it relies on no DOM selectors: name the
spot the way the learner sees it.

| Field        | Type     | Notes |
|--------------|----------|-------|
| `text`       | string?  | A short phrase copied from the page as the learner reads it, about 3 to 15 words. Hosts match it ignoring case, whitespace, and the difference between straight and curly quotes or hyphens and dashes, so it may run across bold text, links and inline code. Leave out markdown syntax. |
| `image`      | string?  | An image on the page, by its alt text or its file name. |
| `activity`   | string?  | An activity (a question or task) on the page, by its alias. |
| `page`       | integer? | **Zero-based** page index (same frame of reference as `LabContext.currentPageIndex`). Defaults to the page the learner is on. |
| `occurrence` | integer? | Which match to show, from 1, when the target appears more than once. Counts only the matches the learner can see. |
| `note`       | string?  | A short caption shown beside the spot, such as why it matters. Plain text: hosts show it as text, never as markup, and may cut it short (the Skillable lab platform keeps 200 characters). |

Name exactly one of `text`, `image` or `activity`.

**Ambiguity is reported, not guessed.** When the target matches more
than one place and `occurrence` is absent, the host changes nothing and
replies `"ambiguous"`. Quote more of the text, or pass `occurrence`.

**The learner stays in control.** The mark stays until the learner
clicks in the instructions, changes page, follows the caption's link
back to the agent, or closes the caption. A new request replaces the
previous mark. Hosts honor the learner's reduced-motion preference.

**The instructions may take the agent's place.** Where the agent and
the instructions share one tab strip, as on the Skillable lab platform,
the agent is out of sight while the instructions show. Keep the reply
that goes with the pointer short and put the essential words in `note`;
the caption's link brings the learner back.

### `host.instructions.show.response`
**Optional.** Reply to a prior `agent.instructions.show.request`.
Says whether the lab is now showing the spot.

| Field     | Type     | Notes |
|-----------|----------|-------|
| `ok`      | boolean  | `true` when the lab switched to the page, scrolled the spot into view and marked it. |
| `reason`  | string?  | Failure category when `ok` is `false`: `"not_found"` (no such page or target, or `occurrence` is past the last match), `"ambiguous"` (the target matches more than one place and no `occurrence` was given), `"not_visible"` (the target is in a part of the page the learner hasn't opened, such as a collapsed hint), `"not_supported"` (the host can't point into its instructions), `"failed"` (anything else, including a malformed request). `null` when `ok` is `true`. Receivers must tolerate unknown values. |
| `message` | string?  | Human-readable detail for `reason`, written so a model can act on it. `null` when `ok` is `true`. |

Nothing changes on screen when `ok` is `false`. Hosts that can point
into their instructions advertise this response in
`host.session.init.capabilities`.

---

## 4. Tasks

### `agent.tasks.check.request`
**Optional.** Ask the lab to check off a task in its instructions, or
uncheck it, the same as the learner ticking its box. On the Skillable
lab platform this records the learner's progress, and the lab's task
rules apply, such as tasks having to be completed in order.

| Field     | Type     | Notes |
|-----------|----------|-------|
| `task`    | string?  | A phrase copied from the task's text, matched the way `agent.instructions.show.request` matches `text`. Quote enough to tell the task from the others on the page. Required unless `taskNumber` is given. |
| `taskNumber` | integer? | Instead of `task`: the task's `number` among the page's `tasks` in `host.instructions.pages.response`. Takes precedence over `task`. |
| `page`    | integer? | **Zero-based** page index. Defaults to the page the learner is on. |
| `checked` | boolean? | `false` to uncheck the task. Defaults to `true`. |

Check a task only once you have confirmed it is done, for example from a
screenshot or a background command, whoever did the work. A task the
mentor checks this way sends no `host.tasks.changed`; one the learner
ticks does. Hosts refuse
rather than guess: a quote matching several tasks is `"ambiguous"`, and
in a lab that requires tasks in order, a task with unchecked ones before
it is refused, so check tasks in order.

### `host.tasks.check.response`
**Optional.** Reply to a prior `agent.tasks.check.request`.

| Field     | Type     | Notes |
|-----------|----------|-------|
| `ok`      | boolean  | `true` when the task is now checked (or unchecked, as asked), including when it already was. |
| `reason`  | string?  | Failure category when `ok` is `false`: `"not_found"` (no such page, no task matches, or the page has no task with that `taskNumber`), `"ambiguous"` (the quote matches more than one task), `"not_visible"` (the task is in a part of the page the learner hasn't opened), `"not_supported"` (the lab has no instructions), `"failed"` (anything else, including a lab that requires tasks in order refusing a task while earlier ones are unchecked). `null` when `ok` is `true`. Receivers must tolerate unknown values. |
| `message` | string?  | Human-readable detail for `reason`, written so a model can act on it. `null` when `ok` is `true`. |

Hosts that can check tasks advertise this response in
`host.session.init.capabilities`, whether or not the current instructions have
any, since `host.session.init` can go out before they render; a lab without
tasks answers `"not_found"`.

### `host.tasks.changed`
**Optional.** Tells the agent that the learner ticked or unticked a
task in the instructions, once the lab's task rules have settled it.
Not sent for a task the agent checked with
`agent.tasks.check.request`, and only after `agent.session.ready`. With no
envelope `id` of its own.

| Field     | Type     | Notes |
|-----------|----------|-------|
| `text`    | string   | The task's own line as the page reads it, without any tasks nested under it. |
| `checked` | boolean  | `true` when the task is now ticked. |
| `page`    | integer  | **Zero-based** index of the page the task is on. |

An agent guiding the learner through tasks they tick themselves can
take a tick as the cue to confirm that step and move on.

**Secret hygiene.** Same caution that applies to
`LabContext.pageInstructions` applies to `text`: a task line may
contain sample credentials. Redact obvious secrets before sending it
to upstream LLMs or persistent storage.

---

## 5. Activities, as the learner meets them

Activities are the lab's questions and checks, referenced in the
instructions as `@lab.Activity(alias)`. A learner's agent may list them
as the learner sees them (policy `activities` at `question`) with
`agent.activities.list.request`, described in
[author.md](./author.md#3-activities). It never answers or evaluates them:
that would be doing the learner's quiz.

### `host.activities.completed`
**Optional.** Tells the agent that the learner completed one of the
lab's activities, such as answering a question or running a check. Not
sent for a check the agent ran itself with
`agent.activities.evaluate.request`, which answers its request instead,
and only after `host.session.init`. With no envelope `id` of its own.

| Field    | Type     | Notes |
|----------|----------|-------|
| `alias`  | string?  | The activity's alias, as instructions reference it with `@lab.Activity(alias)`. `null` when the activity has none. |
| `passed` | boolean? | `true` when the answer or check passed, `false` when it didn't. `null` for an activity with no right answer. |

An agent guiding the learner can take a passed activity as the cue to
confirm that step and move on, and a failed one as the cue to help.

---

## 6. Seeing the console

Gated by the policy's `screenshots`.

### `agent.environment.screenshot.request`
**Optional.** Ask the lab to capture and return an image of the current
lab environment (a VM screen, a remote-controller framebuffer, etc.).
Typical trigger: the learner clicks a "share screenshot" affordance in
the chat composer so the agent can reason over the visual state.

A screenshot is always an image, on any console, a terminal included.
To read a terminal, prefer
[`agent.environment.screenText.request`](#agentenvironmentscreentextrequest),
which is exact and cheaper; take a screenshot of a terminal when its
colors or layout matter.

The host correlates the response by echoing the envelope `id` of this
request on its `host.environment.screenshot.response`. Always assign an
`id` so concurrent requests don't get mixed up.

| Field    | Type    | Notes |
|----------|---------|-------|
| `region` | object? | `{ x, y, width, height, screenshotWidth, screenshotHeight }`: only this part of the console's screen, its top left corner and size on the latest screenshot, kept on it, and that screenshot's size. See [Screenshots of a region](#screenshots-of-a-region). |
| `overview` | boolean? | With `region`: also the whole screen, small. Defaults to `false`. |

`payload` may be `{}` or omitted for the whole screen.

Iframes SHOULD only show the screenshot affordance when
`host.environment.screenshot.response` is present in
`host.session.init.capabilities`. Iframes SHOULD apply a client-side timeout
(10 seconds is a reasonable default) and surface a failure if no
response arrives.

### `host.environment.screenshot.response`
**Optional.** Reply to a prior `agent.environment.screenshot.request`.
The host correlates request/response by echoing the request's envelope
`id` on the response.

The payload uses `snake_case` field names to match its `snake_case`
`reason` enum values; this is a localized exception to the otherwise
`camelCase` payload convention used elsewhere in the spec, kept this
way so a single payload doesn't mix conventions.

| Field      | Type                  | Notes |
|------------|-----------------------|-------|
| `ok`       | boolean               | `true` iff the host produced image data. |
| `data_url` | string?               | Data URL (`data:image/<format>;base64,…`) when `ok` is `true`; `null`/omitted otherwise. The host picks the mime type, PNG, JPEG, and WebP are all fine. |
| `reason`   | string?               | Machine-readable failure category. `null` on success. See enum below. Receivers must tolerate unknown values. |
| `message`  | string?               | Optional human-readable detail (logging / tooltips). |
| `region`   | object?               | With a `region` asked for, when `ok` is `true`: the part shown, `{ x, y, width, height }` in pixels of the console's screen. |
| `screenWidth`, `screenHeight` | integer? | With `region`: the console screen's size in pixels. |
| `overview` | object? | With `overview` asked for: `{ data_url, width, height }`, the whole screen at an eighth of its size, at least 160 pixels wide. |

`reason` enum (extensible):

- `"not_supported"`, the lab environment cannot produce screen data at all (e.g., a non-VM lab, a remote-controller type without screen-capture support). Steady-state condition; the iframe should consider the capability unavailable for the rest of the session.
- `"not_available"`, the lab supports screen data but cannot produce it right now (e.g., no target selected, no controller, not connected). Transient; retrying later may succeed.
- `"capture_failed"`, the underlying capture call threw. Treat as transient unless it persists.
- `"stale"`, the `region` is on a screenshot that no longer counts. Take a new screenshot of the whole screen and find the region on it.
- `"failed"`, the `region` is malformed.

Hosts that don't implement screenshots at all should omit
`host.environment.screenshot.response` from their
`host.session.init.capabilities` array, that hides the iframe's screenshot
affordance entirely. The `not_supported` reason is for hosts that *do*
generally support screenshots but for which this particular lab /
environment can't produce them.

**Validation.** Before consuming `data_url`:

- confirm the prefix matches `data:image/(png|jpeg|webp);base64,` and
  reject other schemes outright (no `javascript:`, no `text/html`,
  no plain `data:` without an image MIME type);
- apply the decoded-size cap from [Section 3.7](./core.md#37-host-content-is-untrusted-input)
  (10 MB by default) before sending the bytes to your LLM, your
  backend, or persistent storage;
- when rendering in chat, set it via the `src` of an `<img>` element
  created with `document.createElement`, never interpolate the data
  URL into raw HTML or pass it through `innerHTML`.

Also validate the response's envelope `id` against your set of
outstanding requests; ignore responses with an unknown or already-
fulfilled `id`.

### `agent.environment.screenText.request`
**Optional.** Ask the lab for the text on the terminal the learner has
selected: an SSH or PowerShell endpoint, or a VM showing its terminal
console. A terminal's text is smaller than a screenshot of it, and
exact where a model reading an image can misread. [`LabContext.environment.console`](./core.md#10-labcontext) says
`"terminal"` when the selected console is one the host can read this
way.

| Field       | Type     | Notes |
|-------------|----------|-------|
| `lastLines` | integer? | 1 to 500: the last that many lines of the terminal's whole history, output that scrolled off the top included, in place of the live screen. They end at the live screen's last line with anything on it, or the cursor's line, whichever is lower. Leave it out for the live screen. |

`payload` may be `{}` or omitted for the live screen. Same 10-second
client-side timeout recommendation as
`agent.environment.screenshot.request`.

Iframes SHOULD only send this when
`host.environment.screenText.response` is present in
`host.session.init.capabilities`.

### `host.environment.screenText.response`
**Optional.** Reply to a prior `agent.environment.screenText.request`.

| Field          | Type      | Notes |
|----------------|-----------|-------|
| `ok`           | boolean   | `true` when the host read the terminal's text. |
| `reason`       | string?   | Failure category when `ok` is `false`: `"not_supported"` (the selected console isn't a terminal, or the lab has no console), `"not_available"` (nothing is selected, or the terminal isn't connected), `"not_allowed"` (the policy's `screenshots` is off), `"failed"` (`lastLines` isn't 1 to 500). `null` when `ok` is `true`. Receivers must tolerate unknown values. |
| `message`      | string?   | Human-readable detail for `reason`, written so a model can act on it. `null` when `ok` is `true`. |
| `lines`        | string[]? | When `ok` is `true`: the lines on the live screen, or with `lastLines` the lines asked for, top to bottom. A row the terminal wrapped is joined to the one before it, so a long line is one string, and trailing spaces are dropped. |
| `cursor`       | object?   | When `ok` is `true`: `{ line, column }`, where the cursor is on `lines`, both counted from 0. `null` when the cursor isn't on `lines`. |
| `columns`, `rows` | integer? | When `ok` is `true`: the terminal's size, in characters. |
| `scrolledBack` | boolean?  | When `ok` is `true`: `true` when the learner has scrolled back and is looking at earlier output than `lines`. |
| `view`         | object?   | Only when `scrolledBack` is `true`: what the learner sees, `{ lines, rowsBack }`. `lines` are its lines, read the way the response's `lines` are, and `rowsBack` is how many rows above the live screen it starts. The response's `lines` stay the live screen, or the last lines asked for. |
| `fullScreen`   | boolean?  | When `ok` is `true`: `true` when a full-screen program, such as an editor, a pager or a monitor, has the terminal, so `lines` are that program's screen. The shell's screen and history come back when it closes. |

A screenshot of a terminal is still an image, and shows what the
learner sees, scrolled back or not. Read the text for what the terminal
says; take a screenshot when its colors or layout matter.

Hosts advertise this response in `host.session.init.capabilities` when
the lab has virtual machines and the policy's `screenshots` is on.

### `agent.environment.scrollTerminal.request`
**Optional.** Scroll the learner's view of the selected terminal, as
their scroll bar does. It types nothing and needs no screenshot. This
is the way to bring text into the learner's view before marking it
(see [Text on a terminal](#text-on-a-terminal)).

| Field       | Type     | Notes |
|-------------|----------|-------|
| `to`        | string?  | `"bottom"`: back to the live screen. |
| `direction` | string?  | `"up"` or `"down"`, with `rows`. |
| `rows`      | integer? | With `direction`: how many rows to scroll, 1 to 1000, never past the live screen. |

Give either `to` or `direction` and `rows`. Iframes SHOULD only send
this when `host.environment.scrollTerminal.response` is present in
`host.session.init.capabilities`.

### `host.environment.scrollTerminal.response`
**Optional.** Reply to a prior `agent.environment.scrollTerminal.request`.

| Field      | Type     | Notes |
|------------|----------|-------|
| `ok`       | boolean  | `true` when the host scrolled the learner's view. |
| `reason`   | string?  | Failure category when `ok` is `false`: `"failed"` (a malformed request), `"not_supported"` (the selected console isn't a terminal), `"not_available"` (nothing is selected, or the terminal isn't connected), `"not_allowed"` (the policy's `showOnScreen` is off). `null` when `ok` is `true`. Receivers must tolerate unknown values. |
| `message`  | string?  | Human-readable detail for `reason`, written so a model can act on it. `null` when `ok` is `true`. |
| `rowsBack` | integer? | When `ok` is `true`: how many rows above the live screen the learner's view now starts, 0 at the live screen. |

Hosts advertise this response in `host.session.init.capabilities` when
the lab has virtual machines and the policy's `showOnScreen` is on,
since it changes what the learner sees, as a mark does.

### `agent.labClient.screenshot.request`
**Optional.** Ask the lab to capture and return an image of the entire
lab-client UI, instructions pane, title bars, menus, environment
area, the whole frame the learner sees. Companion to
`agent.environment.screenshot.request`, which captures only the
environment surface. Two distinct messages because each has a separate
host implementation and may be independently supported.

Same envelope rules as `agent.environment.screenshot.request`: assign
an `id`, expect the host to echo it on the response. No payload fields
beyond the envelope.

Iframes SHOULD only show the lab-client-screenshot affordance when
`host.labClient.screenshot.response` is present in
`host.session.init.capabilities`. Same 10-second client-side timeout
recommendation applies.

### `host.labClient.screenshot.response`
**Optional.** Reply to a prior `agent.labClient.screenshot.request`.
Same envelope-correlation rule as `host.environment.screenshot.response`
(echo the request's `id`).

Structurally identical to `host.environment.screenshot.response`, same
payload shape, same `reason` enum, same validation rules. The
difference is in *what* the host captures:

- `environmentScreenshot` → the lab environment surface only (VM
  framebuffer, remote-controller target, etc.).
- `labClientScreenshot` → the full lab-client chrome (instructions
  pane, title bars, menus, navigation, environment area, whatever
  the host considers "the entire lab UI as the learner sees it").

Both can be advertised independently. A host may support one and not
the other; the iframe gates the corresponding UI per capability.

| Field      | Type                  | Notes |
|------------|-----------------------|-------|
| `ok`       | boolean               | `true` iff the host produced image data. |
| `data_url` | string?               | Data URL (`data:image/<format>;base64,…`) when `ok` is `true`; `null`/omitted otherwise. |
| `reason`   | string?               | Same enum as `host.environment.screenshot.response`: `"not_supported"`, `"not_available"`, `"capture_failed"`. `null` on success. |
| `message`  | string?               | Optional human-readable detail. |

Same validation and capability-advertisement rules apply (validate the
data URL prefix, apply the decoded-size cap, never interpolate into raw
HTML; omit from `host.session.init.capabilities` if your host can't ever produce
lab-client screenshots).

### `agent.environment.connectionQuality.request`
**Optional.** Ask the lab for the current connection quality between
the host and the lab environment (VM, remote controller, etc.).
Agents use this to help diagnose lag, freeze, and disconnect-class
issues the learner is reporting.

No payload fields beyond the envelope; assign an `id` and expect the
host to echo it on its `host.environment.connectionQuality.response`.

Typical triggers on the iframe side: a tool the agent's model calls
when it judges the connection worth measuring, a `/connection` slash
command for manual checks, or, for an agent without a model, an
automatic check when the learner's message mentions connection-quality
keywords ("slow," "lag," "frozen," etc.). These are sample-agent UX
choices, not spec requirements: the protocol just defines the
request/response.

Iframes SHOULD only fire this when
`host.environment.connectionQuality.response` is present in
`host.session.init.capabilities`. Same 10-second client-side timeout
recommendation applies.

### `host.environment.connectionQuality.response`
**Optional.** Reply to a prior `agent.environment.connectionQuality.request`.
Conveys the current connection quality between the host and the lab
environment (VM, remote controller, etc.), useful for the agent to
help diagnose lag, freezes, and disconnect-class issues the learner
might be reporting.

Payload fields are camelCase (the normal spec convention; the screenshot
payload is the localized snake_case exception).

| Field                | Type                                         | Notes |
|----------------------|----------------------------------------------|-------|
| `latencyMilliseconds` | integer                                     | Most recent measured one-way latency to the environment, in milliseconds. The host decides how it measures (ping, controller round-trip, last network sample, etc.). |
| `quality`            | `"Excellent"` \| `"Good"` \| `"OK"` \| `"Poor"` | Human-readable category derived by the host from the latency (and possibly other signals). The host owns the thresholds. |
| `consoleConnected`   | boolean?                                     | Whether the selected console is connected, as in [`LabContext.consoleConnected`](./core.md#10-labcontext). Latency measures the network, so a good `quality` doesn't mean the console is connected. Absent when the host doesn't know. |

Suggested mapping (the sample host uses these, real hosts may tune
them differently):

- `"Excellent"`, `latencyMilliseconds <= 100`
- `"Good"`, `latencyMilliseconds <= 250`
- `"OK"`, `latencyMilliseconds <= 500`
- `"Poor"`, `latencyMilliseconds > 500`

This payload has no `ok`/`reason` failure wrapper: connection quality
always has a value (a non-responding environment still reports
something, typically `"Poor"` with a high latency). If a host cannot
measure the environment connection at all, it should omit
`host.environment.connectionQuality.response` from its
`host.session.init.capabilities` array rather than return a synthetic value.

Also validate the response's envelope `id` against your set of
outstanding requests; ignore responses with an unknown or already-
fulfilled `id`.

A refusal under the policy answers `{ latencyMilliseconds: null,
quality: "Unknown", reason: "not_allowed", message }`. A host that has
no measurement yet answers `latencyMilliseconds: null` and `quality:
"Unknown"`.

### `agent.environment.reconnect.request`
**Optional.** Ask the host to reconnect the console of the selected
environment, as the user's own reconnect does: for a screen that has
stopped updating, or a console that lost its connection. A terminal's
reconnect opens a new shell, which ends whatever the user had running in
it, so a reconnect is work in the console: it needs `actInEnvironment`, asks first
when the policy does, and counts toward the cap. No payload fields beyond
the envelope.

Iframes SHOULD only send this when `host.environment.reconnect.response`
is present in `host.session.init.capabilities`.

### `host.environment.reconnect.response`
**Optional.** Reply to a prior `agent.environment.reconnect.request`.
`{ ok: true }` says the reconnect started, not that the console is
back: a screen that had stopped updating may still be the same one, and
the host may judge the console connected the whole time. Take a
screenshot once the screen settles to see whether it updates again.
`host.environment.consoleReconnected` follows only when the host had
judged the console disconnected.

Fails with `not_supported` when nothing selected has a console the host
can reconnect, such as a machine reached in another window, and with
`not_allowed` when the policy turns `screenshots` off.

### `host.environment.consoleReconnected`
**Optional.** Tells the agent that the selected console has connected
again. No envelope `id` of its own, and no reply. A console's first
connection after the page loads is not a reconnect and sends nothing.

| Field      | Type    | Notes |
|------------|---------|-------|
| `terminal` | boolean | `true` when the console is a terminal (an SSH or PowerShell endpoint, or a VM showing its terminal console) that opened a session after its first. That is a new shell, so its earlier output, and anything that was running in it, are gone. `false` for any other console that connected again after the host judged it disconnected. |

### `host.environment.consoleResized`
**Optional.** Tells the agent that the selected console has changed
size. No envelope `id` of its own, and no reply. Scaling the console on
the page changes neither size and sends nothing, and another console
coming into view isn't a resize.

| Field      | Type    | Notes |
|------------|---------|-------|
| `terminal` | boolean | `true` when the console is a terminal, so `from` and `to` are in columns and rows. `false` for any other console, so they are in pixels, as a screenshot of it has them. |
| `from`     | object  | `{ width, height }`: the size before. |
| `to`       | object  | `{ width, height }`: the size now. |

What the agent read or saw of the screen before is out of date:
earlier screenshots, and spots on them, no longer count.

---

## 7. Show: marks, tips and tours

Gated by the policy's `showOnScreen`. Marks never act on the console:
they point, and the learner acts.

### Spots on a screenshot
`agent.environment.mouse.request` and `agent.environment.show.request`
name places on the console by where they are on a screenshot from
`agent.environment.screenshot.request`.

- **In the screenshot's pixels.** `x` and `y` count from the top left of
  the screenshot, and `screenshotWidth` and `screenshotHeight` give the
  size of the image the spot was picked on. An agent may scale
  screenshots down before giving them to its model, as long as it keeps
  their shape and sends the size its model saw. The host scales the spot
  to the console's screen. A size whose shape is more than 2% off the
  screen's answers `"failed"`.
- **Against the latest screenshot.** Each screenshot the host returns
  for `agent.environment.screenshot.request` records which console it
  came from and that console's resolution. A spot is read against that
  record, so it answers `"stale"` when there's been no screenshot of the
  selected console since the page loaded, when the learner has switched
  to another console, or when the console's resolution has changed
  since. Take a new screenshot, find the spot on it again, and retry.
- **Before the learner's input.** A spot to click or mark, in
  `agent.environment.mouse.request` or `agent.environment.show.request`,
  also answers `"stale"` once the learner has used the console (mouse,
  keyboard or touch) since the screenshot, since what they did may have moved what the spot
  pointed at. The `message` is "The learner has used the console since
  your screenshot. Take a new one and find the spot on it."
- **Screenshots returned with an action count.** A `screenshot` returned
  with `host.environment.sendText.response`, `host.environment.keys.response`
  or `host.environment.mouse.response` (see [Screenshot after an action](#screenshot-after-an-action)) is
  recorded the same way, and, when it shows the whole screen, becomes
  the latest screenshot.
- **So do screenshots taken for other reasons.** A spot is read against
  the latest screenshot the agent's own page took, for any reason, not
  only one returned to the agent. What a `"changes"` wait measures from
  is set out under `until` in
  [`agent.environment.wait.request`](#agentenvironmentwaitrequest).
- **The screen at its own size.** The Skillable lab platform's
  screenshots are the console's screen at the VM's resolution, whatever
  size it's shown at on the page.

### Screenshots of a region
When you know where to look, such as a dialog's buttons or a status
line, ask for only that part of the screen with a `region` on the
latest screenshot. The image is that part at the screen's full detail,
so it's smaller, and cheaper for a model to read, than the whole screen,
and small text stays legible where scaling the whole screen down would
blur it.

- **Placed like a wait's region.** The region is read against the
  latest screenshot, as the region of
  [`agent.environment.wait.request`](#agentenvironmentwaitrequest) is: it
  answers `"stale"` when there's been no screenshot since the page
  loaded, or the console or its resolution has changed since, but not
  because the learner has used the console.
- **A closer look, not a new frame.** Spots and regions you give after
  it stay in the pixels of the latest screenshot of the whole screen,
  with that screenshot's size as `screenshotWidth` and
  `screenshotHeight`. A spot seen on the closer look maps back as the
  region's corner plus the spot scaled by the region's size over the
  image's. Models trained on computer use expect this, since a zoom
  there keeps the screen's coordinates.
- **With an overview.** `overview: true` (`screenshotOverview: true` on
  an action) also returns the whole screen at an eighth of its size. It
  costs little and shows whether a dialog opened or the screen changed
  outside the region.

### `agent.environment.show.request`
**Optional.** Ask the lab to bring the learner's attention to a spot or
region on the console the learner has selected, or to show a tip over
the console as a whole, or to walk the learner through several of
these in turn as a tour. It's the console's counterpart to
`agent.instructions.show.request`: the lab shows the same kind of
caption, with a way back to the agent.

| Field              | Type     | Notes |
|--------------------|----------|-------|
| `note`             | string?  | A short caption, such as what to click and why. Plain text: hosts show it as text, never as markup, and may cut it short (the Skillable lab platform keeps 200 characters). Required when no spot is given. |
| `x`, `y`           | number?  | A spot to point at, in pixels on the screenshot. With `width` and `height`, the top left of a region. See [Spots on a screenshot](#spots-on-a-screenshot). |
| `screenshotWidth`, `screenshotHeight` | integer? | Required with `x` and `y`, or when any step has a spot: the size in pixels of the screenshot they're on. Not needed otherwise, including for a mark that gives `text`. |
| `width`, `height`  | number?  | The size of a region to outline, on the same screenshot. Both or neither, and only with `x` and `y`. |
| `text`             | string?  | On a terminal only, in place of a spot: text to outline where it shows on the terminal, 1 to 200 characters on one line. See [Text on a terminal](#text-on-a-terminal). |
| `wholeRow`         | boolean? | With `text` only: `true` to mark the whole row of the terminal the text is on, rather than only the text, to point at a line. Defaults to `false`. |
| `toText`           | string?  | With `text` only: mark every whole row from the line with `text` down to the first line at or below it with `toText`, 1 to 200 characters on one line. See [Text on a terminal](#text-on-a-terminal). |
| `style`            | string?  | A mark that covers something, a region or text, only: `"outline"`, a line around it, or `"highlight"`, a light fill over it, as a selection is. Defaults to `"outline"`, and to `"highlight"` for a whole row or rows to `toText`. See [Outline or highlight](#outline-or-highlight). |
| `steps`            | object[]? | A tour: 1 to 10 marks, each `{ note?, x?, y?, width?, height?, text?, wholeRow?, toText?, style? }` with the same rules as a single mark, all on the same screenshot. With `steps`, leave out the top-level `note`, `x`, `y`, `width`, `height`, `text`, `wholeRow`, `toText` and `style`. See [Tours](#tours). |
| `done`             | boolean? | A single mark only: `true` gives the caption a Done button and keeps the mark up while the learner uses the console. See [Marks with Done](#marks-with-done). Ignored with `steps`, since a tour has its own. Defaults to `false`. |
| `action`           | string?  | A single mark only: the note describes the agent's own next action on the console, not something for the learner to do. One of `"keys"` (pressing keys), `"command"` (running a command), `"typing"` (typing text) or `"mouse"` (using the mouse). Hosts may title the caption by the kind of action, and treat a value they don't know as a generic action. Leave it out for a mark or tip meant for the learner. Ignored with `steps`. |

**Three shapes.** With `x` and `y`, the lab marks the spot and hangs the
caption from it. With `width` and `height` as well, it outlines the
region instead. With no spot, the caption is a tip about the screen as
a whole; a tip never answers `"stale"`.

#### Outline or highlight
A mark that covers something, a region or text on a terminal, can give
`style`: `"outline"` draws a line around it, and `"highlight"` lays a
light fill over it, as a selection is. It defaults to `"outline"`, and
to `"highlight"` for a whole row (`wholeRow: true`) or rows down to
`toText`. A whole row with
`"outline"` is drawn as lines above and below the row only, with no
edges at its ends. `style` on a mark that is only a spot, or on a tip,
answers `"failed"`, as does a value other than those two.

#### Text on a terminal
On a terminal, a mark (a single mark or a tour step) can give `text` in
place of `x`, `y`, `width` and `height`. The host finds that text on the
terminal as the learner sees it, scrolled as they have it, and outlines it there, with no
screenshot needed. Where it shows more than once, the host outlines the
lowest match, the newest output.

- **Text the learner can't see now** answers `"failed"`, including
  text that is on the terminal but scrolled out of view, and so does a
  mark that gives both `text` and a spot. Scroll it into view first with
  [`agent.environment.scrollTerminal.request`](#agentenvironmentscrollterminalrequest).
- **The mark follows its text.** As the terminal scrolls, whether the
  learner scrolls it or new output pushes the text up, the mark moves
  with the text. While the text is scrolled out of the learner's view,
  the mark hides, and it shows again on its line when the text scrolls
  back. It ends with `"text_gone"` only once the text is gone: the
  screen was cleared, the line dropped out of the terminal's history,
  or a full-screen program took the terminal.
- **A spot doesn't follow.** On a terminal, a mark placed by a spot
  (`x` and `y`, or a region) ends with `"scrolled_away"` as soon as the
  terminal scrolls, since the spot then shows something else. A tip
  with no spot is unaffected.
- **On a console that isn't a terminal**, a mark with `text` answers
  `"not_supported"`. Check
  [`LabContext.environment.console`](./core.md#10-labcontext) first.
- **A whole row.** With `wholeRow: true` as well, the host marks
  the whole row of the terminal the text is on, to point at a line. It
  follows that line as the terminal scrolls, hides and shows again the
  same way, and ends with `"text_gone"` the same way. `wholeRow` without `text` answers
  `"failed"`.
- **Rows down to more text.** With `toText` as well, the host marks
  every whole row from the line with `text` down to the first line at
  or below it with `toText`, both where the learner can see them now.
  It follows those rows as the terminal scrolls, like any text mark,
  and hides only while all of them are out of view, showing the part in
  view otherwise. It ends with `"text_gone"` once its first line's
  text is gone. `toText` with no line at or below the text that has
  it answers `"failed"`, and so does `toText` without `text`.
- **How many matches.** A single mark's response carries `textMatches`,
  how many times the text shows, so an agent can tell whether it
  outlined the one it meant.

**The learner stays in control.** The mark never blocks the console:
clicks and keys go through it to the VM, except on the caption itself,
which takes the clicks that land on it rather than passing them to
whatever it covers. It goes when the learner uses
the mouse, keyboard or touch in the console or closes the caption, and
when the console changes: another console is selected, it disconnects,
or its resolution changes. Following the caption's link back to the
mentor only opens the agent: the console stays in view beside it, so
the mark stays up.

**A mark announces what the agent is about to do, too.** A mark
without `done` also goes when the agent itself acts on the console,
with mouse, keys, typing or a credential, ending with `"agent_input"`:
mark a spot, then act there, and the mark doesn't outlive the action.
A mark with `done`, and a tour, stay up. To take a mark or tour down
without acting, such as when the agent's own work ends, send
`agent.environment.clear`.
While the page scrolls the spot out of view, the mark hides. A terminal
scrolling its own text is different: see Text on a terminal. The host sends
[`host.environment.markEnded`](#hostenvironmentmarkended) when a single
mark ends, however it ends.

#### Marks with Done
With `done`, a single mark asks the learner to do something and say
when they have, without a round trip through the chat:

- **It stays while the learner works.** Like a tour, it doesn't go
  when the learner uses the console. It ends when they click Done or
  close the caption, when the agent shows another mark or tour, when
  the console changes, when the lab takes it down, and on a terminal
  when its text is gone or the terminal scrolls under its spot.
- **The agent hears how it ended.** `host.environment.markEnded`
  carries `"done"` when the learner clicked Done. Confirm the step
  before going on: Done says the learner thinks they're finished, not
  that they are.
- **Look again before the next mark.** The learner's clicks make the
  screenshot stale (see [Spots on a screenshot](#spots-on-a-screenshot)),
  so take a new one before marking the next spot.

#### Tours
With `steps`, the lab shows a tour: one step at a time in the same
caption, with a count ("2 of 4"), a Back button from the second step,
and Next, or Done on the last step. The learner moves through it at
their own pace, with no round trip to the agent. Each step is a spot,
a region or a tip, as for a single mark, and every step's spot is on
the one screenshot whose size is the top-level `screenshotWidth` and
`screenshotHeight`.

- **Validated whole.** `steps` that aren't an array, are empty, have
  more than 10 marks, or hold a mark that would fail on its own answer
  `"failed"`, as does `steps` sent with a top-level `note`, `x`, `y`,
  `width` or `height` ("Give steps or a single mark, not both."). The
  `"stale"` checks apply when the tour is shown, as for a single mark.
  The response says `ok` once the first step is showing.
- **It stays while the learner works.** Unlike a single mark, a tour
  doesn't go when the learner uses the console, since its steps often
  ask them to click something, nor when they follow its link back to
  the agent to ask about a step. It ends when they press Done or close
  the caption, when the agent shows another mark or tour, and when the
  console changes.
- **The agent hears how it ended.** The host sends
  [`host.environment.tourEnded`](#hostenvironmenttourended) when a tour
  ends, however it ends.
- **And which step the learner is on.** The host sends
  [`host.environment.tourStep`](#hostenvironmenttourstep) as the tour
  opens and each time the learner moves with Next or Back.

**One mark at a time.** A new request replaces the mark or tour on
screen at once, so a mark replaced right after it appears is barely
seen. An agent has three ways to show more than one thing:

- **One mark** for one thing: a spot, a region or a tip.
- **A tour** to walk the learner through several things on the same
  screen, in order. They step through it with Next at their own pace.
- **Separate marks one after another** when the next step depends on
  what the learner does first, such as a dialog that only opens after
  a click: show one, with `done` to hear when the learner has acted on
  it, take a new screenshot, then show the next. Don't send a run of
  single marks back to back.

Hosts label the caption (the Skillable lab platform as a pointer or a
tip from the agent), so the note needn't start with "Tip:". A mark
with `action` is the agent saying what it's about to do, so hosts
may title it apart from a tip: the Skillable lab platform names the
kind of action, such as that the agent is running a command, and
keeps the pointer's label when it has a spot.

### `host.environment.show.response`
**Optional.** Reply to a prior `agent.environment.show.request`.

| Field     | Type     | Notes |
|-----------|----------|-------|
| `ok`      | boolean  | `true` when the lab is showing the mark or tip over the console, or for a tour, its first step. |
| `reason`  | string?  | Failure category when `ok` is `false`: `"stale"` (only when the request names a spot: as for `host.environment.mouse.response`), `"not_available"` (nothing is selected to show anything on), `"not_supported"` (the selected console has no screen to show anything on, or isn't connected, or a mark gives `text` on a console that isn't a terminal), `"failed"` (anything else, including a request with neither a `note` nor a spot, a region off the screenshot, `text` the learner can't see on the terminal now, a mark with both `text` and a spot, `wholeRow` or `toText` without `text`, `toText` not at or below the text, `style` on a spot or a tip, or a `style` it doesn't know, `steps` with a single mark's fields as well, or `steps` that aren't 1 to 10 valid marks). `null` when `ok` is `true`. Receivers must tolerate unknown values. |
| `message` | string?  | Human-readable detail for `reason`, written so a model can act on it. `null` when `ok` is `true`. |
| `textMatches` | integer? | A single mark with `text`, when `ok` is `true`: how many times the text shows on the terminal. The host outlines the lowest. |

Nothing changes on screen when `ok` is `false`. Hosts advertise this
response in `host.session.init.capabilities` when the lab has virtual machines.

### `agent.environment.clear`
**Optional.** Ask the lab to take down the mark or tour the agent has
up on the console, if any. It ends as it would otherwise, with
`host.environment.markEnded` or `host.environment.tourEnded`, and the
reason `"cleared"`. There is no reply, and no payload. A host that
doesn't support it ignores it.

### `host.environment.tourEnded`
**Optional.** Tells the agent that a tour it showed with
`agent.environment.show.request` and `steps` has ended, so it can
pick up where the learner left off. Sent once per tour, with no
envelope `id` of its own. See [Tours](#tours).

| Field       | Type     | Notes |
|-------------|----------|-------|
| `requestId` | string?  | The envelope `id` of the `agent.environment.show.request` that started the tour. `null` when the host doesn't have it. |
| `completed` | boolean  | `true` only when the learner pressed Done on the last step. |
| `reason`    | string   | Why it ended: `"done"` (Done on the last step), `"closed"` (the caption's close button), `"replaced"` (the agent's next mark or tour took its place), `"console_changed"` (another console was selected, it disconnected, or its resolution changed), `"cleared"` (the lab took it down), `"text_gone"` (on a terminal, the step's text is gone), `"scrolled_away"` (on a terminal, it scrolled under the step's spot); see [Text on a terminal](#text-on-a-terminal). Receivers must tolerate unknown values. |
| `step`      | integer  | The step on screen when it ended, from 1. |
| `steps`     | integer  | How many steps the tour had. |

An agent might pick the conversation up when the learner finishes
(`"done"`), offer to show the tour again after `"console_changed"`, once
a new screenshot shows where things are now, say nothing for
`"closed"`, and ignore `"replaced"`, which its own request caused.

### `host.environment.tourStep`
**Optional.** Tells the agent which step of its tour the learner is
on: once when the tour opens, then each time they move with Next or
Back. With no envelope `id` of its own. The first can arrive before the
`host.environment.show.response` that starts the tour. See
[Tours](#tours).

| Field       | Type     | Notes |
|-------------|----------|-------|
| `requestId` | string?  | The envelope `id` of the `agent.environment.show.request` that started the tour. `null` when the host doesn't have it. |
| `step`      | integer  | The step now on screen, from 1. |
| `steps`     | integer  | How many steps the tour has. |

An agent can follow the learner through a tour with these, such as to
watch the console for what each step asks of them.

### `host.environment.markEnded`
**Optional.** Tells the agent that a single mark it showed with
`agent.environment.show.request` (without `steps`) has ended. Sent
once per mark, however it ends, with no envelope `id` of its own.

| Field       | Type     | Notes |
|-------------|----------|-------|
| `requestId` | string?  | The envelope `id` of the `agent.environment.show.request` that showed the mark. `null` when the host doesn't have it. |
| `reason`    | string   | Why it ended: `"done"` (the learner clicked its Done button), `"closed"` (the caption's close button), `"replaced"` (the agent's next mark or tour took its place), `"console_changed"` (another console was selected, it disconnected, or its resolution changed), `"cleared"` (the lab took it down, or the agent did with `agent.environment.clear`), `"student_input"` (the learner used the console, only for a mark without `done`), `"agent_input"` (the agent acted on the console, only for a mark without `done`), `"text_gone"` (on a terminal, its text is gone), `"scrolled_away"` (on a terminal, it scrolled under its spot); see [Text on a terminal](#text-on-a-terminal). Receivers must tolerate unknown values. |

For a mark with `done`, this is how the agent hears that the learner
has done what it asked: `"done"` says they clicked Done, which an agent
should confirm by looking, or with a background command, before going
on. Ignore `"replaced"`, which the agent's own request caused.

---

## 8. Asking first

Keys, the mouse, typed text and credentials act on the console the
learner is using, selecting a console changes which one they see, and
[background commands](#9-background-commands) act on their lab out of
sight. All of them are console actions here.
The policy's `actInEnvironment` decides whether the agent may:

- `off`: every such request is refused with `not_allowed`.
- `on`: they run, up to the action cap below.
- `ask`: the learner is asked first, once per message.

### Asking

With `actInEnvironment` at `ask`, the agent's first console action for each
learner message puts a question up over the console: **Allow once**,
**Allow for this lab** (when the policy's `offerAllowForLab` is `on`)
and **Not now**. The question is the host's own, outside your iframe and
the console, so the agent can't answer it.

- The action that raised the question is refused with `asking`, and so
  is every console action until the learner answers. Nothing you asked
  for runs later: retry once they have answered.
- The host tells you the answer the moment the learner gives it, with
  [`host.environment.actInEnvironmentAnswered`](#hostenvironmenthandsonanswered).
  Don't ask the learner to tell you they have answered: say you'll
  carry on once they allow it, and carry on when the answer comes.
- **Allow once** lets the agent work in the console until the learner
  sends another message.
- **Not now** refuses every console action with `declined` until the
  learner sends another message. Don't ask again in the meantime; help
  them do it themselves.
- **Allow for this lab** stops the question for this lab instance,
  through reloads and resumes, for as long as the policy offers it.
- If the console can't show the question, such as when none is
  selected, the action is refused with `not_allowed`.

Tell the learner what you are about to do before you do it, so the
question doesn't come out of nowhere.

### `host.environment.actInEnvironmentAnswered`
**Optional.** Tells the agent the learner answered the question, as
soon as they do. Sent once per answer, with no envelope `id` of its
own. Like every message the host starts on its own, it is never listed
in `host.session.init.capabilities`, and an agent that doesn't know it
ignores it.

| Field    | Type   | Notes |
|----------|--------|-------|
| `answer` | string | `"allowed"` (**Allow once**), `"allowedForLab"` (**Allow for this lab**, once the host has recorded it) or `"declined"` (**Not now**, or the question's close button). Receivers must tolerate unknown values. |

The answer isn't a learner message: it doesn't refill the cap, and
**Allow once** still holds for the learner's current message. So an
agent whose turn ended while it waited can carry on without the
learner writing: retry the action after `"allowed"` or
`"allowedForLab"`, and after `"declined"` stop trying the console for
this message and help the learner do it themselves. Don't send
`agent.session.messageSent` for such a turn, since no learner message
started it.

### The cap per learner message

The policy's `actionsPerRequest` caps the console actions the agent
takes for one learner message, whatever the learner answered:

- Keys, mouse actions, typed text, credentials, console selections and
  background commands each count as one. Waits, screenshots and marks don't.
- **A learner message** is one the learner sent: send
  `agent.session.messageSent` for each, and a hint request counts too.
  The host counts it only when the learner clicked or pressed a key
  since the last one, so a script can't refill the cap.
- With a cap set, no console action is allowed before the first learner
  message.
- Past the cap, a console action is refused with `not_allowed`, and
  `message` names the setting. Stop, say what is left to do, and let
  the learner reply.
- No `actionsPerRequest` in the policy means no cap.

### `agent.environment.sendText.request`
**Optional.** Ask the lab to type text into the active lab
environment. This is the canonical agent-driven side effect (e.g.,
"I'll type that command for you"). The lab decides where the text goes
(the focused input, the active terminal, etc.); your iframe does not
select a target.

On Spark consoles, the Skillable lab platform types text of up to 200
characters as key presses, about ten a second. Longer text, which would
take a long time to type, goes in as a clipboard paste, with its line
breaks as CRLF, where the console shares the clipboard with the learner,
and as key presses where it doesn't. Either way it queues behind input sent before it, the input
sent after it waits for it, and it never replaces, and is never
replaced by, other input. Other consoles take it the way they take
typed text today.

| Field        | Type     | Notes |
|--------------|----------|-------|
| `text`       | string   | Text to type. |
| `screenshot` | boolean? | `true` to get the screen back with the response, once it settles after the text. See [Screenshot after an action](#screenshot-after-an-action). Defaults to `false`. |

The host answers once the text has gone out to the console, after any
input queued ahead of it, so a long text typed as key presses takes a
while to answer. Set the iframe-side timeout to 10 seconds plus about
0.3 seconds per character, plus 10 seconds for each text or paste
queued ahead of it, and add 30 seconds when you ask for `screenshot`.

**Delivered isn't done.** `ok: true` means only that the text was
delivered to the console's keyboard input. It says nothing about where
the focus was, whether the text landed where you meant, or whether it
did what you meant: it may have gone into another window, been typed
before a prompt was ready, or run a command that failed. Look before you
tell the learner something is done: ask for `screenshot`, or send
`agent.environment.screenshot.request`, and check the screen.

**Security note.** Skillable is ultimately responsible for what reaches
the environment. Assume the lab will not auto-execute your text but
will type it for the learner to review. Do not use this channel to
attempt to escape the lab.

Iframes SHOULD require explicit user action before posting
`agent.environment.sendText.request`, render a button, "Insert" affordance,
or preview-and-confirm step rather than typing straight from an LLM
response. Hostile lab content (see
[Section 3.7](./core.md#37-host-content-is-untrusted-input)) that successfully
prompt-injects your model can otherwise turn this channel into
auto-typed input on the learner's behalf.

Iframes SHOULD only send this when `host.environment.sendText.response`
is in `host.session.init.capabilities`. Also needs the policy's
`actInEnvironment` above `off`, and counts toward the cap.

### `host.environment.sendText.response`
**Optional.** Reply to a prior `agent.environment.sendText.request`.

| Field        | Type     | Notes |
|--------------|----------|-------|
| `ok`         | boolean  | `true` when the host delivered the text to the console's keyboard input. It says nothing about where the text landed or what it did; see **Delivered isn't done** above. |
| `sent`       | integer? | When `ok` is `true`: how many characters of `text` the host delivered. |
| `cutShort`   | boolean? | `true` when the console gave up before all of `text` went in, so only its start may be there: look at the screen and type what's missing. Absent otherwise, including from a host that answers before the typing is done. |
| `reason`     | string?  | Failure category when `ok` is `false`: `"not_allowed"` (the policy's `actInEnvironment` is off, or the agent is past the cap, and `message` names the setting), `"asking"` (the learner is being asked first; see [Asking](#asking)), `"declined"` (the learner said **Not now**), `"not_available"` (nothing is selected to type into, or the console disconnected before the text went out), `"not_supported"` (the selected console can't take typed text, such as a web endpoint), `"failed"` (anything else, including empty `text`). `null` when `ok` is `true`. Receivers must tolerate unknown values. |
| `message`    | string?  | Human-readable detail for `reason`, written so a model can act on it. `null` when `ok` is `true`. |
| `screenshot` | object?  | Only when the request asked for `screenshot` and `ok` is `true`: the screen after the text, as described under [Screenshot after an action](#screenshot-after-an-action). |
| `terminal`   | object?  | On a terminal, when `ok` is `true`: `{ lineBefore, line, echoed?, fullScreen? }`. See **On a terminal** below. |

**On a terminal.** When the selected console is a terminal
([`LabContext.environment.console`](./core.md#10-labcontext) is
`"terminal"`), the response says what the text did there:

- `lineBefore`: the line the cursor was on as the typing began, usually
  the prompt.
- `line`: the line the cursor is on after it.
- `echoed`: whether the first line typed showed up on the terminal
  within about a second, judged on the line the typing went onto,
  wherever output has since scrolled it, and on the shell's screen even
  when a full-screen program then took the terminal. It never shows at
  hidden input, such as a password prompt, so `false` there means the
  text went into that prompt. Left out when the first line typed is
  blank.
- `fullScreen`: present only when a full-screen program took the
  terminal (`true`) or gave it back (`false`) between just before the
  input and the report. See `fullScreen` in
  [`host.environment.screenText.response`](#hostenvironmentscreentextresponse).

A host that can tell when the console has typed the text answers once it
has, or has given up, and sets `cutShort` when it gave up partway. It
answers within the time the request allows either way, without
`cutShort` when the typing is still going.

Nothing is typed when `ok` is `false`. Hosts advertise this response in
`host.session.init.capabilities` when the lab has a console to type
into and the policy's `actInEnvironment` isn't `off`.

### `agent.environment.typeCredential.request`
**Optional.** Ask the lab to type one of the lab's credentials, a user
name or a password, into the console the learner currently has
selected. The host types it the way it types
`agent.environment.sendText.request` text, except that a credential always
goes as key presses, never through the clipboard, whatever its length,
then presses Enter if asked. The
iframe names which credential it wants; the host looks up the value and
types it, so the value never reaches the iframe, the agent's backend
or its model.

| Field        | Type                         | Notes |
|--------------|------------------------------|-------|
| `credential` | `"username"` \| `"password"` | Which credential to type. |
| `machine`    | string?                      | Alias of the VM whose credentials to type (`LabContext.machines[].alias`). When only `endpoint` is named, defaults to the VM the learner has selected (the selected endpoint's VM when an endpoint is selected). See below for when neither is named. |
| `endpoint`   | string?                      | Alias of an endpoint on that VM, to type that endpoint's credentials. When `machine` is named and `endpoint` is not, the host types the VM's own credentials. See below for when neither is named. |
| `pressEnter` | boolean?                     | Press the console's own Enter key after typing. Defaults to `false`. Some consoles end every typed line with Enter anyway (for example a Telnet console), and hosts don't add a second one there. |

**Whose credential.** With neither `machine` nor `endpoint` named, the
host types the credentials of what the learner has selected: the
selected endpoint's if an endpoint is selected, otherwise the selected
VM's. Naming either one switches to explicit targeting: `machine`
defaults to the selected VM (the selected endpoint's VM when an
endpoint is selected), and the host types an endpoint's credentials
only when `endpoint` is named, otherwise the VM's own.

`machine` and `endpoint` choose *whose* credential is typed, not where
it goes: the host always types into the console the learner has
selected, like `agent.environment.sendText.request`. Typing another VM's
password into the selected console is legitimate, for example to answer
an `ssh` prompt for that VM. When the selected target can't be typed
into (for example a web endpoint), the host replies `ok: false` with
reason `"not_available"`.

The host decides which credentials it is willing to type and replies
`ok: false` with reason `"failed"` for any it won't. A host may refuse
the credentials of VMs or endpoints hidden from the learner. The
Skillable lab platform types a VM's credentials only when the VM is
visible to the learner, an endpoint's credentials only when the endpoint
is visible to the learner or `agentAccessible`, and never anything
belonging to a VM that is completely hidden from the learner. For a
user who can edit the lab, such as an author building it, it types
what that user's console shows: every VM's credentials, and those of
endpoints visible to admins.

**The value stays in the host.** Neither the request nor
`host.environment.typeCredential.response` carries the credential, and a
host MUST NOT put it in `message`. An agent that needs to know whether
the credential worked looks at the result (a screenshot, or a command
that checks), not at the value.

**Type a password only at a prompt that hides it.** The host types the
value as if the learner had, so whatever the console echoes stays on
screen and shows in any later screenshot. Typed at a password prompt
(`sudo`, `ssh`, a sign-in screen), nothing is echoed; typed into a
shell, an editor or a visible text field, the password is shown to the
learner and to any screenshot the agent takes. Wait for the prompt
before asking for the password.

**Using it.**

- Use it to answer a `sudo` password prompt or a login prompt in the
  learner's console, or to sign in on the learner's behalf.
- Type the command that prompts first (with
  `agent.environment.sendText.request`), wait for the prompt to appear, then
  send this request, usually with `pressEnter: true`. Text typed before
  the prompt is ready can be swallowed or echoed to the screen.
- Never ask the learner for a credential the agent can type this way.
  Asking puts a secret into the chat transcript, which this message
  exists to avoid.

For work that doesn't need the learner to watch,
`agent.environment.command.request` with `runAsAdministrator` is
usually simpler: the host supplies elevation credentials itself.

Iframes SHOULD only send this when
`host.environment.typeCredential.response` is present in
`host.session.init.capabilities`. Standard 10-second client-side timeout
recommendation applies.

Also needs the policy's `typeCredentials`.

### `host.environment.typeCredential.response`
**Optional.** Reply to a prior `agent.environment.typeCredential.request`.
Says whether the host typed the credential. The payload never carries
the credential itself.

| Field     | Type     | Notes |
|-----------|----------|-------|
| `ok`      | boolean  | `true` when the host typed the credential (and pressed Enter, if asked). It says nothing about whether the prompt accepted it; take a screenshot or check the environment to find out. |
| `reason`  | string?  | Failure category when `ok` is `false`: `"not_supported"` (the host or this environment can't type credentials), `"not_available"` (nothing is selected to type into, the selected target can't be typed into, such as a web endpoint, or there is no VM or endpoint with the requested alias), `"failed"` (anything else, including a credential the host won't type for that VM or endpoint, or one the lab doesn't define). `null` when `ok` is `true`. Receivers must tolerate unknown values. |
| `message` | string?  | Human-readable detail for `reason`. `null` when `ok` is `true`. Never contains the credential. |
| `terminal` | object? | On a terminal, when `ok` is `true`: `{ lineBefore, echoed?, fullScreen? }`, as in [`host.environment.sendText.response`](#hostenvironmentsendtextresponse). Never `line`, which could show the credential. `echoed: true` means the credential showed on the terminal, so it went somewhere other than a prompt that hides it. |

Hosts advertise this response in `host.session.init.capabilities` only when at
least one of the lab's credentials can be typed: the host can type into
the lab environment and some VM or endpoint has a credential it is
willing to type.

Also validate the response's envelope `id` against your set of
outstanding requests; ignore responses with an unknown or already-
fulfilled `id`.

### `agent.environment.keys.request`
**Optional.** Ask the lab to press a key or key combination in the
console the learner has selected: shortcuts such as Win+R, Ctrl+S or
Alt+Tab, and keys such as Tab, Esc, the arrows or the function keys,
which `agent.environment.sendText.request` can't express. The keys go to the
same console text goes to, wherever its focus is.

| Field    | Type     | Notes |
|----------|----------|-------|
| `keys`   | string   | Key names joined with `+`, such as `Ctrl+Shift+Esc`. Case doesn't matter, and order doesn't either: hosts press modifiers first. At most one key besides Ctrl, Alt, Shift and Win. |
| `repeat` | integer? | How many times to press the keys, 1 to 20. Defaults to 1. |
| `screenshot` | boolean? | `true` to get the screen back with the response, once it settles after the keys. See [Screenshot after an action](#screenshot-after-an-action). Defaults to `false`. |
| `waitUntil` | object? | `{ until, timeoutSeconds?, quietSeconds?, region?, text? }`: wait for the screen to change or settle after the keys, or on a terminal for text to show or the command to finish, before answering and before any screenshot. See [Screenshot after an action](#screenshot-after-an-action). |

**Key names:** `Ctrl`, `Alt`, `Shift`, `Win`, `Tab`, `Enter`, `Esc`,
`Space`, `Backspace`, `Delete`, `Insert`, `Home`, `End`, `PageUp`,
`PageDown`, `Up`, `Down`, `Left`, `Right`, `F1` to `F12`, the letters
`A` to `Z` and the digits `0` to `9`.

**After the text.** Keys pressed right after text land after that text,
even where the host paces typing, so "type a file name, then Ctrl+S"
works as written. Keys and mouse actions go out in the order the requests
arrive. One still waiting behind earlier input is dropped if the console
disconnects before it goes out or, on some consoles, if more text is sent
while it is still waiting behind earlier text; ask for `screenshot` or
`waitUntil` to learn whether it went out. A console takes only so much
waiting input at once: past that, a request answers `"not_supported"`
until it catches up, and presses none of its keys, so it can be sent
again. Where the input waits behind text the host types for the learner,
a request that doesn't fit answers `ok: true` and is reported dropped
instead.

**Terminals.** In an SSH or PowerShell terminal, the host sends the
characters a terminal reads for the keys: Ctrl with a letter is that
control character (Ctrl+C interrupts), Alt prefixes Esc, the arrows,
Home, End, Delete and the function keys are their escape sequences, and
Shift+Tab is a back-tab. Combinations a terminal has no characters for,
such as anything with Win or Ctrl with an arrow, answer
`"not_supported"`.

For anything only a click can reach, use `agent.environment.mouse.request`.

### `host.environment.keys.response`
**Optional.** Reply to a prior `agent.environment.keys.request`.

| Field     | Type     | Notes |
|-----------|----------|-------|
| `ok`      | boolean  | `true` when the host pressed the keys (or queued them behind text or earlier input still going out). It says nothing about what they did; ask for `screenshot`, or take a screenshot, to see. |
| `reason`  | string?  | Failure category when `ok` is `false`: `"stale"` (`waitUntil` has a `region` on a screenshot that no longer matches the console; no keys are pressed), `"not_available"` (nothing is selected to press keys in), `"not_supported"` (the selected console can't take these keys, such as a terminal asked for Win+R, or isn't connected), `"failed"` (anything else, including an unknown key name or a bad `repeat`). `null` when `ok` is `true`. Receivers must tolerate unknown values. |
| `message` | string?  | Human-readable detail for `reason`. `null` when `ok` is `true`. |
| `screenshot` | object? | Only when the request asked for `screenshot` and `ok` is `true`: the screen after the keys, as described under [Screenshot after an action](#screenshot-after-an-action). |
| `waited`  | object?  | Only when the request gave `waitUntil` and `ok` is `true`: how the wait went, as described under [Screenshot after an action](#screenshot-after-an-action). |
| `terminal` | object? | On a terminal, when `ok` is `true`: `{ lineBefore, line, fullScreen? }`, as in [`host.environment.sendText.response`](#hostenvironmentsendtextresponse). `line` is read once the keys, and any `waitUntil`, are done. |

Hosts advertise this response in `host.session.init.capabilities` when the lab
has a console to press keys in.

### `agent.environment.select.request`
**Optional.** Ask the lab to select a virtual machine, one of its
endpoints, or a container, as the user's own pick in the lab does, so
that later screenshots and console actions go to it.

| Field       | Type    | Notes |
|-------------|---------|-------|
| `machine`   | string? | Alias of the VM to select (`LabContext.machines[].alias`). |
| `endpoint`  | string? | With `machine`: the alias of one of that VM's endpoints, to select it rather than the VM's own console. |
| `container` | string? | Name of the container to select, instead of a VM. |

**It changes the user's view.** The selection is the console the user
is looking at, not a separate one for the agent. Say what you are
switching to before you do it, and switch back to `previous` from the
response when you are done, unless the user wants to stay.

Selecting is a console action ([section 8](#8-asking-first)):
the policy's `actInEnvironment` decides, so it can raise the ask-first question,
and it counts toward the cap.

Iframes SHOULD only send this when `host.environment.select.response`
is in `host.session.init.capabilities`. The host may take up to about
30 seconds to answer while the new console connects, so allow 40.

### `host.environment.select.response`
**Optional.** Reply to a prior `agent.environment.select.request`. The
host answers once the new console reports it is connected, as soon as
it is clear the console gives no connection signal, or at about 30
seconds.

| Field       | Type     | Notes |
|-------------|----------|-------|
| `ok`        | boolean  | `true` when what was asked for is now selected. |
| `reason`    | string?  | Failure category when `ok` is `false`: `"not_allowed"` (the policy's `actInEnvironment` is off, the agent is past the cap, or the machine, endpoint or container is hidden from the user the agent helps), `"asking"` and `"declined"` (see [Asking](#asking)), `"not_available"` (the lab isn't ready yet, it has no machine, endpoint or container by that name, or the selection didn't take), `"failed"` (anything else, including a request that names nothing). `null` when `ok` is `true`. Receivers must tolerate unknown values. |
| `message`   | string?  | Human-readable detail for `reason`. `null` when `ok` is `true`. |
| `selected`  | object?  | What is selected now: `{ name, machine, endpoint, console }`, the well-known keys of [`LabContext.environment`](./core.md#10-labcontext). Absent when `ok` is `false`. |
| `previous`  | object?  | What was selected before, in the same shape, to switch back to. `null` when nothing was. |
| `connected` | boolean? | `true` once the new console reports it is connected, `false` when it still reports it isn't at the deadline, `null` when that isn't known: the console gives no connection signal, or hadn't reported by the deadline. |

A hidden machine, endpoint or container is refused only for a user who
can't see it, such as a learner; a lab author seeing hidden machines
may select it. `connected: false` isn't a refusal: the selection stands.
Take a screenshot once the screen settles, or try
`agent.environment.reconnect.request`.

Hosts advertise this response in `host.session.init.capabilities` when
the lab has a console and the policy's `actInEnvironment` is above `off`.

### `agent.environment.mouse.request`
**Optional.** Ask the lab to use the mouse in the console the learner
has selected, at a spot on a screenshot of it: to click what keys can't
reach, such as a button with no shortcut, a tray icon or an item in a
web page.

| Field              | Type     | Notes |
|--------------------|----------|-------|
| `action`           | string   | `"move"`, `"click"`, `"double_click"`, `"triple_click"`, `"right_click"`, `"drag"` or `"scroll"`. |
| `x`, `y`           | number   | Where, in pixels on the screenshot. For a drag, where it starts. See [Spots on a screenshot](#spots-on-a-screenshot). Not needed for a scroll on a terminal. |
| `screenshotWidth`, `screenshotHeight` | integer | The size in pixels of the screenshot `x` and `y` are on. Not needed for a scroll on a terminal. |
| `toX`, `toY`       | number?  | Drag only, and required for it: where the drag ends, on the same screenshot. |
| `direction`        | string?  | Scroll only: `"up"` or `"down"`. Defaults to `"down"`. |
| `amount`           | integer? | Scroll only: how many wheel notches, 1 to 20. Defaults to 1. |
| `checkTarget`      | boolean? | `true` to refuse the action as `"stale"`, sending nothing, when the screen around its spot, or a drag's end, has changed since the screenshot. See **Check the target** below. Defaults to `false`. |
| `reportChange`     | boolean? | `true` to answer with `changedNearSpot`: whether the screen around the spot, or a drag's end, looks different once the screen has briefly settled after the action than just before it went out. A control lighting up on hover counts as a change, so `false`, the action did nothing visible there, is the stronger answer. Left out when the screen there can't be read. Defaults to `false`. |
| `screenshot`       | boolean? | `true` to get the screen back with the response, once it settles after the action. See [Screenshot after an action](#screenshot-after-an-action). Defaults to `false`. |
| `waitUntil`        | object?  | `{ until, timeoutSeconds?, quietSeconds?, region? }`: wait for the screen to change or settle after the action, before answering and before any screenshot. See [Screenshot after an action](#screenshot-after-an-action). |

**Look before and after.** Take a screenshot to find the spot, and look
again after the action to see what it did: set `screenshot`, or take a
screenshot after giving the console a moment (about a second). Without
`screenshot`, the response says only whether the action was done.

**After the text.** Like keys, a mouse action sent right after text
waits for that text to finish typing, and keys and mouse actions go out
in the order the requests arrive, with the same rules for input dropped
before it goes out.

**Check the target.** With `checkTarget: true`, the host first compares
a 24 by 24 pixel patch of the screenshot around the spot, and around a
drag's end, with the live screen. If it has changed beyond a little, the
request answers `"stale"` with the message "The screen around your spot
has changed since your screenshot. Take a new one and find the spot on
it." and nothing is sent. That lets an agent send several clicks on
stable parts of the screen from one screenshot, and stop as soon as one
of them has moved. The comparison is made when the host takes the
request, before input queued ahead of it goes out, so it protects only
actions sent one at a time, each after the previous one's answer. Where the host kept no copy of the screenshot's
screen to compare with, the action goes as it would without
`checkTarget`.

**The learner sees it.** The Skillable lab platform shows a ripple on
the console where the agent clicks: two for a double-click, three for
a triple-click, and one at each end of a drag.

**Keys first.** Where a key or shortcut does the job, prefer
`agent.environment.keys.request`: it doesn't depend on where things are
on the screen. And where the point is for the learner to learn where
something is, show them with `agent.environment.show.request` rather
than clicking it for them.

**Scrolling a terminal.** To scroll a terminal, use
[`agent.environment.scrollTerminal.request`](#agentenvironmentscrollterminalrequest).
`"scroll"` works there too, and needs no `x`, `y` or screenshot size: it scrolls the learner's view of the terminal 3
rows for each notch of `amount`, as their wheel does, never past the
live screen. On other consoles, `x` and `y` stay required.

Consoles with no screen the mouse can reach answer `"not_supported"`:
terminals (SSH and PowerShell), except for `"scroll"`, consoles that aren't connected, and
consoles the learner can only watch at the moment, such as while an
instructor is monitoring the lab or a dialog covers the console.

Also needs the policy's `screenshots`, since spots are on a screenshot.

### `host.environment.mouse.response`
**Optional.** Reply to a prior `agent.environment.mouse.request`.

| Field     | Type     | Notes |
|-----------|----------|-------|
| `ok`      | boolean  | `true` when the host did the mouse action (or queued it behind text or earlier input still going out). It says nothing about what the action did; ask for `screenshot`, or take a screenshot, to see. |
| `reason`  | string?  | Failure category when `ok` is `false`: `"stale"` (the spot, or a `waitUntil` region, is on a screenshot that no longer matches the console, see [Spots on a screenshot](#spots-on-a-screenshot), or, with `checkTarget`, the screen around the spot, or a drag's end, has changed since it; nothing is sent), `"not_available"` (nothing is selected to use the mouse in), `"not_supported"` (the selected console has no screen the mouse can reach, such as a terminal for any action but `"scroll"`, or isn't connected, or the learner can only watch it right now), `"failed"` (anything else, including a bad `action`, a spot off the screenshot, or a screenshot size that can't be the screenshot's). `null` when `ok` is `true`. Receivers must tolerate unknown values. |
| `message` | string?  | Human-readable detail for `reason`, written so a model can act on it. `null` when `ok` is `true`. |
| `screenshot` | object? | Only when the request asked for `screenshot` and `ok` is `true`: the screen after the action, as described under [Screenshot after an action](#screenshot-after-an-action). |
| `waited`  | object?  | Only when the request gave `waitUntil` and `ok` is `true`: how the wait went, as described under [Screenshot after an action](#screenshot-after-an-action). |
| `changedNearSpot` | boolean? | Only when the request gave `reportChange` and `ok` is `true`: whether the screen around the spot changed. Left out when it couldn't be read. |

Hosts advertise this response in `host.session.init.capabilities` when the lab
has virtual machines.

#### Screenshot after an action
When `agent.environment.sendText.request`, `agent.environment.keys.request`
or `agent.environment.mouse.request` sets `screenshot: true` and the
action is taken, the response carries a
`screenshot` of the console once its screen settles: when it has been
still for half a second, or after 3 seconds at most. It saves a separate
`agent.environment.screenshot.request` after every step.

Half a second of stillness can come before a slow app has reacted, such
as a course that takes several seconds to move to its next page. For
those, a keys or mouse request can say what to wait for with `waitUntil`, an object
with the fields of [`agent.environment.wait.request`](#agentenvironmentwaitrequest):
`until` (`"changes"` or `"settles"`, and on a terminal `"text"` or
`"finished"`), `timeoutSeconds`, `quietSeconds`, `region` and `text`.
A wait answers with what the screen shows, so the host ignores
`waitUntil`, as it ignores `screenshot`, while the policy's `screenshots`
is off.
A text, keys or mouse request with `screenshot: true` can also set
`screenshotRegion`, shaped as the screenshot request's `region`, for a
screenshot of only that part of the screen, such as the box the text
went into (see [Screenshots of a region](#screenshots-of-a-region)). On
a keys or mouse request it is placed as the action is taken, so one that
is malformed refuses the whole request with `"failed"`, one on a
screenshot that no longer counts with `"stale"`, and one without
`screenshot: true` with `"failed"`; if the screen changes size before
the capture, the screenshot answers `"stale"`. On a text request it is
placed as the screen is captured, once the text is in, so a bad one
fails only the `screenshot`, with the same reasons, and the text is
still typed.
The host takes the action, waits for that, and only then captures the
screen. A wait until the screen changes also lets the change settle for
half a second, so the screenshot isn't caught mid-transition. A bad
`waitUntil` refuses the whole request with `"failed"`, and a `region` on
a screenshot that no longer counts with `"stale"`, before the action is
taken. The response's `waited` says how the wait went, with the fields
of [`host.environment.wait.response`](#hostenvironmentwaitresponse):
`ok`, `reason` (such as `"timeout"`), `message`, `waitedMs`, for
`"changes"`, `measuredFrom`, and on a terminal, `line`. A wait that times out still returns the
screen, which shows why. After an action, a wait until the screen changes
measures from the screen just before the action went out, so an effect
that came before the wait began still counts; `measuredFrom` is `"now"`.

Text is answered only once it has gone out, so its screenshot starts
then. Where the console queues a keys or mouse action, such as behind
text still being typed, the wait and the screenshot start only once the action has gone
out. It gets 30 seconds to go out, on top of the time the input queued
ahead of it (typed text and pastes) can take. If it is dropped first, or
hasn't gone out by then, the action still answers `ok: true`, and
`waited` and `screenshot` answer `ok: false` with reason `"failed"` and
the message `"The input was dropped before it was sent."` or `"The input
had not been sent after N seconds."`, where N is the seconds actually
waited, without waiting or capturing. An action that hasn't gone out by
then is not sent later. If the learner switches to another
console before the wait or the screenshot is done, the action still
answers `ok: true`, and `waited` and `screenshot` answer `ok: false` with
reason `"not_available"` and the message `"The student switched consoles
before the screen could be watched."`, without watching or capturing the
console now shown; a wait that already finished keeps its outcome.
Because of that wait, set the
iframe-side timeout for a request with `screenshot` or `waitUntil` to
30 seconds plus `timeoutSeconds`, plus about 0.3 seconds per character
of text sent just before it, a margin over the typing rate, and 10 seconds for each text or paste
queued ahead of it, so queued text doesn't time you out first.

| Field      | Type     | Notes |
|------------|----------|-------|
| `ok`       | boolean  | `true` iff the host produced image data. |
| `data_url` | string?  | As in [`host.environment.screenshot.response`](#hostenvironmentscreenshotresponse), and validated the same way. |
| `reason`   | string?  | As in `host.environment.screenshot.response`. `null` on success. |
| `message`  | string?  | Human-readable detail for `reason`. |
| `width`    | integer? | The screenshot's width in pixels, when `ok` is `true`. |
| `height`   | integer? | The screenshot's height in pixels, when `ok` is `true`. |
| `region`, `screenWidth`, `screenHeight` | object?, integer? | With `screenshotRegion`, as in `host.environment.screenshot.response`. |

The host records it like any other screenshot, so spots on it can be
used in the next request (see [Spots on a screenshot](#spots-on-a-screenshot)).
The action's own `ok` and `reason` stand whatever happens to the wait
or the screenshot: a failed capture is `screenshot.ok: false`, not a
failed action.

### `agent.environment.wait.request`
**Optional.** Ask the lab to wait until the screen of the console the
learner has selected changes, or stops changing: for a dialog to open, a
page to load or an install to finish, rather than pausing for a fixed
time and looking. The host answers with `host.environment.wait.response`
as soon as the screen does what was asked, or when time runs out.
Needs `screenshots`, since the answer tells the agent what the screen
shows.

| Field            | Type     | Notes |
|------------------|----------|-------|
| `until`          | string   | `"changes"`: until the screen visibly differs from what it is measured from. That is the latest screenshot any part of the lab page took, for any reason and not only one returned to the agent, if it shows this console, so a change that came before the request answers at once, as does a screen at a different size. Otherwise it is the screen when the wait starts. `"settles"`: until it stops changing for `quietSeconds`. On a terminal only: `"text"`, until `text` shows on the terminal, and `"finished"`, until the command typed last finishes. See **On a terminal** below. |
| `timeoutSeconds` | number?  | The longest to wait, more than 0 and at most 600. Defaults to 10. |
| `quietSeconds`   | number?  | `"settles"`: how long the screen must stay still, more than 0, at most 30 and no more than `timeoutSeconds`. Defaults to 2, or to `timeoutSeconds` when that is shorter. `"finished"`: how long the terminal may stay the same without the prompt before the wait ends as `"stopped"`, at most 30. Defaults to 5. |
| `region`         | object?  | `{ x, y, width, height, screenshotWidth, screenshotHeight }`: watch only this part of the screen, its top left corner and size in pixels of the latest screenshot, kept on it, and that screenshot's size. See **Regions** below. Not with `"text"` or `"finished"`. |
| `text`           | string?  | `"text"` only, and required for it: the text to wait for, 1 to 200 characters. |

**What counts as a change.** The host compares a small grayscale
thumbnail of the screen (about 64 by 40, each pixel the average of the
block it covers), so a blinking cursor or a ticking clock doesn't count
as a change, while a window opening or a page loading does. A busy
progress bar or a playing video keeps the screen changing, so
`"settles"` waits for it to stop.

**Regions.** With `region`, the wait considers only that part of the
screen, such as a Next button turning active, a progress area or a text
area being typed in, and ignores changes elsewhere. The region is
checked and scaled like a region `agent.environment.show.request`
outlines: one off the screenshot answers `"failed"`, and one on a
screenshot that no longer matches the console answers `"stale"` (see
[Spots on a screenshot](#spots-on-a-screenshot)), except that the
learner using the console doesn't make it stale, since that is often
what the wait is for. It is compared in more detail than the whole
screen, and counts as changed once a small patch of it does, however
large the region: a word typed counts. A region too small for that,
such as a checkbox, counts as changed once a share of it does.
A control in it lighting up on hover counts too, so after a click watch
a region away from the spot clicked.
A wait on a region until it changes measures from the latest
screenshot's copy of the region.

**On a terminal.** When the selected console is a terminal
([`LabContext.environment.console`](./core.md#10-labcontext) is
`"terminal"`), the host watches its text rather than its image:

- **Changes and settles compare text.** `"changes"` and `"settles"`
  compare the terminal's text, not screenshots of it. A `region` still
  compares the screenshot. `measuredFrom: "screenshot"` means the
  latest [`host.environment.screenText.response`](#hostenvironmentscreentextresponse)
  read.
- **`"text"`** waits until `text` shows on the terminal.
- **`"finished"`** waits until the command typed last finishes: until
  the shell's prompt it was typed at comes back on a new line. The
  prompt is the text before the cursor on the cursor's line just before
  the agent's latest typing or keys into that terminal. When that line
  is empty, such as keys sent into a command that is still running, it
  is the last shell prompt the host saw on that terminal. Each terminal
  keeps its own, so input into another console doesn't change it. The
  prompt counts as back when one prompt ends with the other, since a
  program can leave what it printed on the line the prompt comes back
  on, or when a prompt for the same shell comes back changed by the
  command, such as after `cd`, `su` or activating a virtual
  environment: a `user@host:path` or `[user@host dir]` prompt for the
  same host, or a PowerShell `PS path>` prompt. It ends early, with
  `ok: false` and reason `"stopped"`, once the terminal stays the same
  for `quietSeconds` without the prompt: the command is waiting for
  input, such as a password, or working without output. Look at the
  terminal's text to tell which. With nothing typed into that terminal
  yet, it answers `"failed"`.
- **After `"stopped"`, it still waits for the shell.** When the last
  `"finished"` wait on that terminal ended `"stopped"`, the next input
  goes to the command that was waiting, and the next `"finished"` wait
  ends only when the prompt that command was typed at comes back. The
  same input prompt showing again, such as `sudo` asking again after a
  wrong password, isn't finished, so that wait ends `"stopped"` again
  once the terminal is quiet.
- **The line it ended on.** The response carries `line`, the line the
  cursor is on as the wait ends.

On a console that isn't a terminal, `"text"` and `"finished"` answer
`"not_supported"`.

Set the iframe-side timeout a little longer than `timeoutSeconds`.

Waiting only watches the screen: the policy never refuses it, and it
doesn't count toward the cap.

### `host.environment.wait.response`
**Optional.** Reply to a prior `agent.environment.wait.request`.

| Field      | Type     | Notes |
|------------|----------|-------|
| `ok`       | boolean  | `true` when the screen did what was asked in time: changed, for `"changes"`, stopped changing, for `"settles"`, showed the text, for `"text"`, or showed the prompt again, for `"finished"`. |
| `reason`   | string?  | Failure category when `ok` is `false`: `"timeout"` (the screen didn't do what was asked within `timeoutSeconds`), `"stopped"` (`"finished"` only: the terminal stayed the same for `quietSeconds` without the prompt), `"stale"` (the `region` is on a screenshot that no longer matches the console; see **Regions** above), `"not_available"` (nothing is selected, or the screen went away while waiting, such as when the learner switched consoles), `"not_supported"` (the selected console has no screen to watch, or `"text"` or `"finished"` on a console that isn't a terminal), `"failed"` (anything else, including bad arguments, and `"finished"` with nothing typed into the terminal yet). `null` when `ok` is `true`. Receivers must tolerate unknown values. |
| `message`  | string?  | Human-readable detail for `reason`, written so a model can act on it. `null` when `ok` is `true`. |
| `waitedMs` | number   | How long the host waited, in milliseconds. |
| `measuredFrom` | string? | For `"changes"`: what the change was measured from, `"screenshot"` (a screenshot, as set out under `until` in [`agent.environment.wait.request`](#agentenvironmentwaitrequest), or on a terminal the latest `host.environment.screenText.response` read) or `"now"` (the screen when the wait began, or, after an action, just before the action went out). Absent for the other values of `until`. Receivers must tolerate unknown values. |
| `line`     | string?  | On a terminal: the line the cursor is on as the wait ends. |

A `"timeout"` isn't an error so much as an answer: the screen stayed as
it was, or kept moving. Take a screenshot to see where things stand.

Hosts advertise this response in `host.session.init.capabilities` when the lab
has virtual machines.

---

## 9. Background commands

Gated by the policy's `runCommands`. A command runs out of the
learner's sight, but it changes their lab, so it is acting in the environment too
([section 8](#8-asking-first)) and counts toward the cap. With
`runCommands` on, the policy's `actInEnvironment` decides:

- `off`: a command is refused with `not_allowed`, and
  `host.environment.command.response` isn't in the capabilities.
- `ask`: the learner is asked first. The command that raised the
  question is refused with `asking` while the host asks, and with
  `declined` after **Not now**.
- `on`: it runs, up to the cap.

### `agent.environment.command.request`
**Optional.** Ask the lab to run a shell command in the active lab
environment, in a background session the learner does not see. This is
the counterpart to `agent.environment.sendText.request`: that one types
into the console the learner is watching and says only whether the text
went out; this one runs out of band and returns the output. Agents use it to inspect the
environment, check the learner's work, and install or configure
software on the learner's behalf.

| Field                | Type     | Notes |
|----------------------|----------|-------|
| `command`            | string   | Shell command. On an `ssh` endpoint the host runs it with bash; on a `powershell` endpoint, with Windows PowerShell. It runs as the endpoint's user. |
| `machine`            | string?  | Alias of the VM to run on (`LabContext.machines[].alias`). Defaults to the VM the learner has selected. |
| `endpoint`           | string?  | Alias of the endpoint to run through, on that VM. It must be `agentAccessible`. When omitted, the host uses the selected endpoint if the agent can use it, otherwise the VM's one agent-accessible endpoint. |
| `runAsAdministrator` | boolean? | Run with elevated privileges (sudo on Linux). The host supplies any credentials elevation needs; the iframe never handles them. A host that can't elevate on an endpoint replies `ok: false` with reason `"not_supported"`. Defaults to `false`. |
| `timeoutSeconds`     | integer? | How long the command may run before the host ends it and replies `"timeout"`. Defaults to 60. Hosts may enforce a minimum and may cap it; the iframe owns choosing a sensible value (see below). |

The agent may target any VM in `LabContext.machines`, not just the
selected one; the selection is context for what the learner is
probably talking about. The host decides how it reaches the endpoint,
and the iframe never supplies addresses or credentials. When the target
can't be resolved (unknown alias, an endpoint without agent access, or
several candidates and none named) the host replies `ok: false` with
reason `"failed"` and a `message` naming the problem. Hosts may also
limit command length and how many commands run at once; keep commands
short and split long scripts into several requests. Commands run non-interactively: anything
that waits for input hangs until `timeoutSeconds`.

**Endpoints only the agent uses.** Every `agentAccessible` endpoint
works in every mode and every run, including one hidden from learners
(`studentVisible: false`); the host doesn't restrict it further. How to
use one is the agent's judgement. In a QA run as written, carry out the
learner's steps the way a learner would, and use endpoints the learner
can't see only to inspect and verify. A fast QA run may use them for
both ([qa.md](./qa.md#as-written-or-fast)).

**Hidden is not secured.** An endpoint hidden from learners is still part
of the lab environment. Authors hide one because it is noise to the
learner, not to make it a backend learners can't reach: endpoints exist
to enable scenarios, such as a shell the agent uses to check the
learner's work. A host keeps such an endpoint out of the learner's
console and closes the obvious ways into it. The Skillable lab platform
sends it to the page with no credentials or address and won't open it
through the console's connect actions. Agent commands still run from the
learner's browser, so a determined learner can reach what the agent's
command can. Secure what can reasonably be secured, and accept the rest:
this is a lab, not a banking system. An endpoint truly closed to the
learner, reached only from the backend, would be a different feature.

**Choosing a timeout (recommended).** A host may place no upper limit on
`timeoutSeconds`, so the iframe is responsible for not waiting longer
than the work warrants:

- Give each command a timeout that fits what it should take: the default
  60 seconds or less for checks and small changes, several minutes for a
  package install, longer only for work known to be slow.
- For work that may run for a long time, such as large installs, updates
  or builds, start it in the background on the VM and check on it with
  short commands, rather than holding one long-running command open.
- When a result is no longer needed, for example because the learner
  stopped the agent or changed course, cancel it with
  `agent.environment.command.cancel` instead of letting it run out.

Iframes SHOULD only fire this when `host.environment.command.response`
is present in `host.session.init.capabilities`. Because commands can run long,
the standard 10-second timeout does not apply: wait at least
`timeoutSeconds` plus a margin. Hosts may start the clock only once the
command is typed, after opening a session to the endpoint, so allow at
least 30 seconds beyond `timeoutSeconds`.

**Trust.** A command runs with the lab user's rights (or the
administrator's, when requested) inside the learner's lab environment.
Hosts SHOULD log every command with the lab instance it ran against.
Agents SHOULD tell the learner what they are about to change before
changing it.

### `agent.environment.command.cancel`
**Optional.** Ask the lab to abort a command started by an earlier
`agent.environment.command.request`, typically because the learner
stopped the agent. Fire-and-forget: the host sends no reply to this
message itself.

| Field       | Type   | Notes |
|-------------|--------|-------|
| `requestId` | string | The envelope `id` of the `agent.environment.command.request` to cancel. |

If that command is still running, the host aborts it, ending it on the
VM, and answers the original request with `host.environment.command.response`:
`ok: false`, reason `"cancelled"`, message `"The command was cancelled."`,
`exitCode: null`. If the command has already finished, or the id is
unknown, the host ignores the cancel; the original request keeps
whatever answer it got. Either way, exactly one response arrives for the
original request, so an iframe can keep waiting on it as usual or stop
waiting as soon as it sends the cancel.

A cancelled command may have done part of its work before it was
ended. Gated by the same capability as the request: iframes SHOULD only
send it when `host.environment.command.response` is present in
`host.session.init.capabilities`.

### `host.environment.command.response`
**Optional.** Reply to a prior `agent.environment.command.request`.
Carries what the command printed and how it exited.

| Field      | Type     | Notes |
|------------|----------|-------|
| `ok`       | boolean  | `true` when the command ran to completion. A command that ran and failed is still `ok: true` with a non-zero `exitCode`. |
| `stdout`   | string   | Standard output. Empty string when there was none or `ok` is `false`. Hosts may truncate very large output, or refuse it with `ok: false` and reason `"failed"`. |
| `stderr`   | string   | Standard error, same rules as `stdout`. Hosts that run commands through a terminal may merge standard error into `stdout` and leave this empty, so don't read an empty `stderr` as "no errors". |
| `exitCode` | integer? | Process exit code when `ok` is `true`; `null` otherwise. |
| `reason`   | string?  | Failure category when `ok` is `false`: `"not_allowed"` (the policy's `runCommands` or `actInEnvironment` is off, or the action cap is reached), `"asking"` and `"declined"` (see [section 8](#8-asking-first)), `"not_supported"` (the active environment can't run commands, or can't run this one as requested, such as elevation on an endpoint that doesn't support it; this applies to the request, not the capability, so later commands may still succeed), `"not_available"` (no environment selected, or it isn't reachable; usually transient, so retrying later may succeed), `"timeout"` (the command outlived `timeoutSeconds`), `"cancelled"` (the iframe cancelled it with `agent.environment.command.cancel` while it was running; the host ended it on the VM, but it may have partly run; `message` is `"The command was cancelled."`), `"failed"` (anything else, including a target that can't be resolved and a command the host refuses, such as one over its length limit or one sent while too many of the lab's commands are already running). `null` when `ok` is `true`. |
| `message`  | string?  | Human-readable detail for `reason`. `null` when `ok` is `true`. |
| `shell`    | string?  | The language the command was run as: `"bash"` or `"powershell"`. Absent when the host doesn't say, or the command was refused before a shell was chosen. A host may not know an endpoint's shell before it connects, so an agent that wrote the command for the other language can see why it failed and rewrite it. Receivers must tolerate unknown values. |

Hosts advertise this response in `host.session.init.capabilities` only for labs
whose environment can run commands (typically virtualization labs with a
reachable guest OS).

Also validate the response's envelope `id` against your set of
outstanding requests; ignore responses with an unknown or already-
fulfilled `id`.

---

## 10. Lab facts

### `agent.lab.variable.request`
**Optional.** Ask the lab for the value of one of its variables, the
values instructions reference with `@lab.Variable(name)` and lab scripts
set. Send it when `host.lab.variable.response` is in
`host.session.init.capabilities`.

| Field  | Type   | Notes |
|--------|--------|-------|
| `name` | string | The variable's name, as in `@lab.Variable(name)`. |

### `host.lab.variable.response`
**Optional.** Reply to a prior `agent.lab.variable.request`.

| Field     | Type     | Notes |
|-----------|----------|-------|
| `ok`      | boolean  | `true` when the host looked the variable up, whether or not it is set. |
| `reason`  | string?  | Failure category when `ok` is `false`: `"failed"` (the request names no variable). `null` when `ok` is `true`. Receivers must tolerate unknown values. |
| `message` | string?  | Human-readable detail for `reason`, written so a model can act on it. `null` when `ok` is `true`. |
| `value`   | string?  | The variable's value. `null` when the variable isn't set, or `ok` is `false`. |

Hosts advertise this response in `host.session.init.capabilities`.

To set a variable, see [author.md](./author.md#5-variables).

### `agent.lab.minutesRemaining.request`
**Optional.** Ask the lab how many minutes are left before it ends.
Send it when `host.lab.minutesRemaining.response` is in
`host.session.init.capabilities`.

No payload fields beyond the envelope; assign an `id` and expect the
host to echo it on its `host.lab.minutesRemaining.response`.

### `host.lab.minutesRemaining.response`
**Optional.** Reply to a prior `agent.lab.minutesRemaining.request`.

| Field     | Type     | Notes |
|-----------|----------|-------|
| `ok`      | boolean  | `true` when the host has the time left. |
| `reason`  | string?  | Failure category when `ok` is `false`: `"failed"` (the time left couldn't be read). `null` when `ok` is `true`. Receivers must tolerate unknown values. |
| `message` | string?  | Human-readable detail for `reason`. `null` when `ok` is `true`. |
| `minutes` | number?  | The lab's minutes left as of the Lab Client's latest timer update, `0` or less when no time is left; for a shared lab, the share's time left. Absent or `null` when `ok` is `false`. |

Hosts advertise this response in `host.session.init.capabilities`.

### `agent.lab.status.request`
**Optional.** Ask whether the lab's environment is ready, and
optionally wait for it to be. Send it when `host.lab.status.response`
is in `host.session.init.capabilities`.

| Field         | Type     | Notes |
|---------------|----------|-------|
| `waitSeconds` | integer? | Absent or `0` answers at once. Otherwise the host answers once the lab is ready, or when `waitSeconds` have passed, whichever is first. Clamped to 0 to 600. |

When waiting, set the iframe-side timeout a little longer than
`waitSeconds`.

### `host.lab.status.response`
**Optional.** Reply to a prior `agent.lab.status.request`.

| Field              | Type     | Notes |
|--------------------|----------|-------|
| `ok`               | boolean  | `true` when the host read the lab's status, ready or not. |
| `reason`           | string?  | Failure category when `ok` is `false`: `"failed"` (the status couldn't be read). `null` when `ok` is `true`. Receivers must tolerate unknown values. |
| `message`          | string?  | Human-readable detail for `reason`. `null` when `ok` is `true`. |
| `ready`            | boolean  | Whether the lab's environment is running, as [`LabContext.labReady`](./core.md#10-labcontext) says. |
| `state`            | string   | `"scheduled"`, `"off"`, `"building"`, `"starting"`, `"running"`, `"saving"`, `"saved"`, `"resuming"`, `"ending"`, or `"busy"` for anything else. Receivers must tolerate unknown values. |
| `consoleConnected` | boolean? | As [`LabContext.consoleConnected`](./core.md#10-labcontext). Left out when nothing is selected, or the host doesn't know. |
| `waitedSeconds`    | integer  | How long the host waited, in seconds. `0` when it answered at once. |
| `timedOut`         | boolean  | `true` when `waitSeconds` passed before the lab was ready. |

A timeout is an answer, not a failure: `ok` stays `true`, and `ready`
and `state` say where the lab is. Ask again to keep waiting.

**Ready is the environment, not the machines.** `ready: true` means the
lab's environment is running. It doesn't mean a machine has finished
booting or that anyone has signed in to it; take a screenshot to see.

`LabContext.labReady` and `host.session.context` tell the agent the
same thing as it changes. This request is for an agent that wants to
ask, or to wait in one call, such as a tool its model calls before
working in the console.

Hosts always advertise this response in
`host.session.init.capabilities`.

---

## 11. Signals and feedback

A learner's agent notices where the lab lets learners down. Signals and
feedback carry that to the lab's authors, who see them in the lab's
inbox. They are only for learners: the host advertises
`host.feedback.signal.response` and `host.feedback.report.response` only
to users who aren't lab authors, and refuses a lab author's, even one
viewing the lab as a learner, with `not_allowed`. An author's findings
go in QA runs instead.

File them silently: they are for the author, not part of the
conversation.

### `agent.feedback.signal.request`

A support signal: where the learner got stuck, instructions that don't
work, or an error the agent couldn't resolve.

| Field      | Type     | Notes |
|------------|----------|-------|
| `category` | string   | `"stuck"`, `"instructionsDoNotWork"` or `"unresolvedError"`. |
| `page`     | integer? | The **zero-based** page the signal is about, 0 to 10000. |
| `issueKey` | string?  | A key you give the issue, the same each time you notice it, so the inbox counts it once: a page as `p` and its zero-based index, or `lab` for the whole lab, then `/` and a short slug of lowercase letters, digits and hyphens, at most 60 characters, such as `p3/az-login-fails`. At most 128 characters. A signal with the key of one already filed in this session updates it, so send the same key again with `helped` once you know whether your help worked. |
| `helped`   | boolean? | Whether your help worked. Omit it until you know. |

The host checks the whole signal and never cuts it, since a cut key
would count as another issue; a signal that doesn't fit is refused
with `failed`. A lab instance holds at most 100 signals; past that,
signals are refused with `too_many`.

### `host.feedback.signal.response`

| Field     | Type     | Notes |
|-----------|----------|-------|
| `ok`      | boolean  | `true` when the signal was stored. |
| `reason`  | string?  | When `ok` is `false`: `"not_allowed"` (not a learner), `"too_many"` (the lab instance holds as many signals as it may), `"failed"` (anything else, including a malformed signal). |
| `message` | string?  | Human-readable detail. |
| `status`  | integer? | The HTTP status of the host's own call, when it got one. Retry only when there is none. |

### `agent.feedback.report.request`

The learner's feedback on the agent, when they give it, such as with a
thumbs up or down.

| Field     | Type     | Notes |
|-----------|----------|-------|
| `helpful` | boolean  | Whether the learner found the agent helpful. Required. |
| `comment` | string?  | The learner's own words. At most 500 characters. |

A lab instance holds at most 50 feedback reports.

### `host.feedback.report.response`

The same fields as `host.feedback.signal.response`.
