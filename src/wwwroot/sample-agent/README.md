# Sample Lab Agent

A small Lab Agent in plain JavaScript, with no build step, no model and no
backend. It implements the protocol's [core](../../../docs/spec/core.md)
and a part of [mentor mode](../../../docs/spec/mentor.md), and declares
`modes: ["mentor"]`.

| File | What it is |
|---|---|
| `agent.js` | The agent: about 250 lines. |
| `index.html` | The chat page the host embeds. |
| `agent.css` | Its styles, on the tokens in `../shared/variables-common.css`. |

## What it does

- **The handshake.** Posts `agent.session.ready` to `'*'`, accepts messages
  only from the origins in `HOST_ORIGINS`, pins the host's origin from its
  first valid message, and answers `host.session.init` with
  `agent.session.opened`, resuming the host's `sessionId` or minting a random
  one. With no `host.session.init` within 10 seconds, or no host at all, it
  carries on as a context-free chat.
- **A chat.** Shows the user's and the agent's messages, and reports them
  with `agent.session.messageSent` and `agent.session.reply`. Replies are
  scripted from the lab context: ask it what page you are on.
- **A screenshot, when the capability allows.** "Look at my screen" shows
  only when `host.environment.screenshot.response` is in the capabilities.
  The agent validates the data URL before it shows the image.
- **An action in the environment.** "Open the Run dialog" presses Win+R with
  `agent.environment.keys.request`, so you can watch the host ask the
  learner first.
- **Refusals.** Every refusal reason gets a plain answer for the learner:
  `asking`, `declined`, `not_allowed` and the rest
  ([core section 9.2](../../../docs/spec/core.md#92-refusals)).
- **Theme, locale, hints and context updates**, as the host sends them.

## Run it

From the repository root:

```bash
node src/serve.mjs
```

Open `http://localhost:7080/lab-simulator/` and choose **Try the sample
agent**. The simulator serves the agent from port 7081, so the two are
cross-origin, as a real lab and agent are. Open **Settings** in the
simulator to show the event log or change the Lab Agent policy.

To try the asking flow, keep the policy at "Learner: acts in the environment, asks first",
press **Open the Run dialog**, and answer **Allow once** over the console.
The host refuses the keys with `asking` until you answer, and the agent
retries for up to a minute. It doesn't ask you to send another message,
since a new learner message starts the asking over.

## Make it yours

- Put your hosts' origins in `HOST_ORIGINS`, and the same origins in your
  page's `Content-Security-Policy: frame-ancestors`.
- Send the chat to your backend, and verify the launch token
  (`host.session.init.authToken`) there
  ([core section 3.2](../../../docs/spec/core.md#32-authentication)).
- Report each model call's usage with `agent.usage.report.request`
  ([qa.md section 10](../../../docs/spec/qa.md#10-usage)).
- Declare `author` and `qa` only once you implement
  [author.md](../../../docs/spec/author.md) and
  [qa.md](../../../docs/spec/qa.md).
