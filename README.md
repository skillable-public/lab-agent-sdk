# Lab Agent SDK

How to build a Lab Agent: an agent that runs inside a Skillable lab. It can mentor learners, help authors build their lab, run QA on it, or any combination.

## Status

This repository is new and takes over from [ai-mentor-integration-sandbox](https://github.com/skillable-public/ai-mentor-integration-sandbox). The spec is being reorganized by mode (core, mentor, author, QA), and its message names will change in a new protocol version. Until then, the documents here describe protocol version 1, which Skillable labs speak today.

## Contents

| Path | What it is |
|---|---|
| [docs/mentor-integration-spec.md](./docs/mentor-integration-spec.md) | The integration spec: embedding, authentication, the postMessage contract, security rules, versioning. Read this first. |
| [docs/quickstart.md](./docs/quickstart.md) | Written for the sandbox; being updated for this repository. |
| `src/wwwroot/lab-simulator/` | A simulated Skillable lab page that embeds your agent and drives the contract. |

Until the quickstart is updated, run the simulator from the [sandbox repository](https://github.com/skillable-public/ai-mentor-integration-sandbox), which still hosts it with a sample agent.
