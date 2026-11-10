# Lab Agent SDK

How to build a **Lab Agent**: an agent that runs inside a Skillable
hands-on lab, embedded as an iframe in the lab's Lab Agent tab, and talks
to the lab over `postMessage`. A Lab Agent can mentor learners, help
authors build their lab, run QA on it, or any combination.

## Modes

An agent declares the modes it supports when it starts, and implements
the core protocol plus those modes. The lab never offers an agent more
than it declared.

| Mode | For | Spec |
|---|---|---|
| core | Every agent: embedding, the envelope, the handshake, context, the launch token, theming, capabilities, the policy and its refusals, versioning. | [docs/spec/core.md](./docs/spec/core.md) |
| `mentor` | Learners: coaching, pointing at the instructions and the console, acting in the environment, asking first, background commands, support signals and feedback. The default. | [docs/spec/mentor.md](./docs/spec/mentor.md) |
| `author` | Lab authors: activities and their definitions, suggested edits, variables, checks, the learner's view. | [docs/spec/author.md](./docs/spec/author.md) |
| `qa` | QA runs: the agent runs the lab on its own and records findings, results and a transcript. Needs `author` too. | [docs/spec/qa.md](./docs/spec/qa.md) |

[docs/spec/messages.md](./docs/spec/messages.md) lists every message
with its area, direction, pair, payload and limits.

## Where to start

1. Run the [quickstart](./docs/quickstart.md): `node src/serve.mjs`, then
   open the lab simulator with the sample agent.
2. Read [core.md](./docs/spec/core.md), then the modes you will declare.
3. Read the [sample agent](./src/wwwroot/sample-agent/README.md), core
   plus mentor mode in about 250 lines of plain JavaScript, and build
   yours against the simulator.

## Contents

| Path | What it is |
|---|---|
| `docs/spec/` | The protocol spec, by mode. |
| `docs/quickstart.md` | Run the simulator and the sample agent. |
| `src/wwwroot/lab-simulator/` | A simulated Skillable lab that embeds an agent and speaks the protocol. |
| `src/wwwroot/sample-agent/` | The sample agent. |
| `src/wwwroot/shared/` | Design tokens the simulator and the sample share. |
| `src/serve.mjs` | A dependency-free dev server for both. |
| `certs/` | Scripts that make a self-signed certificate for local HTTPS. No certificates or keys are kept here. |

## Status

The spec describes **protocol version 2**: messages named
`agent.{area}.{action}[.request]` and `host.{area}.{action}[.response]`,
envelope `version: 2`, and declared modes.
