# AI Chat Mentor &mdash; Integration Sandbox

An **integration sandbox** for developing and testing an AI Chat Mentor
application that embeds into the Skillable hands-on lab platform. Run it
locally and drive your mentor against a simulated Skillable lab page
without needing access to a real lab.

The sandbox bundles two things:

1. **A reference simulator of a Skillable lab page** that embeds your
   mentor in an iframe and exercises the full `postMessage` integration
   contract.
2. **A working sample chat agent** (a small ASP.NET Core service +
   vanilla JS chat UI) you can use as a reference implementation, or
   strip out and replace with your own.

When you run the sandbox, the landing page asks you to pick:

- **Test a Mentor Agent** — point the simulated lab at your own iframe
  URL.
- **View a Sample Integration** — load the sample chat agent inside
  the simulated lab so you can see a working integration end-to-end.

---

## Documentation

| Document | What it's for |
|---|---|
| [**Mentor integration spec**](./docs/mentor-integration-spec.md) | **Read this first.** Authoritative protocol spec: architecture, embedding model, postMessage contract (required vs. optional), origin / security rules, visual style guidance, versioning. Self-contained. |
| [Quickstart](./docs/quickstart.md) | Run the sandbox locally in two minutes. |

The spec is the only required reading. The sample chat agent under
`src/wwwroot/sample-chat-agent/` (with its backend in `src/`) is provided as a
working reference implementation of the contract — read its source if you
want to crib from it, but you don't have to understand its internals to
build your own mentor.

---

## Running locally

Prereqs:

- .NET 8 SDK
- A modern browser
- One-time on a new machine: `dotnet dev-certs https --trust`

Then:

```bash
cd src
dotnet run
```

Open **`https://localhost:7080/`** &mdash; you'll land on the chooser.

Pick **Test a Mentor Agent** to point the simulator at your dev iframe
URL, or **View a Sample Integration** to see the sample chat agent in
action.

For more, see [`docs/quickstart.md`](./docs/quickstart.md).

### Using a real LLM

The sample chat agent runs in **Simulated** mode by default: canned
replies, no credentials needed. Switch to **Claude** mode for a real
LLM that can act on the lab environment through the host's
capabilities (running commands in the background, typing into the
console, typing the lab's credentials, taking screenshots, changing
instructions pages).

Keep credentials in user-secrets, never in `appsettings.json`. From
`src`:

```bash
dotnet user-secrets set Mentor:Mode Claude
dotnet user-secrets set Mentor:Claude:ApiKey <your Anthropic API key>
```

To use a Claude deployment in Microsoft Foundry instead, set
`Mentor:Claude:Provider` to `Foundry`, `Mentor:Claude:Foundry:Resource`
to the resource name, `Mentor:Claude:Foundry:ApiKey` to its key, and
`Mentor:Claude:Model` to the deployment name.

Each request resends the whole conversation, so the Claude mentor caches
its tools, system prompt and history (prompt caching works on both
providers), leaving out the newest message from its first screenshot or
long command output on, which saving changes once the mentor has seen
it. A second cache breakpoint sits where the previous call put its own,
so that call's entry is read back even after a long batched turn. Where the learner is (the
instructions page, its text, the selected VM) and whether a run is going
are told in notes on the conversation each time they change, so that the
system prompt and tools change only when the user's view or what the mentor
may do changes. Cache entries last
five minutes in chat and an hour during a run
(`Mentor:Claude:RunCacheTtl`, `1h` or `5m`). The oldest part of a long
conversation is summarized in one step, once it passes
`Mentor:Claude:SummarizeAtContextShare` (0.9) of the model's context or
of `SessionStore:MaxConversationBytes` (1.5 MB, which keeps it within a
Cosmos DB item), down to `SummarizeToContextShare` (0.75), so the cached
history is rewritten only then. Each call logs its cache
reads and writes, from which a run's cost can be worked out, and a short
hash of its system prompt and tools, which changes only when they do.

Command output stays in the conversation and is resent with every
request, unlike a screenshot, so the chat sends only the first and last
2,000 characters of a command's output, with a line saying how many were
left out in between. Once the mentor has seen it, the next save cuts it
to the first and last 500. A cut result is never cut again, so the
cached history stays the same from then on. This applies in chat and in
runs alike.

