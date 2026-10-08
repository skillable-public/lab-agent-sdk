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