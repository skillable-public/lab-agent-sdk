# Lab Agent protocol: QA mode

> **An agent implements [core](./core.md) plus the modes it declares.**
> Declare `"qa"` in `agent.session.ready` to implement this file. QA
> runs happen in the author's view under the author policy, so an agent
> that declares `"qa"` must also declare `"author"`, and implement
> [author.md](./author.md). `"qa"` alone gets no QA runs. In a QA run the agent runs the lab on its
> own, as a learner would, and records what fails: findings, the lab's
> scored activity results, and a transcript, all kept by the host after
> the session ends.

Usage reporting ([section 10](#10-usage)) is here too, though every
agent, in every mode, should report its usage.

---

## 1. When an agent makes QA runs

`host.session.init.agent.qa.allowed` is `true`, and the host lists the
`host.run.*.response` capabilities, when all of these hold:

- the agent declared `"qa"` and `"author"`;
- it is in author mode ([author.md](./author.md#1-when-an-agent-is-in-author-mode));
- the author policy has `qaRuns` on.

The launch token's `agent_qa` claim signs the same answer for the
signed role. Make runs only when both say yes.

With QA allowed, `agent.qa` also carries the run caps, taken from the
policy: `maxMinutes`, `maxCostUsd`, `attendance` (`"attended"` or
`"unattended"`) and `stopAtSeverity` (`"low"`, `"medium"`, `"high"` or
`"blocker"`), each `null` when unset, spelled as the policy spells
them and as the run messages below send them. `maxCostUsd` is enforced
only when the run's cost is known, so it doesn't apply to a custom
agent's run; `maxMinutes` does ([Usage](#10-usage)).

---

## 2. The QA request

A QA run is started by one object, the **QA request**:

```jsonc
{
  "pages": { "from": 1, "to": 3 },   // zero-based, inclusive; null for the whole lab
  "show": false,                     // show each step on screen as the agent works
  "progress": false,                 // record progress as a learner would: check tasks, turn pages
  "fast": false,                     // a fast run, which may deviate from the instructions
  // plus the run caps and attendance:
  "maxMinutes": 60,                  // or null
  "maxCostUsd": 5,                   // or null
  "attendance": "unattended"         // "attended" or "unattended", or null
}
```

`pages`, `show`, `progress` and `fast` are the request; the caps and
attendance are the policy's, as narrowed for this lab and launch. The
agent never widens them.

It reaches the agent through one of two front doors, and starts exactly
the same run either way:

- **An API launch** passes it in `host.session.init.agent.qaRequest`.
  Start the run at once, without waiting for the user. The caps and
  attendance in it are the policy's. While the lab is still being
  built, the host holds it back, and passes it in the
  `host.session.context.agent.qaRequest` that comes with
  `labReady: true`.
- **A chat command** builds it in your UI. How you spell it is yours;
  the Skillable Lab Agent uses `/qa run [pages] [--show] [--progress]
  [--fast]`. Take the caps and attendance from `agent.qa`.

`qaRequest` is `null` when there is nothing to start. A host sends it
in every `host.session.init` of the lab instance once the lab is ready,
including after a reload, and again after a view switch back to the
author's view, so remember the runs you started and don't start one
twice.

### Wait for the lab to be ready

A run needs the lab's environment. While `LabContext.labReady` is
`false`, the lab is still being built (or is busy saving, resuming and
the like), and its consoles may not answer. Don't start a run then,
whichever front door asked for it: tell the user the run waits for the
lab, and start it once a `host.session.context` says `labReady: true`.
Don't count the wait against the run's `maxMinutes`.

A run also needs a console it can see. When `LabContext.consoleConnected`
is `false` and stays so after a screenshot's wait, end the run as
`"blocked"`, giving the console connection as the reason, rather than
trying to do the lab.

### As written, or fast

- **A run as written** follows the instructions step by step, as a
  learner would. It proves the instructions and the lab. Carry out the
  learner's steps the way a learner would, and use the endpoints that
  are open to the agent but hidden from learners just to inspect and
  verify.
- **A fast run** (`fast: true`) may do steps another way to finish
  sooner, such as with a background command where the instructions use
  a portal, and may use those endpoints for the steps as well as to
  inspect and verify. It proves the
  environment and the scored activities, not the instructions' path.
  Record each step done differently as a
  [deviation](#7-checkpoints-and-deviations), and each section's end
  state as a checkpoint.

---

## 3. Runs

A run is a sequence of messages, posted in this order:

```
agent.run.started.request      once, as the run starts
agent.run.progress.request     for each finding, activity result, page reached, pause and resume, as they happen
agent.run.ended.request        once, as the run ends
agent.run.transcript.request   one or more chunks, after the end
```

- **The run id is yours.** Mint one per run, unique in the lab instance,
  at most 64 characters, and put it on every message of the run.
- **The host stores the run as it goes.** It records the run as
  running at its start, fills it in from progress, and closes it at its
  end. A product UI or test runner reads a running run's state from
  Skillable, so it never calls your agent.
- **The host keeps the order.** It stores each message, and each
  [usage report](#10-usage), in the order they arrive, so a run's end
  totals the usage reported before it.
- **Every request gets `{ ok: true }`** when stored, or `{ ok: false,
  reason: "failed", message }`. A run that couldn't be stored still
  goes on; keep your own copy of its results.
- **Time is counted by the host**, from when it stored the start, so a
  reload doesn't restart the clock. Only time the run is going counts:
  time it spends paused doesn't. See [Stops](#9-the-run-badge-and-stops).

### `agent.run.started.request`

| Field        | Type     | Notes |
|--------------|----------|-------|
| `runId`      | string   | Required. At most 64 characters. |
| `mode`       | string   | `"qa"`. Required. |
| `fast`       | boolean  | From the QA request. |
| `pages`      | any      | The pages the run covers, as the QA request gave them; `null` for the whole lab. Kept as JSON of at most 256 characters. |
| `attendance` | string   | `"attended"` or `"unattended"`. |
| `maxMinutes` | integer? | The run's own time limit, when it has one below the policy's `maxMinutes`, such as one the author set as they started it. The host shows the run's time against it, and stops the run there. |
| `versions`   | object?  | `{ agent, model, promptHash }`: your agent's version (at most 64 characters), the model's name (at most 128) and a hash of your prompt (at most 128). |

Sending the start again for a run the host already holds, as after a
reload, is harmless.

### `host.run.started.response`

`{ ok: true }`, or a refusal.

### `agent.run.progress.request`

One thing that happened in the run.

| Field            | Type     | Notes |
|------------------|----------|-------|
| `runId`          | string   | Required. |
| `kind`           | string   | `"finding"`, `"activityResult"`, `"page"`, `"paused"` or `"resumed"`. |
| `finding`        | object?  | With `"finding"`: a [finding](#4-findings-and-severity). |
| `activityResult` | object?  | With `"activityResult"`: your note on an activity you answered or evaluated: `{ alias, passed, how, score?, maxScore?, attemptsUsed?, attemptsAllowed? }`, `how` being `"answered"` or `"evaluated"`. |
| `page`           | integer? | With `"page"`: the **zero-based** page the run reached. |
| `reason`         | string?  | With `"paused"`: why. `"requested"` (the author asked, through `host.run.pause` or your own UI), `"gated"` (a finding waits for the author, see [The attended gate](#5-the-attended-gate)), `"stuck"`, `"failed"` (an error you can resume from) or `"interrupted"` (such as by a reload). Receivers must tolerate unknown values. |

A message whose item doesn't fit (no title on a finding, an unknown
severity, an activity note without an alias) is refused with `failed`.

Send `"paused"` whenever the run stops working but can go on, for
whatever reason, and `"resumed"` when it goes on again. Only an
**attended** run pauses: an unattended run has no one to resume it, so
where an attended run would pause, end it instead, with the outcome
that fits (`"blocked"` for one that is stuck).

### `host.run.progress.response`

`{ ok: true }`, or a refusal.

### `agent.run.ended.request`

How the run ended, with its results.

| Field         | Type      | Notes |
|---------------|-----------|-------|
| `runId`       | string    | Required. |
| `mode`        | string    | `"qa"`. Required. |
| `fast`        | boolean   | |
| `pages`       | any       | As in the start. |
| `attendance`  | string    | As in the start. |
| `outcome`     | string    | Required. `"finished"`, `"blocked"`, `"timeLimit"`, `"costCap"` or `"stopped"`. |
| `summary`     | string?   | The run in a few sentences, for the author. At most 4000 characters. |
| `findings`    | object[]? | Every [finding](#4-findings-and-severity). At most 200. |
| `checkpoints` | object[]? | [Checkpoints](#7-checkpoints-and-deviations). At most 200. |
| `deviations`  | object[]? | [Deviations](#7-checkpoints-and-deviations). At most 200. |
| `versions`    | object?   | As in the start. |

The outcome is how the run ended. There is no separate verdict: the
summary and the findings' severities carry the judgement, and a test
runner applies its own threshold. Text over a limit is cut, items that
still don't fit are dropped, and lists are cut to their maximum. A run
without an id, a mode or a known outcome isn't stored.

### `host.run.ended.response`

| Field  | Type    | Notes |
|--------|---------|-------|
| `ok`   | boolean | `true` when the run was stored. |
| `run`  | object? | The run as the host stored it: `runId`, `status` (`"ended"`), `mode`, `fast`, `pages`, `attendance`, `outcome`, `summary`, `currentPage`, `startedAt` and `endedAt` (ISO-8601 UTC), `findings`, `checkpoints`, `deviations`, `activityResults`, `agentActivityResults`, `versions`, the token totals (`inputTokens`, `outputTokens`, `cacheReadTokens`, `cacheWrite5mTokens`, `cacheWrite1hTokens`) and `estimatedCostUsd` (`null` when some call's model has no price). |

**`activityResults`** is compiled by the host from the lab instance's
own activity results, not from the agent. It lists every **scored**
activity: `alias`, `type`, `passed`, `score`, `maxScore`,
`attemptsUsed`, `attemptsAllowed`, and `how` it was checked:
`"evaluated"`, `"answered"`, `"notReached"` (no result since the run
started shows it was answered or evaluated, so a result from an earlier
run doesn't count) or `"gradedAtScoring"` (it has no evaluate
button, so the lab grades it only when it is scored). "All checks pass"
means every scored activity passed. `agentActivityResults` holds the
notes you sent as progress.

The host stores findings with two fields of its own: `suggestionId`,
a string, the latest [suggestion](./author.md#6-suggestions) filed in the run with
that finding's id, and `fixedDuringRun`, `true` when the author, or you
applied it or marked it fixed during the run.

Outside the session, the host also hands the stored run to the page,
as a `labclient:agentRunEnded` event and `labClient.lastAgentRun`, for
headless test runners, and to the webhooks its API consumer has on a
run's end.

---

## 4. Findings and severity

A finding is something wrong with the lab, found while running it.

| Field          | Type     | Notes |
|----------------|----------|-------|
| `id`           | string?  | Your id for it, such as `"F-2.3"`, unique in the run. At most 64 characters. Give one, so suggestions can link to it. |
| `page`         | integer? | The **zero-based** page it is on. |
| `task`         | string?  | The step it is in, as the instructions say it. At most 2000 characters. |
| `severity`     | string   | Required: `"blocker"`, `"high"`, `"medium"` or `"low"`. |
| `title`        | string   | Required. At most 512 characters. |
| `evidence`     | string?  | What shows it: output, an error, what the screen showed. At most 4000. |
| `current`      | string?  | The text or setting as it is. At most 4000. |
| `proposed`     | string?  | What it should be. At most 4000. |
| `workedAround` | boolean  | Whether the run got past it another way. |
| `include`      | string?  | The include it is in, when it is in included content. At most 256. |
| `generated`    | boolean  | Whether it is in generated content. |

**Severity** applies to author and QA findings only; learner signals use
categories ([mentor.md](./mentor.md#11-signals-and-feedback)). What each
severity means is for the organization's and the lab's run prompts to
say, except that a **blocker** is one that stops the run
([section 6](#6-blockers)).

**Findings come from engagement.** A QA run looks for problems; it
doesn't invent them to fill the report.

### Completeness

A QA run also judges whether the lab looks finished. The agent decides
from the instructions whether the lab is step-by-step or states only an
objective and leaves the steps to the learner, applies the matching
check, and says which it judged the lab to be in the run's `summary`:

- **A lab with no clear objective** is a `high` finding.
- **An objective-only lab** must state an objective that is clear and
  achievable, and its scored checks must verify it.
- **A step-by-step lab** must have instructions that reach its
  objective. Placeholder text, steps that stop partway through a task,
  and an activity the instructions promise but don't have are `high`
  findings.

Whether a lab is ready to publish is the host's judgement, not the
agent's. It reads it from the latest run as written over the whole lab: the run
finished, it reached the lab's last page, every scored activity that can be
checked passed, it has no `high` or `blocker` findings, and the lab hasn't
been edited since. A ready lab with `medium` findings is ready with notes.
So a step the run couldn't test, such as one needing an account the lab
doesn't give, is a `high` finding: a step that wasn't tested is never a
pass.

### Reporting findings

Send each finding as progress when you find it, and every finding again
in the end. To propose the fix, also file it as a suggestion with the
run's `runId` and the finding's `id` as `findingId`
([author.md](./author.md#6-suggestions)). An edit the author accepts during
the run is recorded on its finding as fixed during the run.

---

## 5. The attended gate

In an **attended** run, a finding at or above the run's
`stopAtSeverity` waits for the author before the run goes on: show it
in your UI and let them choose to **continue**, **skip** what is left of
that step, or **stop** the run, which ends it with `"stopped"`. An
**unattended** run records the finding and goes on.

## 6. Blockers

**A blocker ends the run at once**, attended or not, with the outcome
`"blocked"`: send the finding, then `agent.run.ended.request`, then the
transcript. An API launch can ask for the lab to end when an unattended
run is blocked; the host does that once the transcript is stored.

---

## 7. Checkpoints and deviations

A fast run doesn't prove the instructions' path, so it proves the
outcome instead.

- **Checkpoints**: each section's end state, proven:
  `{ name, pass, evidence }`, such as `{ "name": "Resource group in East
  US", "pass": true, "evidence": "az group show ..." }`. `name` is
  required, at most 2000 characters; `evidence` at most 4000.
- **Deviations**: every step done differently from the instructions:
  `{ page, step, how }`, such as `{ "page": 2, "step": "Create the
  resource group", "how": "az group create through the ssh endpoint
  instead of the portal" }`. `step` is required, at most 2000
  characters; `how` at most 4000; `page` zero-based.

A run as written may send checkpoints too, and has no deviations.

---

## 8. Activities in a run

### Answer as a learner first

During a QA run the host holds back each activity's definition (the
answer key, the scripts) until that activity is answered or evaluated
([author.md](./author.md#3-activities)). Work the answer out from the lab
and the instructions, submit it with `agent.activities.answer.request`
or `agent.activities.evaluate.request`, and only then compare it with
the key. That is what finds:

- a reasonable right answer marked wrong: a regular expression or case
  sensitivity that is too strict;
- a wrong answer the instructions led to: an ambiguous question, or a
  wrong key.

Scripted checks run through `agent.activities.evaluate.request` as
usual; a run may run them while still seeing only what a learner sees.

### One submission per activity

Attempts may be limited, so a QA run submits each activity **once**. A
second submission in the same run, or one for an activity already
answered or evaluated before the run, is refused with
`already_answered`. Retries the lab allows a learner are recorded, not
made.

---

## 9. The run badge and stops

While a run is going, the host shows a badge for it: the run's kind (as
written or fast), the page it is on, the time it has taken against its
time limit, and **Pause** and **Stop** buttons. The page comes from the
run's `"page"` progress, so send it as you reach each page. The time
counts only while the run is going, and its limit is the start's
`maxMinutes`, or the policy's when the run has none of its own. During a
run, paused or not, the host locks its Author / Student view toggle
([author.md](./author.md#2-view-switching)).

The badge is the run's display, so your UI doesn't need one of its own.
While the run is paused, after a `"paused"` progress, the badge says so,
its clock stops, and **Pause** becomes **Resume**.

When the author presses **Pause** or **Resume**, the host sends
`host.run.pause` or `host.run.resume`. Pause or resume the run, and send
the `"paused"` or `"resumed"` progress; the badge changes only then.
The host ends a run with `host.run.stop` when it passes a cap, or when
the author presses **Stop** on the badge, paused or not.

### `host.run.pause` and `host.run.resume`

| Field   | Type   | Notes |
|---------|--------|-------|
| `runId` | string | The run to pause or resume. |

Ignore one for a run that isn't yours, or is already paused or going.

### `host.run.stop`

| Field     | Type    | Notes |
|-----------|---------|-------|
| `runId`   | string  | The run to stop. |
| `reason`  | string  | `"timeLimit"` (past the run's time limit, counting only the time it was going since its stored start), `"costCap"` (past `maxCostUsd`, when the run's cost is known), `"stopped"` (the author pressed Stop on the run badge). Receivers must tolerate unknown values. |
| `message` | string? | What to show, when the host has something to say. |

On a stop, end the run at once: stop working in the console, send
`agent.run.ended.request` with the reason as its `outcome`, and send the
transcript. The host sends the stop again for every later usage report
or progress of a run it has stopped, so don't keep going.

`"stopped"` is also the outcome you report when the author stops a run
in your own UI, such as at the [attended gate](#5-the-attended-gate);
end the run the same way.

---

## 10. Usage

Every agent, in every mode, reports what each model call used. The host
records it per session, model and run, and holds the lab instance to its
token cap.

The host knows a call's cost only for Skillable's Lab Agent, from the
prices of the AI Model its Lab Agent profile picks. A custom agent's
profile has no AI Model, so its calls have no price: the host records
their tokens and holds them to the token cap, but doesn't cost them.
Report your usage all the same, the model's name and each call's tokens.

### `agent.usage.report.request`

One model call's usage, as that call's own counts, never running
totals. Send one per call.

| Field                | Type    | Notes |
|----------------------|---------|-------|
| `model`              | string  | The model's name. Required. At most 128 characters. |
| `runId`              | string? | The QA run the call was made for; omit it outside a run. |
| `inputTokens`        | integer | Uncached input tokens. |
| `outputTokens`       | integer | |
| `cacheReadTokens`    | integer | Input read from the prompt cache. |
| `cacheWrite5mTokens` | integer | Input written to a 5-minute cache. |
| `cacheWrite1hTokens` | integer | Input written to a 1-hour cache. |
| `agentVersion`       | string? | At most 64 characters. |
| `promptHash`         | string? | At most 128 characters. |

Each count is 0 to 2,000,000, and together they are at most 2,000,000.
A report that doesn't fit is refused.

### `host.usage.report.response`

| Field            | Type     | Notes |
|------------------|----------|-------|
| `ok`             | boolean  | `true` when the report was recorded. |
| `session`        | object   | The agent session's totals: `{ totalTokens, estimatedCostUsd }`. `totalTokens` leaves out cache reads. `estimatedCostUsd` is `null` when some call's model has no price, as every custom agent's call has none. |
| `run`            | object?  | The run's totals, the same shape, for a lab author's report with a `runId`. `null` otherwise. |
| `labInstance`    | object   | `{ totalTokens, maxTokens }`: the lab instance's tokens across every AI tool, and its cap. |
| `costKnown`      | boolean  | `false` when some of the session's calls have no price. |
| `pastTokenCap`   | boolean  | The lab instance is past its token cap. |
| `pastRunCostCap` | boolean  | The run is past its cost cap. |
| `reason`, `message` | string? | When `ok` is `false`: `"failed"`. |

**Costs are estimates.** Every `estimatedCostUsd` the host returns, here
and on a stored run, is worked out from the token counts you report and
the prices of the profile's AI Model. It is not a billed or
reported cost, so don't present it as one.

**Past the token cap**, a learner's agent is told so with
[`host.session.limitReached`](./core.md#hostsessionlimitreached), and
stops taking messages while keeping the conversation readable. An agent
that goes on calling its model is stopped for good: the host replaces
your iframe with the lab's message, and nothing more you send reaches
it. The cap is for learners: a lab author isn't held to it, in a
run or out of one, and a run's usage, though recorded, doesn't count
toward it. A run has its own time and cost limits instead, and the cost
limit holds only when the run's cost is known.

---

## 11. Transcripts

After `agent.run.ended.request`, send the run's transcript, so the
author can see how the run went. It holds text and tool calls, with no
screenshots or images.

### `agent.run.transcript.request`

One chunk of the transcript.

| Field       | Type      | Notes |
|-------------|-----------|-------|
| `runId`     | string    | Required. |
| `chunk`     | integer   | The chunk's number, from 0, in order. |
| `last`      | boolean   | `true` on the last chunk. |
| `truncated` | boolean   | `true` when you stopped adding entries at the total cap. |
| `entries`   | object[]  | The entries, in order. Each has `at` (an ISO-8601 time) and `role` (`"user"`, `"assistant"` or `"tool"`), and may have `text` (a string or `null`) and `tool` (an object with a `name`, and whatever else describes the call, such as its input and result). The host keeps fields it doesn't know. |

Keep each chunk at most 256 KB of JSON, and the whole transcript at most
10 MB: past that, stop adding entries and set `truncated`. A chunk with
an entry that doesn't fit the shape is refused.

### `host.run.transcript.response`

`{ ok: true }`, or `{ ok: false, reason: "failed", message, status? }`.
`status` is the HTTP status of the host's own call: retry a chunk only
when there is none, since a status is a final answer for that chunk.

When an API launch asked the lab to end after an unattended run, the
host ends it once the last chunk is stored, or 30 seconds after the
run's end without it, so send the transcript promptly.
