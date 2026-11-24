# Lab Agent protocol: author mode

> **An agent implements [core](./core.md) plus the modes it declares.**
> Declare `"author"` in `agent.session.ready` to implement this file.
> Author mode helps lab authors build, configure and fix their lab:
> activities and their definitions, suggested edits and the author's
> decisions on them, variables, activity checks, and working in the
> author's view or a learner's.

Every request here is answered only when its response type is in
`host.session.init.capabilities`, and every refusal has the shape and
reasons of [core section 9.2](./core.md#92-refusals).

---

## 1. When an agent is in author mode

`host.session.init.agent.mode` is `"author"` when all of these hold:

- the agent declared `"author"`;
- the user is signed as `"labAuthor"` (the token's `role`), which the
  Skillable lab platform signs for a user who can edit the lab;
- the lab gives the author a policy (an API launch can ask for learner
  mode, which leaves it out);
- the author hasn't switched to the learner's view.

In author mode `agent.policy` is the author policy, which by default
allows everything, and the capabilities follow it. Out of it the agent
is a mentor, with the learner policy, whoever the user is.

The mentor messages all work in author mode too, under the author
policy, so an author's agent can see, show and work in the console as a
learner's can. Learner [signals and feedback](./mentor.md#11-signals-and-feedback)
are the exception: an author reports what they find as QA findings.

---

## 2. View switching

An author tests their lab the way a learner will meet it by switching
the agent to the learner's view, and back.

**The host owns the switch.** It shows lab authors a two-state
**Author** / **Student** toggle, and the agent learns of every switch
through `host.session.context`, which then carries the new `userRole`,
the machines and tokens of that view, its capabilities and its `agent`
settings. There is no message for the agent to switch views, so don't
draw a toggle of your own; tell an author who asks where the host's
toggle is.

**The host enforces the view.** In the student view the host gives the
agent exactly a learner's reach: the learner's machine catalog, and the
learner's policy, even though the user could see more. It's not a role
the agent plays. The signed `role` claim stays `"labAuthor"` (see
[Section 3.2.2](./core.md#322-the-launch-token)). The agent's own
conversation still holds what it saw before, so an agent should work
only from the new context and not reveal anything the student view
doesn't show.

**It lasts.** The Skillable lab platform keeps the view for the lab
instance across page reloads, until the author switches back. During a
[QA run](./qa.md#9-the-run-badge-and-stops) the toggle is locked.

---

## 3. Activities

Activities are the lab's questions and checks, referenced in the
instructions as `@lab.Activity(alias)`. The policy's `activities` sets
how much of them the agent sees:

| Level | The agent sees |
|---|---|
| `off` | Nothing: `agent.activities.list.request` is refused with `not_allowed`. |
| `question` | Each activity as the learner sees it: its question text and choices, and how its attempts stand. The most a learner's agent gets. |
| `full` | Also each activity's whole definition: answer key, scoring, gating, and the scripts or tests that check it. Only in author mode, for a user who may edit the lab's activities. |

### `agent.activities.list.request`

**Optional.** List the activities on the instructions. No payload
fields. Send it when `host.activities.list.response` is in the
capabilities.

### `host.activities.list.response`

| Field        | Type      | Notes |
|--------------|-----------|-------|
| `ok`         | boolean   | `true` with the list. |
| `level`      | string    | `"question"` or `"full"`: what the list holds. It can be `"question"` under a `full` policy, when the user may not edit the lab's activities. |
| `activities` | object[]  | One entry for each place an activity is drawn on the instructions, in page order. |
| `reason`, `message` | string? | When `ok` is `false`: `"not_allowed"` (the policy's `activities` is `off`) or `"failed"`. |

Each entry:

| Field             | Type      | Notes |
|-------------------|-----------|-------|
| `key`             | string    | `alias#index`: the activity's alias and the index its result is recorded under. Unique in the list. |
| `alias`           | string    | As in `@lab.Activity(alias)`. |
| `id`              | number    | The activity's id. |
| `type`            | string?   | `"multipleChoiceSingleAnswer"`, `"multipleChoiceMultipleAnswer"`, `"shortAnswer"`, `"shortAnswerRegex"`, `"automated"` (a script checks it), `"code"` or `"vision"`. Receivers must tolerate unknown values. |
| `page`            | integer   | **Zero-based** page it is on. |
| `question`        | string?   | The question or task text as the page shows it. |
| `choices`         | object[]  | For a multiple-choice question, `{ id, text }` for each choice as the page shows it. Empty otherwise. |
| `scored`          | boolean   | Whether it counts toward the lab's score. |
| `maxScore`        | number?   | What it scores at most. |
| `answered`        | boolean   | Whether it was already answered or evaluated. |
| `passed`          | boolean?  | Whether it passed, once evaluated. `null` before. |
| `attemptsUsed`    | integer   | Attempts the lab has counted. |
| `attemptsAllowed` | integer?  | Attempts the lab takes. `null` for no limit. |
| `definition`      | object?   | At `"full"` only; see below. |

**The definition**, at `"full"`:

| Field              | Notes |
|--------------------|-------|
| `correctChoiceIds` | The ids of the correct choices. Empty for other types. |
| `textAnswers`      | For a short answer, `[{ text, isRegex, caseSensitive }]`. Empty for other types. |
| `scoring`          | `{ scored, maxScore, partialScore, allowRetry, maxAttempts }`. |
| `gating`           | `{ required, blocksNavigation, blocksNavigationUntilPassed }`. |
| `scripts`          | For a script-checked activity, its enabled scripts in order: `{ language, targetMachineAlias, targetContainer, body }`. The target is the alias of the VM it runs on, or the name of the container; both `null` for a script that runs outside them. |
| `codeTests`        | For a code activity, its enabled tests: `{ name, text, inputs, expectedOutput, scored, scoreValue, secret }`. |
| `visionPrompt`     | For a Vision activity, the prompt it is graded by. |

**During a QA run** the definitions are held back: an entry carries one
only once that activity was answered or evaluated. See
[qa.md](./qa.md#one-submission-per-activity).

### `agent.activities.answer.request`

**Optional.** Answer a question activity the way a learner's click
does: the host fills in the question's inputs on the instructions and
presses its button, so the lab's own grading (correct choices, exact or
regular-expression text, case sensitivity) judges the answer, and the
result is recorded as the learner's. Only in author mode, with the
policy's `activities` above `off` and `evaluateActivities` `on`. A
learner's agent never answers.

| Field       | Type      | Notes |
|-------------|-----------|-------|
| `alias`     | string    | The activity's alias. |
| `choiceIds` | number[]? | For a multiple-choice question: the ids of the choices to pick, from the list. Exactly one for a single-answer question. |
| `text`      | string?   | For a short-answer question: the answer. Cut to what the learner's input takes. |

The host checks the whole answer before it changes anything, and puts
the inputs back as they were when the answer gets no result. Grading can
take a while: allow 5 minutes.

### `host.activities.answer.response`

| Field             | Type     | Notes |
|-------------------|----------|-------|
| `ok`              | boolean  | `true` when the answer was graded, right or wrong. |
| `passed`          | boolean? | Whether it was right. |
| `score`           | number?  | What it scored. |
| `maxScore`        | number?  | What it scores at most. |
| `attemptsUsed`    | integer  | Attempts the lab has counted, this one included. |
| `attemptsAllowed` | integer? | Attempts the lab takes. `null` for no limit. |
| `reason`          | string?  | When `ok` is `false`: `"not_allowed"` (see above), `"not_found"` (no activity with that alias on the instructions), `"not_supported"` (not a question, a question the lab grades only when it is scored, or a preview of the lab), `"already_answered"` (answered and takes no more attempts, or already submitted in this QA run), `"timeout"` (no result within 5 minutes), `"failed"` (anything else, such as a choice id that isn't the question's, or empty text). |
| `message`         | string?  | Human-readable detail. |

### `host.activities.completed`

When the user completes an activity themselves. See
[mentor.md](./mentor.md#hostactivitiescompleted).

---

## 4. Checks

A check is an activity's evaluation: the script, code test or Vision
grading that decides whether the lab's work was done, or the grading of
a question's chosen answer.

### `agent.activities.evaluate.request`
**Optional.** Ask the lab to evaluate an activity (run its check, or
submit a question's chosen answer), the way the learner's button for it
does, and answer with its result. Send it when `host.activities.evaluate.response` is
in `host.session.init.capabilities`.

| Field   | Type   | Notes |
|---------|--------|-------|
| `alias` | string | The activity's alias, as in `@lab.Activity(alias)`. |

The result is recorded as the learner's, as if they had pressed the
button, and sends no `host.activities.completed`. An evaluation can take a
while: the host waits up to 5 minutes for a result, then answers
`"timeout"`, so allow at least that long before giving up on the
response.

Allowed when the policy's `evaluateActivities` is `on`, which only an
author policy can be. A QA run may run checks while still seeing only
what learners see.

### `host.activities.evaluate.response`

| Field     | Type     | Notes |
|-----------|----------|-------|
| `ok`      | boolean  | `true` when the activity was evaluated and gave a result, whether it passed or not. |
| `reason`  | string?  | When `ok` is `false`: `"not_allowed"` (the policy's `evaluateActivities` is off), `"not_supported"` (the lab is a preview, or the activity has no evaluate button and is graded when the lab is scored), `"not_found"` (no activity with that alias that can be evaluated), `"not_answered"` (a question with no answer chosen), `"already_answered"` (a QA run already submitted it), `"timeout"` (no result within 5 minutes), `"failed"` (anything else, including a missing `alias`, the activity already being evaluated or taking no more attempts, the evaluation not starting, or ending without a result, as when the lab hits an error running a script). `null` when `ok` is `true`. Receivers must tolerate unknown values. |
| `message` | string?  | Human-readable detail for `reason`, written so a model can act on it. `null` when `ok` is `true`. |
| `passed`  | boolean? | `true` when the activity passed, `false` when it didn't. `null` for an activity with no right answer; absent or `null` when `ok` is `false`. |
| `kind`    | string?  | `"question"`, `"script"`, `"code"` or `"vision"`. Given once the activity is found, whether or not it was evaluated; absent or `null` when the host can't tell. Receivers must tolerate unknown values. |

The host answers every refusal at once rather than waiting the 5
minutes.

---

## 5. Variables

Reading a variable is open to every agent; see
[mentor.md](./mentor.md#agentlabvariablerequest).

### `agent.lab.setVariable.request`
**Optional.** Ask the lab to set one of its variables. The host saves it
the way a lab script does, as text. Send it when `host.lab.setVariable.response` is in
`host.session.init.capabilities`.

| Field   | Type                          | Notes |
|---------|-------------------------------|-------|
| `name`  | string                        | The variable's name, as in `@lab.Variable(name)`. |
| `value` | string \| number \| boolean   | The value to save. The host stores it as text. |

A variable can decide whether an activity passes, so only an author
policy can turn `setVariables` on.

### `host.lab.setVariable.response`

| Field     | Type     | Notes |
|-----------|----------|-------|
| `ok`      | boolean  | `true` when the host saved the variable. |
| `reason`  | string?  | When `ok` is `false`: `"not_allowed"` (the policy's `setVariables` is off), `"failed"` (anything else, including a missing `name` or a `value` that isn't a string, number or boolean). `null` when `ok` is `true`. Receivers must tolerate unknown values. |
| `message` | string?  | Human-readable detail for `reason`, written so a model can act on it. `null` when `ok` is `true`. |

---

## 6. Suggestions

An agent that finds something to fix in the lab, a typo, a step that
doesn't work, a wrong answer key, files it as a **suggestion**: an edit
to one instructions page or to one activity. The host stores it for the
lab's authors, so it outlives the session.

- **In author mode**, with the author's rights to edit what the
  suggestion changes, the host also draws a card where the edit applies,
  showing the current and proposed text with **Apply**, **Mark fixed**
  and **Dismiss**. Apply makes the edit in the lab. Mark fixed records
  that the author fixed it themselves, and changes nothing. The card is
  the host's own; the agent can't press it, though your own UI may
  offer the author an Apply button that asks the host to press the
  card's, and a Dismiss button that asks it to press Dismiss: see
  [`agent.instructions.suggestions.apply.request`](#agentinstructionssuggestionsapplyrequest)
  and
  [`agent.instructions.suggestions.dismiss.request`](#agentinstructionssuggestionsdismissrequest).
  The author's decision comes back as
  `host.instructions.suggestionDecided`.
- **To make an edit the author asked for, or a build run's**, see
  [`agent.instructions.edit.request`](#agentinstructionseditrequest):
  show it to the author in your own UI, and send it once they apply it
  there. A build run's is sent at once.
- **Anywhere else**, including a learner's agent, the suggestion is
  filed silently, for the lab's inbox, where an author accepts or
  dismisses it later. Don't tell a learner you filed one, unless it
  helps them.
- **During a QA run** a suggestion belongs to the run. Give it the
  run's `runId` and the `findingId` of the finding it fixes, and the
  run's record links the two. See [qa.md](./qa.md#4-findings-and-severity).

### `agent.instructions.suggest.request`

Area `instructions`, because every suggestion edits the lab's
instructions document, activities included. Allowed when the policy's
`suggestEdits` is on.

| Field       | Type    | Notes |
|-------------|---------|-------|
| `target`    | object  | Where the edit applies: `{ kind: "instructions", page }`, with the **zero-based** page, or `{ kind: "activity", alias }`. |
| `current`   | string  | For a page: the exact text to replace, as the page's markdown source has it (not the rendered text), which must occur on the page exactly once. For an activity: its current values, as JSON text. Not empty. At most 16000 characters. |
| `proposed`  | string or object | For a page: the replacement text. For an activity: a JSON merge patch object over its definition's fields. At most 16000 characters as JSON. |
| `reason`    | string  | Why, in a sentence or two the author reads on the card. At most 2000 characters. |
| `runId`     | string? | The QA run this belongs to. At most 64 characters. |
| `findingId` | string? | The run's finding this fixes. At most 64 characters. |
| `suggestionId` | string? | An open suggestion of the lab's that this edit improves, as `host.instructions.suggestions.list.response` gives it: the host files the edit in its place, so the author has one suggestion, not two. |

The host checks the whole suggestion and never cuts it, since a cut
find would match something else. A suggestion that doesn't fit is
refused with `failed`.

Text inside include or generated-content markers (see
[Includes and generated content](./mentor.md#includes-and-generated-content))
isn't in the page's source, so a page edit can't change it. Say which
include it is in the `reason`, or report it as a finding.

### `host.instructions.suggest.response`

| Field          | Type    | Notes |
|----------------|---------|-------|
| `ok`           | boolean | `true` when the suggestion was stored. |
| `suggestionId` | string? | Its id, a string. `host.instructions.suggestionDecided` carries the same id. |
| `status`       | string? | `"open"`, or `"dismissed"` when the author dismissed the same fix at the same spot before: it isn't filed again, `suggestionId` is the dismissed suggestion's, and no card is drawn. |
| `reason`       | string? | When `ok` is `false`: `"not_allowed"` (the policy's `suggestEdits` is off), `"not_open"` (the `suggestionId` it improves is no longer open), `"too_many"` (the lab instance holds 50 open suggestions; wait for the author to decide some), `"failed"` (anything else, including a malformed suggestion). |
| `message`      | string? | Human-readable detail. |

### `host.instructions.suggestionDecided`

The author applied, marked fixed or dismissed a suggestion's card. No envelope `id`
of its own. Sent only for decisions made on a card in this lab session;
decisions made later in the inbox don't reach the agent.

| Field          | Type    | Notes |
|----------------|---------|-------|
| `suggestionId` | string  | As in the response that stored it. |
| `status`       | string  | `"applied"` (the author pressed Apply and the edit was saved to the lab), `"accepted"` (the author marked it fixed: they fixed it themselves, and nothing was changed for them), `"stale"` (the text to replace is no longer on the page exactly once, or the lab changed while the edit was saved, so nothing changed), `"failed"` (the edit couldn't be made), `"dismissed"`. Receivers must tolerate unknown values. |
| `message`      | string? | For `"stale"` and `"failed"`, what went wrong, written so you can act on it. |

After `"applied"`, read the page or list the activities again before
you quote them. After `"stale"`, read the page again before you suggest
anything more for it.

An activity edit is applied to the activity's definition as
`host.activities.list.response` gives it at `"full"`. Its `scripts` and
`codeTests` are matched by position, so give every enabled one, in
order: adding or removing a script or test, or switching a short answer
between plain text and a regular expression, isn't applied, and fails
with a message saying so.

A suggestion's card stays until the author decides it. Closing it folds
it to a small marker by the step it changes, which opens it again, and
the host draws the cards of the lab instance's open suggestions again,
folded, when the page reloads.

### `agent.instructions.edit.request`

**Optional.** Edit the instructions or an activity: a change the author
asked for and applied in your UI, or one a build run makes. The payload
is `agent.instructions.suggest.request`'s, with the same limits. The host
makes the edit at once, as the author, the same way the author's Apply on
a suggestion would, and keeps it as an applied suggestion, so the lab's
inbox and the run's record keep a trail of it. An edit it can't make
leaves no record. No card is drawn, and no
`host.instructions.suggestionDecided` follows.

Outside a build run, send it only once the author applied the change in
your UI: show them the change first, and drop it when they cancel. Before
they decide, you may ask the host to draw it where it applies, with
[`agent.instructions.edit.preview.request`](#agentinstructionseditpreviewrequest).
In a build run, send it at once, since starting the run was the author's
approval. In a QA run it is refused: a QA run only suggests, giving each
fix with its finding.

Allowed only in the author's own view, and only for what the author may
edit. For a fix the author didn't ask for, suggest.

### `host.instructions.edit.response`

| Field          | Type    | Notes |
|----------------|---------|-------|
| `ok`           | boolean | `true` when the host tried the edit, whether or not it was made. |
| `suggestionId` | string? | Its suggestion's id, only when `status` is `"applied"`: an edit that isn't made keeps no suggestion. |
| `status`       | string? | `"applied"`, `"stale"` or `"failed"`, as in `host.instructions.suggestionDecided`. Only an applied edit is kept. |
| `message`      | string? | For `"stale"` and `"failed"`, what went wrong. |
| `reason`       | string? | When `ok` is `false`: `"not_allowed"` (outside the author's own view, during a QA run, or the author may not edit what it changes), `"not_open"`, `"failed"`. |

After `"applied"`, read the page or list the activities again before
your next edit to them.

### `agent.instructions.suggestions.review.request`

Ask the host to walk the author through the cards of the open
suggestions, one at a time: it turns the instructions to the oldest
open card, opens and marks it, and moves on to the next each time the
author decides or closes one. The payload is `{}`, or `{ "suggestionId":
"..." }` to open just that suggestion's card, as a Show button beside a
filed suggestion does. Only for a host that lists
`host.instructions.suggestions.review.response` in its capabilities, as
the Skillable lab platform does in a lab author's own view.

### `host.instructions.suggestions.review.response`

| Field     | Type    | Notes |
|-----------|---------|-------|
| `ok`      | boolean | `true` when the review started, or there was nothing to review. |
| `waiting` | integer | How many open suggestions the review has to go through. `0` when there are none, or the one named isn't open. |

Decisions made during the review reach you as
`host.instructions.suggestionDecided`, as any other decision on a card
does.

### `agent.instructions.suggestions.list.request`

Ask the host for the lab's open suggestions, from this launch and
earlier ones of the same instructions, before you suggest or make
edits: when an open one covers the same problem, leave it be, or give
its `suggestionId` with your better edit so it is improved in place.
The payload is `{}`. Only for a host that lists
`host.instructions.suggestions.list.response` in its capabilities, as
the Skillable lab platform does in a lab author's own view.

### `host.instructions.suggestions.list.response`

| Field         | Type    | Notes |
|---------------|---------|-------|
| `ok`          | boolean | `true` when the suggestions were read. |
| `suggestions` | array   | Each `{ suggestionId, target, current, proposed, reason }`, as `agent.instructions.suggest.request` gives them. |
| `reason`      | string? | When `ok` is `false`: `"not_allowed"` (the policy's `suggestEdits` is off), `"failed"` (the suggestions couldn't be read). |
| `message`     | string? | Human-readable detail. |

### `agent.instructions.suggestions.apply.request`

Ask the host to apply an open suggestion, as the author pressing
**Apply** on its card: for an Apply button in your own UI, beside the
suggestion, that the author pressed. The payload is
`{ "suggestionId": "..." }`. The card, the page and the lab go as when
the author presses it there, and the decision also reaches you as
`host.instructions.suggestionDecided`. A failed Apply decides nothing:
the suggestion stays open, no `host.instructions.suggestionDecided`
follows, and the response says it failed. Only for a host that lists
`host.instructions.suggestions.apply.response` in its capabilities, as
the Skillable lab platform does in a lab author's own view. Send it
only when the author pressed your button: never apply a suggestion on
your own.

### `host.instructions.suggestions.apply.response`

| Field          | Type    | Notes |
|----------------|---------|-------|
| `ok`           | boolean | `true` when the host decided it, whether or not the edit was made. |
| `suggestionId` | string? | As given. |
| `status`       | string? | `"applied"`, `"stale"` or `"failed"`, as in `host.instructions.suggestionDecided`. A failed one stays open, and no `host.instructions.suggestionDecided` follows it. |
| `message`      | string? | For `"stale"` and `"failed"`, what went wrong. |
| `reason`       | string? | When `ok` is `false`: `"not_open"` (it was decided, or isn't one this page shows), `"not_allowed"` (the author may not edit what it changes), `"failed"`. |

### `agent.instructions.edit.preview.request`

Ask the host to draw a change you propose, each of its edits where it
applies, with its current and proposed text and no decisions, for the
author to read in context before they apply it in your UI. The payload is
`{ "edits": [...] }`, each edit as `agent.instructions.suggest.request`
gives one. One edit opens at its place; several open the first, with the
host's arrows between them. One change at a time: another replaces it. An empty `edits` is refused with `"not_allowed"`. Only for a host that lists
`host.instructions.edit.preview.response` in its capabilities, as the
Skillable lab platform does in a lab author's own view.

### `host.instructions.edit.preview.response`

| Field     | Type    | Notes |
|-----------|---------|-------|
| `ok`      | boolean | `true` when the preview is drawn. |
| `reason`  | string? | When `ok` is `false`: `"not_allowed"` (the author may not edit what it changes), `"failed"`. |

### `host.instructions.edit.preview.decided`

The author pressed **Apply** or **Cancel** on a preview's card in the
lab: `{ "decision": "apply" | "cancel" }`, for the whole change. Act on
it as on your own Apply or Cancel: send each edit with
`agent.instructions.edit.request` and then close the preview, or drop the
change. The host takes the previews away at once on Cancel, and on Apply
once it has made the first of the change's edits, applied or not, so
don't count on them staying until your close.

### `agent.instructions.edit.preview.close.request`

Ask the host to take the change's previews away, once the author applied
or cancelled it. The payload is `{}`. Answered by
`host.instructions.edit.preview.close.response`, `{ "ok": true }`.

### `agent.instructions.suggestions.dismiss.request`

Ask the host to dismiss an open suggestion, as the author pressing
**Dismiss** on its card: for a Dismiss button in your own UI, beside the
suggestion, that the author pressed. The payload is
`{ "suggestionId": "..." }`. The card goes as when the author presses
it there, and the decision also reaches you as
`host.instructions.suggestionDecided`. Only for a host that lists
`host.instructions.suggestions.dismiss.response` in its capabilities, as
the Skillable lab platform does in a lab author's own view. Send it only
when the author pressed your button: never dismiss a suggestion on your
own.

### `host.instructions.suggestions.dismiss.response`

As `host.instructions.suggestions.apply.response`, with `status`
`"dismissed"`, and `"not_allowed"` when the author may not decide it.