The mentor can batch console actions that don't depend on seeing each
result, such as filling in a form (click a field, type, Tab, type), in
one reply, which saves a model turn per action. The chat runs them in
order, and only the last one brings the screen back, though each still
waits as its `then` asks. The first action that fails, or whose wait for
the screen to change times out (a click that didn't land), stops the
batch: every call after it in the reply is skipped, whatever its tool,
and the mentor gets the screen as it stands. A batch holds at most 8
console actions; a 9th stops the batch the same way.

### Run mode

A lab author can ask the Claude mentor to carry out a long task on its
own, such as performing the whole lab to check it. The mentor starts a
run, with a time limit taken from the author's words, or
`Mentor:Run:DefaultMinutes` (60) when they give none. The chat shows
the run's goal and time left, and keeps the mentor going turn after turn
until it reports the task complete or says what blocks it, the time
runs out, it looks stuck (the same action with the same result, or
actions that change nothing, several times in a row), or the author
presses Stop. Each result the mentor gets during a run ends with its
time left and how full its context is (`Mentor:Claude:ContextTokens`,
1000000 by default, the full window of Claude Opus 5.5). Students are never offered a run.

The backend enforces that: it drops the run state the chat sends with a
message or tool results, and refuses a run's end or continuation with
403, unless the caller may drive runs. The `role` claim of the verified
launch token decides when it has one. Without the claim, or without a
token (`LaunchToken:ChatAgent:RequireToken` off), the posted lab context's `userRole` decides,
and a session in which the backend has accepted a run before also
passes, so an author's run carries on in student view.

During a run the mentor's text between actions is one short line, or
none; the summary it ends the run with is written out in full.

A run is a **walkthrough**, by default, or a **shortcut** run, which the
mentor starts when the author asks for one (for example "do a shortcut
run of this lab"). A walkthrough follows the instructions as written,
which tests the instructions. A shortcut run tests the environment
instead: the mentor reads the instructions, posts a list of checkpoints
(the end state each section produces, such as a resource group in a
region or a VM running with a port open), and reaches each by the
fastest path, preferring a command line to clicking through a portal.
It builds the real thing rather than making a check pass, proves each
checkpoint with command output or a screenshot, and ends with one line
per checkpoint: pass or fail, the evidence, and what blocked a failure.
The banner says when a run is a shortcut run, and a run picked up again
keeps its mode.

Run mode is behavior of this sample mentor, not part of the integration
contract.

### Session storage

`SessionStore:Provider` picks where mentor sessions, their transcript
and the model conversation live:

| Provider   | Use it for | Notes |
|------------|------------|-------|
| `InMemory` | Trying things out | The default. Sessions are lost on restart. |
| `Sqlite`   | One instance, at no cost | A local file, `mentor-sessions.db` by default (`SessionStore:Sqlite:ConnectionString`). Running locally in Development uses it, so a session survives a restart. |
| `Cosmos`   | Several instances behind a load balancer | Azure Cosmos DB, one container partitioned by `/sessionId`. Set `SessionStore:Cosmos:ConnectionString` (in user-secrets) or `AccountEndpoint` to sign in with `DefaultAzureCredential`. Use a serverless account for low traffic. |

Sessions expire `SessionStore:SessionLifetimeDays` (default 30) after
they were last written.

---

## Project layout

```
ai-mentor-integration-sandbox/
+- src/                                # everything to run the sample app
|  +- ai-mentor-integration-sandbox.sln
|  +- ai-mentor-integration-sandbox.csproj   # ASP.NET Core 8 project
|  +- Program.cs                       # static hosting + REST API + Swagger
|  +- appsettings.json                 # CORS allow-list, simulated mentor config
|  +- Properties/launchSettings.json
|  +- Models/                          # ChatMessage, LabContext, requests
|  +- Services/                        # IMentorService + the session stores
|  +- wwwroot/                         # static assets served by the app
|     +- lab-simulator/                  # the simulated Skillable lab page
|     |  +- index.html                 #   chooser (landing)
|     |  +- chooser.css
|     |  +- lab-simulator.html           #   lab simulator (page 2)
|     |  +- lab-simulator.css
|     |  +- lab-simulator.js             #   postMessage wiring + lab UX
|     |  +- windows-desktop.svg
|     |  +- skillable-logo.svg
|     |
|     +- sample-chat-agent/            # the sample chat agent (iframe)
|        +- index.html
|        +- chat.js
|        +- postmessage-client.js      #   MentorBridge: client of the contract
|        +- styles.css
|        +- variables-common.css       #   Skillable design tokens (shared)
|
+- certs/
|  +- create-self-signed-cert.ps1      # generate a non-dev .pfx if needed
|  +- create-self-signed-cert.sh
|
+- docs/
   +- mentor-integration-spec.md       # read first
   +- quickstart.md
```

---

## Architecture at a glance

```
+--------------------- simulated lab page (parent) ---------------------+
|                                                                       |
|   [ VM tabs  |  brand  X Exit Lab ]                                   |
|   +----------------+ +----------+                                     |
|   |                | | Instructions                                   |
|   |                | | Resources                                      |
|   |  Live env      | | Mentor  <===== iframe ====> YOUR mentor        |
|   |                | |                                                |
|   |                | | [ Prev ] [ Next ]                              |
|   +----------------+ +----------+                                     |
|                                                                       |
+----- lab JS <--postMessage--> mentor iframe JS -----------------------+
```

- The lab page and your iframe are in different browser origins. The
  only channel is `window.postMessage`.
- Your iframe never reaches into the lab DOM, and vice versa.
- Mentor-driven side effects (navigating to a specific instructions
  page, pasting text into the lab environment) go through postMessage
  so the lab stays in control.

The sample chat agent is one possible client of this contract. Yours
will look different, but it must speak the same handshake and message
shapes.

---

## What you can replace

Everything in this repo is sample material. The piece that's most likely
to stay useful long-term is the **simulator** at
`src/wwwroot/lab-simulator/` &mdash; that's the lab page your mentor will
embed into. The **sample chat agent** at
`src/wwwroot/sample-chat-agent/` (plus the C# files in `src/`) is just a
working reference implementation of the iframe side of the contract.
O