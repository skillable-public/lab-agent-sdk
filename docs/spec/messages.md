# Lab Agent protocol: message reference

Every message in protocol version 2, by area. **Dir** is `A>H` for the
agent to the host and `H>A` for the host to the agent. **Pair** names
the other half of a request and its response; an event has none. A
request's response echoes its envelope `id`. Field names ending in `?`
are optional. Every refusal is `{ ok: false, reason, message }`
([core section 9.2](./core.md#92-refusals)), so the response columns
list the fields of success.

**Spec** says where the message is described: [core](./core.md),
[mentor](./mentor.md), [author](./author.md) or [qa](./qa.md).

## session

| Message | Dir | Pair | Payload | Limits and notes | Spec |
|---|---|---|---|---|---|
| `agent.session.ready` | A>H | event (answered by `host.session.init`) | `modes?`, `protocolVersion?`, `capabilities?`, `displayName?` | Sent to `'*'`. `modes` absent or empty means `["mentor"]`; `qa` counts only with `author`. `displayName` at most 64 characters, trimmed; blank means the host's default name. | [core](./core.md#agentsessionready) |
| `host.session.init` | H>A | event | `labInstanceId?`, `authToken?`, `sessionId?`, `userName?`, `userId?`, `userRole?`, `userOrganizationId?`, `userOrganizationName?`, `theme`, `primaryColor?`, `textColor?`, `primaryTextColor?`, `locale?`, `labContext`, `capabilities?`, `agent?` | `sessionId` at most 128 characters. `agent`: `profileId`, `mode`, `prompts`, `qa`, `policy`, `qaRequest`, `challengePrompt`. | [core](./core.md#hostsessioninit) |
| `host.session.authRefresh` | H>A | event | `authToken` | About 60 seconds before the token expires. | [core](./core.md#hostsessionauthrefresh) |
| `agent.session.authRefresh.request` | A>H | `host.session.authRefresh.response` | none | When your backend turns the token away. At most one mint every few seconds; a request within that gets the token the last one gave. | [core](./core.md#agentsessionauthrefreshrequest) |
| `host.session.authRefresh.response` | H>A | `agent.session.authRefresh.request` | `ok`, `authToken` | | [core](./core.md#hostsessionauthrefreshresponse) |
| `host.session.context` | H>A | event | `context`, `userRole?`, `capabilities?`, `agent?` | The last three after a view switch; `agent` alone when the lab becomes ready with a launch's `qaRequest` held back for it. | [core](./core.md#hostsessioncontext) |
| `host.session.theme` | H>A | event | `theme`, `primaryColor?`, `textColor?`, `primaryTextColor?` | | [core](./core.md#hostsessiontheme) |
| `host.session.locale` | H>A | event | `locale` | | [core](./core.md#hostsessionlocale) |
| `host.session.hint` | H>A | event | `reason?` | Starts a learner message. | [mentor](./mentor.md#hostsessionhint) |
| `host.session.sendMessage` | H>A | event | `content` | Send it as if the user typed it. | [core](./core.md#hostsessionsendmessage) |
| `host.session.limitReached` | H>A | event | `message` | The lab's AI token cap is reached: take no more messages, keep the conversation readable. Again after each `host.session.init`. | [core](./core.md#hostsessionlimitreached) |
| `agent.session.opened` | A>H | event | `sessionId`, `kind?` | `sessionId` at most 128 characters, at least 128 bits of randomness. | [core](./core.md#agentsessionopened) |
| `agent.session.messageSent` | A>H | event | `message` (ChatMessage) | Starts a learner message: refills the action cap. | [core](./core.md#agentsessionmessagesent) |
| `agent.session.reply` | A>H | event | `message` (ChatMessage) | Drives the host's unread badge. | [core](./core.md#agentsessionreply) |
| `agent.session.error` | A>H | event | `code`, `message` | | [core](./core.md#agentsessionerror) |

## instructions

| Message | Dir | Pair | Payload | Limits and notes | Spec |
|---|---|---|---|---|---|
| `agent.instructions.pages.request` | A>H | `host.instructions.pages.response` | `includeSource?` | | [mentor](./mentor.md#agentinstructionspagesrequest) |
| `host.instructions.pages.response` | H>A | `agent.instructions.pages.request` | `pages[]` (`index`, `title?`, `instructions`, `includes`, `generated`, `tasks[]?`), `source?` | Includes and generated content between marker comments. | [mentor](./mentor.md#hostinstructionspagesresponse) |
| `agent.instructions.image.request` | A>H | `host.instructions.image.response` | `url` | An image the instructions show. Allow 30 seconds. | [mentor](./mentor.md#agentinstructionsimagerequest) |
| `host.instructions.image.response` | H>A | `agent.instructions.image.request` | `ok`, `mimeType`, `dataBase64`, `width?`, `height?` | At most 5 MB. PNG, JPEG, WebP, GIF or SVG. Bare base64, not a `data_url` as screenshots send. | [mentor](./mentor.md#hostinstructionsimageresponse) |
| `agent.instructions.gotoPage.request` | A>H | `host.instructions.gotoPage.response` | `index`, `show?` | Zero-based. Needs `showOnScreen`. | [mentor](./mentor.md#agentinstructionsgotopagerequest) |
| `host.instructions.gotoPage.response` | H>A | `agent.instructions.gotoPage.request` | `ok`, `page` | `page` is the zero-based page now shown. | [mentor](./mentor.md#hostinstructionsgotopageresponse) |
| `agent.instructions.show.request` | A>H | `host.instructions.show.response` | one of `text`, `image`, `activity`; `page?`, `occurrence?`, `note?` | `note` kept to 200 characters. Needs `showOnScreen`. | [mentor](./mentor.md#agentinstructionsshowrequest) |
| `host.instructions.show.response` | H>A | `agent.instructions.show.request` | `ok` | | [mentor](./mentor.md#hostinstructionsshowresponse) |
| `agent.instructions.suggest.request` | A>H | `host.instructions.suggest.response` | `target` (`kind`, `page` or `alias`), `current`, `proposed`, `reason`, `runId?`, `findingId?` | `current` and `proposed` at most 16000 characters, `reason` 2000, `alias` 256, `runId` and `findingId` 64. Never cut. 50 open per lab instance. Needs `suggestEdits`. | [author](./author.md#agentinstructionssuggestrequest) |
| `host.instructions.suggest.response` | H>A | `agent.instructions.suggest.request` | `ok`, `suggestionId` (string), `status` | | [author](./author.md#hostinstructionssuggestresponse) |
| `host.instructions.suggestionDecided` | H>A | event | `suggestionId` (string), `status`, `message?` | `applied`, `accepted`, `stale`, `failed` or `dismissed`. | [author](./author.md#hostinstructionssuggestiondecided) |
| `agent.instructions.edit.request` | A>H | `host.instructions.edit.response` | as `agent.instructions.suggest.request` | The same limits. Needs `applyEdits` `direct`, in the author's own view. | [author](./author.md#agentinstructionseditrequest) |
| `host.instructions.edit.response` | H>A | `agent.instructions.edit.request` | `ok`, `suggestionId` (string), `status`, `message?` | `applied`, `stale` or `failed`. | [author](./author.md#hostinstructionseditresponse) |
| `agent.instructions.suggestions.review.request` | A>H | `host.instructions.suggestions.review.response` | | Walks the author through the open suggestions' cards. | [author](./author.md#agentinstructionssuggestionsreviewrequest) |
| `host.instructions.suggestions.review.response` | H>A | `agent.instructions.suggestions.review.request` | `ok`, `waiting` | | [author](./author.md#hostinstructionssuggestionsreviewresponse) |

## tasks

| Message | Dir | Pair | Payload | Limits and notes | Spec |
|---|---|---|---|---|---|
| `agent.tasks.check.request` | A>H | `host.tasks.check.response` | `task` or `taskNumber`, `page?`, `checked?` | Needs `checkTasks`. | [mentor](./mentor.md#agenttaskscheckrequest) |
| `host.tasks.check.response` | H>A | `agent.tasks.check.request` | `ok` | | [mentor](./mentor.md#hosttaskscheckresponse) |
| `host.tasks.changed` | H>A | event | `text`, `checked`, `page` | Only for the learner's own ticks. | [mentor](./mentor.md#hosttaskschanged) |

## activities

| Message | Dir | Pair | Payload | Limits and notes | Spec |
|---|---|---|---|---|---|
| `agent.activities.list.request` | A>H | `host.activities.list.response` | none | Needs `activities` above `off`. | [author](./author.md#agentactivitieslistrequest) |
| `host.activities.list.response` | H>A | `agent.activities.list.request` | `ok`, `level`, `activities[]` (`key`, `alias`, `id`, `type`, `page`, `question`, `choices`, `scored`, `maxScore`, `answered`, `passed`, `attemptsUsed`, `attemptsAllowed`, `definition?`) | `definition` at `full` only, held back in a QA run until answered. | [author](./author.md#hostactivitieslistresponse) |
| `agent.activities.answer.request` | A>H | `host.activities.answer.response` | `alias`, `choiceIds?` or `text?` | Author mode, with `evaluateActivities`. Allow 5 minutes. | [author](./author.md#agentactivitiesanswerrequest) |
| `host.activities.answer.response` | H>A | `agent.activities.answer.request` | `ok`, `passed`, `score`, `maxScore`, `attemptsUsed`, `attemptsAllowed` | | [author](./author.md#hostactivitiesanswerresponse) |
| `agent.activities.evaluate.request` | A>H | `host.activities.evaluate.response` | `alias` | Needs `evaluateActivities`. Allow 5 minutes. | [author](./author.md#agentactivitiesevaluaterequest) |
| `host.activities.evaluate.response` | H>A | `agent.activities.evaluate.request` | `ok`, `passed`, `kind` | | [author](./author.md#hostactivitiesevaluateresponse) |
| `host.activities.completed` | H>A | event | `alias`, `passed` | Only for the user's own completions. | [mentor](./mentor.md#hostactivitiescompleted) |

## lab

| Message | Dir | Pair | Payload | Limits and notes | Spec |
|---|---|---|---|---|---|
| `agent.lab.variable.request` | A>H | `host.lab.variable.response` | `name` | | [mentor](./mentor.md#agentlabvariablerequest) |
| `host.lab.variable.response` | H>A | `agent.lab.variable.request` | `ok`, `value` | | [mentor](./mentor.md#hostlabvariableresponse) |
| `agent.lab.setVariable.request` | A>H | `host.lab.setVariable.response` | `name`, `value` | Needs `setVariables`. Stored as text. | [author](./author.md#agentlabsetvariablerequest) |
| `host.lab.setVariable.response` | H>A | `agent.lab.setVariable.request` | `ok` | | [author](./author.md#hostlabsetvariableresponse) |
| `agent.lab.minutesRemaining.request` | A>H | `host.lab.minutesRemaining.response` | none | | [mentor](./mentor.md#agentlabminutesremainingrequest) |
| `host.lab.minutesRemaining.response` | H>A | `agent.lab.minutesRemaining.request` | `ok`, `minutes` | | [mentor](./mentor.md#hostlabminutesremainingresponse) |
| `agent.lab.status.request` | A>H | `host.lab.status.response` | `waitSeconds?` | Absent or 0 answers now; otherwise waits until the lab is ready, up to `waitSeconds`, 0 to 600. Allow `waitSeconds` plus a margin. | [mentor](./mentor.md#agentlabstatusrequest) |
| `host.lab.status.response` | H>A | `agent.lab.status.request` | `ok`, `ready`, `state`, `consoleConnected?`, `waitedSeconds`, `timedOut` | `timedOut` is an answer, not a failure. `ready` means the environment is running, not that a machine has booted. | [mentor](./mentor.md#hostlabstatusresponse) |

## labClient

| Message | Dir | Pair | Payload | Limits and notes | Spec |
|---|---|---|---|---|---|
| `agent.labClient.screenshot.request` | A>H | `host.labClient.screenshot.response` | none | Needs `screenshots`. | [mentor](./mentor.md#agentlabclientscreenshotrequest) |
| `host.labClient.screenshot.response` | H>A | `agent.labClient.screenshot.request` | `ok`, `data_url` | Validate the data URL; 10 MB decoded cap suggested. | [mentor](./mentor.md#hostlabclientscreenshotresponse) |

## environment

| Message | Dir | Pair | Payload | Limits and notes | Spec |
|---|---|---|---|---|---|
| `agent.environment.screenshot.request` | A>H | `host.environment.screenshot.response` | none | Needs `screenshots`. | [mentor](./mentor.md#agentenvironmentscreenshotrequest) |
| `host.environment.screenshot.response` | H>A | `agent.environment.screenshot.request` | `ok`, `data_url` | | [mentor](./mentor.md#hostenvironmentscreenshotresponse) |
| `agent.environment.screenText.request` | A>H | `host.environment.screenText.response` | `lastLines?` | The selected terminal's text. `lastLines` 1 to 500, from its history. Needs `screenshots`. | [mentor](./mentor.md#agentenvironmentscreentextrequest) |
| `host.environment.screenText.response` | H>A | `agent.environment.screenText.request` | `ok`, `lines`, `cursor`, `columns`, `rows`, `scrolledBack`, `view?`, `fullScreen` | `not_supported` on a console that isn't a terminal. | [mentor](./mentor.md#hostenvironmentscreentextresponse) |
| `agent.environment.scrollTerminal.request` | A>H | `host.environment.scrollTerminal.response` | `to?`, `direction?`, `rows?` | `to: "bottom"`, or `direction` with `rows` 1 to 1000. Scrolls the learner's view of a terminal. Needs `showOnScreen`. | [mentor](./mentor.md#agentenvironmentscrollterminalrequest) |
| `host.environment.scrollTerminal.response` | H>A | `agent.environment.scrollTerminal.request` | `ok`, `rowsBack` | `not_supported` on a console that isn't a terminal. | [mentor](./mentor.md#hostenvironmentscrollterminalresponse) |
| `agent.environment.connectionQuality.request` | A>H | `host.environment.connectionQuality.response` | none | Needs `screenshots`. | [mentor](./mentor.md#agentenvironmentconnectionqualityrequest) |
| `host.environment.connectionQuality.response` | H>A | `agent.environment.connectionQuality.request` | `latencyMilliseconds`, `quality`, `consoleConnected?` | No `ok` wrapper. | [mentor](./mentor.md#hostenvironmentconnectionqualityresponse) |
| `agent.environment.reconnect.request` | A>H | `host.environment.reconnect.response` | none | Reconnects the selected console, as the user's reconnect does. `actInEnvironment`, counts toward the cap. | [mentor](./mentor.md#agentenvironmentreconnectrequest) |
| `host.environment.reconnect.response` | H>A | `agent.environment.reconnect.request` | `ok` | The reconnect started, not that the console is back. `not_supported` with nothing to reconnect. | [mentor](./mentor.md#hostenvironmentreconnectresponse) |
| `agent.environment.select.request` | A>H | `host.environment.select.response` | `machine?`, `endpoint?`, `container?` | A machine alias, optionally with one of its endpoint aliases, or a container name. Changes the user's own view. `actInEnvironment`, counts toward the cap. Allow 40 seconds. | [mentor](./mentor.md#agentenvironmentselectrequest) |
| `host.environment.select.response` | H>A | `agent.environment.select.request` | `ok`, `selected`, `previous`, `connected` | `selected` and `previous` are `{ name, machine, endpoint, console }`. `connected` `true`, `false` or `null` when not known. | [mentor](./mentor.md#hostenvironmentselectresponse) |
| `host.environment.consoleReconnected` | H>A | event | `terminal` | The selected console connected again. `terminal: true` is a new shell, with its earlier output gone. Not sent for a console's first connection. | [mentor](./mentor.md#hostenvironmentconsolereconnected) |
| `host.environment.consoleResized` | H>A | event | `terminal`, `from`, `to` | The selected console changed size: columns and rows on a terminal, otherwise pixels. Earlier screenshots and spots no longer count. Not sent for scaling on the page. | [mentor](./mentor.md#hostenvironmentconsoleresized) |
| `agent.environment.sendText.request` | A>H | `host.environment.sendText.response` | `text`, `screenshot?` | `actInEnvironment`, counts toward the cap. Allow 10 seconds plus 0.3 a character. | [mentor](./mentor.md#agentenvironmentsendtextrequest) |
| `host.environment.sendText.response` | H>A | `agent.environment.sendText.request` | `ok`, `sent`, `cutShort?`, `screenshot?`, `terminal?` | `sent` counts characters. `ok` means delivered to the keyboard input, not that it landed or worked: check a screenshot. `cutShort` means the console gave up partway. `terminal` (`lineBefore`, `line`, `echoed?`, `fullScreen?`) on a terminal. | [mentor](./mentor.md#hostenvironmentsendtextresponse) |
| `agent.environment.typeCredential.request` | A>H | `host.environment.typeCredential.response` | `credential`, `machine?`, `endpoint?`, `pressEnter?` | `actInEnvironment` and `typeCredentials`, counts toward the cap. | [mentor](./mentor.md#agentenvironmenttypecredentialrequest) |
| `host.environment.typeCredential.response` | H>A | `agent.environment.typeCredential.request` | `ok`, `terminal?` | Never carries the credential. `terminal` (`lineBefore`, `echoed?`, `fullScreen?`) on a terminal, never `line`. | [mentor](./mentor.md#hostenvironmenttypecredentialresponse) |
| `agent.environment.keys.request` | A>H | `host.environment.keys.response` | `keys`, `repeat?`, `screenshot?`, `waitUntil?` | `repeat` 1 to 20. `actInEnvironment`, counts toward the cap. | [mentor](./mentor.md#agentenvironmentkeysrequest) |
| `host.environment.keys.response` | H>A | `agent.environment.keys.request` | `ok`, `screenshot?`, `waited?`, `terminal?` | `terminal` (`lineBefore`, `line`, `fullScreen?`) on a terminal. | [mentor](./mentor.md#hostenvironmentkeysresponse) |
| `agent.environment.mouse.request` | A>H | `host.environment.mouse.response` | `action`, `x`, `y`, `screenshotWidth`, `screenshotHeight`, `toX?`, `toY?`, `direction?`, `amount?`, `checkTarget?`, `screenshot?`, `waitUntil?` | `amount` 1 to 20. A scroll on a terminal needs no `x`, `y` or screenshot size, and moves 3 rows a notch. `actInEnvironment` and `screenshots`, counts toward the cap. | [mentor](./mentor.md#agentenvironmentmouserequest) |
| `host.environment.mouse.response` | H>A | `agent.environment.mouse.request` | `ok`, `screenshot?`, `waited?` | | [mentor](./mentor.md#hostenvironmentmouseresponse) |
| `agent.environment.wait.request` | A>H | `host.environment.wait.response` | `until`, `timeoutSeconds?`, `quietSeconds?`, `region?`, `text?` | `timeoutSeconds` up to 600, `quietSeconds` up to 30. `until` `text` and `finished` on a terminal only; `text` 1 to 200 characters. Needs `screenshots`. | [mentor](./mentor.md#agentenvironmentwaitrequest) |
| `host.environment.wait.response` | H>A | `agent.environment.wait.request` | `ok`, `waitedMs`, `measuredFrom?`, `line?` | `stopped` when `finished` sees the terminal go quiet without the prompt. | [mentor](./mentor.md#hostenvironmentwaitresponse) |
| `agent.environment.show.request` | A>H | `host.environment.show.response` | `note?`, `x?`, `y?`, `width?`, `height?`, `text?`, `wholeRow?`, `toText?`, `style?`, `screenshotWidth?`, `screenshotHeight?`, `steps?`, `done?`, `action?` | `note` kept to 200 characters; `steps` 1 to 10; `text` 1 to 200 characters, on a terminal only; `wholeRow` and `toText` only with `text`, `toText` 1 to 200 characters; `style` `outline` or `highlight`, only on a region or text. Needs `showOnScreen`. | [mentor](./mentor.md#agentenvironmentshowrequest) |
| `host.environment.show.response` | H>A | `agent.environment.show.request` | `ok`, `textMatches?` | | [mentor](./mentor.md#hostenvironmentshowresponse) |
| `agent.environment.clear` | A>H | event | none | Takes down the agent's own mark or tour. No response. | [mentor](./mentor.md#agentenvironmentclear) |
| `host.environment.tourStep` | H>A | event | `requestId`, `step`, `steps` | | [mentor](./mentor.md#hostenvironmenttourstep) |
| `host.environment.tourEnded` | H>A | event | `requestId`, `completed`, `reason`, `step`, `steps` | `reason` includes `"text_gone"` and `"scrolled_away"`. | [mentor](./mentor.md#hostenvironmenttourended) |
| `host.environment.markEnded` | H>A | event | `requestId`, `reason` | `reason` includes `"agent_input"`, `"text_gone"` and `"scrolled_away"`. | [mentor](./mentor.md#hostenvironmentmarkended) |
| `host.environment.actInEnvironmentAnswered` | H>A | event | `answer` | `allowed`, `allowedForLab` or `declined`, as the learner answers the Ask-first question. Not a learner message. | [mentor](./mentor.md#hostenvironmenthandsonanswered) |
| `agent.environment.command.request` | A>H | `host.environment.command.response` | `command`, `machine?`, `endpoint?`, `runAsAdministrator?`, `timeoutSeconds?` | `runCommands` and `actInEnvironment`, counts toward the cap. Wait `timeoutSeconds` plus 30 seconds. | [mentor](./mentor.md#agentenvironmentcommandrequest) |
| `agent.environment.command.cancel` | A>H | event | `requestId` | The original request answers `"cancelled"`. | [mentor](./mentor.md#agentenvironmentcommandcancel) |
| `host.environment.command.response` | H>A | `agent.environment.command.request` | `ok`, `stdout`, `stderr`, `exitCode`, `shell?` | | [mentor](./mentor.md#hostenvironmentcommandresponse) |

## run

| Message | Dir | Pair | Payload | Limits and notes | Spec |
|---|---|---|---|---|---|
| `agent.run.started.request` | A>H | `host.run.started.response` | `runId`, `mode`, `fast`, `pages`, `attendance`, `maxMinutes?`, `versions?` | `runId` at most 64 characters; `pages` as JSON at most 256. | [qa](./qa.md#agentrunstartedrequest) |
| `host.run.started.response` | H>A | `agent.run.started.request` | `ok` | | [qa](./qa.md#hostrunstartedresponse) |
| `agent.run.progress.request` | A>H | `host.run.progress.response` | `runId`, `kind`, `finding?`, `activityResult?`, `page?`, `reason?` | `kind` also `paused` and `resumed`. | [qa](./qa.md#agentrunprogressrequest) |
| `host.run.progress.response` | H>A | `agent.run.progress.request` | `ok` | | [qa](./qa.md#hostrunprogressresponse) |
| `agent.run.ended.request` | A>H | `host.run.ended.response` | `runId`, `mode`, `fast`, `pages`, `attendance`, `outcome`, `summary?`, `findings?`, `checkpoints?`, `deviations?`, `versions?` | `summary` 4000 characters; 200 each of findings, checkpoints and deviations; a finding's title 512, its other texts 4000. | [qa](./qa.md#agentrunendedrequest) |
| `host.run.ended.response` | H>A | `agent.run.ended.request` | `ok`, `run` | The stored run, with `activityResults` compiled by the host. | [qa](./qa.md#hostrunendedresponse) |
| `agent.run.transcript.request` | A>H | `host.run.transcript.response` | `runId`, `chunk`, `last`, `truncated`, `entries[]` | 256 KB a chunk, 10 MB in all. | [qa](./qa.md#agentruntranscriptrequest) |
| `host.run.transcript.response` | H>A | `agent.run.transcript.request` | `ok` | A refusal may carry `status`. | [qa](./qa.md#hostruntranscriptresponse) |
| `host.run.stop` | H>A | event | `runId`, `reason`, `message?` | `costCap`, `timeLimit` or `stopped` (the author pressed Stop on the run badge). | [qa](./qa.md#hostrunstop) |
| `host.run.pause` | H>A | event | `runId` | The author pressed Pause on the run badge. | [qa](./qa.md#hostrunpause-and-hostrunresume) |
| `host.run.resume` | H>A | event | `runId` | The author pressed Resume on the run badge. | [qa](./qa.md#hostrunpause-and-hostrunresume) |

## usage

| Message | Dir | Pair | Payload | Limits and notes | Spec |
|---|---|---|---|---|---|
| `agent.usage.report.request` | A>H | `host.usage.report.response` | `model`, `runId?`, `inputTokens`, `outputTokens`, `cacheReadTokens`, `cacheWrite5mTokens`, `cacheWrite1hTokens`, `agentVersion?`, `promptHash?` | One per model call. `model` 128 characters; each count, and their sum, at most 2,000,000. | [qa](./qa.md#agentusagereportrequest) |
| `host.usage.report.response` | H>A | `agent.usage.report.request` | `ok`, `session`, `run`, `labInstance`, `costKnown`, `pastTokenCap`, `pastRunCostCap` | | [qa](./qa.md#hostusagereportresponse) |

## feedback

| Message | Dir | Pair | Payload | Limits and notes | Spec |
|---|---|---|---|---|---|
| `agent.feedback.signal.request` | A>H | `host.feedback.signal.response` | `category`, `page?`, `issueKey?`, `helped?` | Learners only. `issueKey` like `p3/az-login-fails`, at most 128 characters. 100 a lab instance. | [mentor](./mentor.md#agentfeedbacksignalrequest) |
| `host.feedback.signal.response` | H>A | `agent.feedback.signal.request` | `ok` | A refusal may carry `status`. | [mentor](./mentor.md#hostfeedbacksignalresponse) |
| `agent.feedback.report.request` | A>H | `host.feedback.report.response` | `helpful`, `comment?` | Learners only. `comment` at most 500 characters. 50 a lab instance. | [mentor](./mentor.md#agentfeedbackreportrequest) |
| `host.feedback.report.response` | H>A | `agent.feedback.report.request` | `ok` | | [mentor](./mentor.md#hostfeedbackreportresponse) |
