# Quickstart

Run the lab simulator and the sample agent locally in a couple of
minutes, then point the simulator at your own agent. Everything speaks
protocol version 2.

## Prerequisites

- Node.js 18 or later (`node --version`). There is nothing to install:
  the dev server has no dependencies.
- Any modern browser.

## 1. Run the dev server

From the repository root:

```bash
node src/serve.mjs
```

It serves `src/wwwroot` twice:

| URL | What it is |
|---|---|
| `http://localhost:7080/lab-simulator/` | The lab simulator: a simulated Skillable lab that embeds an agent. |
| `http://localhost:7081/sample-agent/` | The sample agent, on another port so it is cross-origin from the simulator, as a real agent is. |

## 2. Open the simulator

Visit **`http://localhost:7080/lab-simulator/`**. Pick one:

- **Try the sample agent** opens the simulated lab with
  `src/wwwroot/sample-agent/` in its **Lab Agent** tab.
- **Test your Lab Agent**: paste the URL of the agent you are building,
  such as `https://localhost:5173/`, to embed it instead.

The lab page's URL carries the agent's URL as `?mentor=<url>`, so you
can bookmark it.

## 3. Drive your agent

- Open **Settings** (the gear) and turn on **Show postMessage event log**
  to see every message in either direction.
- Watch the handshake: `agent.session.ready` with `modes`, then
  `host.session.init` with `capabilities` and `agent` (the policy, the
  prompts and the rest), then `agent.session.opened`.
- Click **Next** to turn the instructions page: the simulator sends
  `host.session.context`.
- Click **I'm stuck** on the Instructions tab to send
  `host.session.hint`.
- In **Settings > Color Mode**, switch themes to send
  `host.session.theme`.
- In **Settings > Lab Agent policy**, pick what the learner's agent may
  do: act in the environment asking first (the default), act in it without
  asking, look and show only, or no console access. The page reloads, and
  the agent gets the new policy and capabilities in a fresh handshake.
  With asking first, the agent's first console action for each learner
  message puts a question over the console and is refused with `asking`
  until you answer.
- Screenshots, keys, the mouse, typed text, credentials, marks, tours
  and background commands act on a static picture of a desktop: the
  simulator answers them as a lab would, and shows a toast for what a
  real console would have done.
- Requests the simulator doesn't fulfill, such as the author and QA
  messages, are answered with `not_supported`.

The simulator asks `/api/lab/launch-token` for a launch token, which the
dev server doesn't serve, so `host.session.init` carries no `authToken`
and the log shows the mint failing. To test token verification, verify
against a real Skillable environment's JWKS during onboarding (see
[core section 3.2](./spec/core.md#32-authentication)).

## 4. Let the simulator frame your agent

If you test your own agent:

- Accept messages from the simulator's origin, `http://localhost:7080`
  (or `https://`), and post to that exact origin once you have pinned it
  ([core section 3.3](./spec/core.md#33-origin-security)).
- Allow the origin in your page's `Content-Security-Policy:
  frame-ancestors` in development.
- If your agent calls its own backend, add the agent's origin to that
  backend's CORS allow-list as usual.

## HTTPS

Plain HTTP on `localhost` is enough for the simulator. To serve both
ports over HTTPS instead, make a self-signed certificate and pass it to
the server:

```powershell
# Windows PowerShell
./certs/create-self-signed-cert.ps1
```

```bash
# Linux or macOS (needs openssl)
./certs/create-self-signed-cert.sh
```

```bash
node src/serve.mjs --pfx certs/lab-agent-sdk.pfx --passphrase changeit
```

Generated certificates stay out of git (see `.gitignore`).

## Next

- Read [the core spec](./spec/core.md), then the modes your agent will
  declare: [mentor](./spec/mentor.md), [author](./spec/author.md),
  [QA](./spec/qa.md). [messages.md](./spec/messages.md) lists every
  message.
- Read the sample agent's [README](../src/wwwroot/sample-agent/README.md)
  and `agent.js`: core plus mentor mode in about 250 lines.
