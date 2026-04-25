# Quickstart

Run the integration sandbox locally in about two minutes, then point it at
your own mentor iframe.

## Prerequisites

- .NET 8 SDK (`dotnet --version` should print `8.x`)
- Any modern browser
- **One-time on a new machine:** trust the ASP.NET Core HTTPS dev cert so
  the browser stops warning about `https://localhost`:

  ```bash
  dotnet dev-certs https --trust
  ```

  (If `dotnet dev-certs` isn't an option for you, see
  [HTTPS without the dev cert](#https-without-the-dev-cert) at the
  bottom.)

## 1. Run the sandbox

From the repo root:

```bash
cd src
dotnet run
```

The sandbox boots on `https://localhost:7080` (and `http://localhost:5080`,
which redirects to HTTPS).

## 2. Open the chooser

Visit **`https://localhost:7080/`** in your browser. You'll land on a
chooser page with two options:

- **Test a Mentor Agent** &mdash; paste the URL of the mentor iframe
  you're developing. Submitting opens the simulated lab with your iframe
  embedded in the **Mentor** tab.
- **View a Sample Integration** &mdash; opens the simulated lab with the
  sample chat agent pre-loaded. Useful as a working example of the
  full integration.

Either choice lands you on the same simulated lab page, just pointed at
different iframe URLs. The URL on that page contains a `?mentor=<url>`
query parameter so it's bookmarkable / shareable.

## 3. Drive your mentor end-to-end

Once the lab simulator is open, things to exercise:

- Open **Settings** (the gear icon in the sidebar) and enable
  **Show postMessage event log**. A floating panel appears that logs
  every message in either direction &mdash; invaluable while you're
  wiring up the contract.
- Click **"I'm stuck"** on the Instructions tab to send
  `host.hint.request` to your iframe.
- Click **Next** to flip to the next page of instructions; the host
  emits `host.context.update` with the new `currentPageIndex` and
  `pageTitle` so your mentor re-grounds on whatever the student is now
  reading.
- In **Settings &gt; Color Mode**, switch between Light and Dark to send
  `host.theme.change`. Verify your iframe re-themes live.
- The "Live environment" panel on the left is a static screenshot. When
  your mentor emits `mentor.sendTextToEnvironment`, the panel flashes
  green and a toast shows what would have been pasted into a real VM.

## 4. Configure CORS for your mentor's backend

If your mentor iframe makes `fetch` calls to its own backend, that
backend must allow the simulator's origin (`https://localhost:7080`).
Add `https://localhost:7080` to whatever CORS allow-list configuration
your stack uses.

The sample chat agent already does this; you only need to think
about it for your own mentor.

## 5. Set the iframe origin

When the simulated lab embeds your iframe, it appends a `parentOrigin`
query parameter to your URL (for example,
`https://localhost:5173/?parentOrigin=https://localhost:7080`). Your
iframe should:

- accept inbound `postMessage` only from that origin, and
- post outbound messages to that exact origin (not `"*"`).

See section 3.3 of [the integration spec](./mentor-integration-spec.md)
for the recommended pattern.

## HTTPS without the dev cert

If `dotnet dev-certs https --trust` is not an option (e.g. you're
running on a CI box or a shared VM), generate a self-signed `.pfx`:

```powershell
# Windows / PowerShell
./certs/create-self-signed-cert.ps1
```

```bash
# Linux / macOS (needs openssl)
./certs/create-self-signed-cert.sh
```

Both emit `src/certs/ai-mentor-integration-sandbox.pfx` (password `changeit` by
default). Then uncomment the `Kestrel` block in `src/appsettings.json`
so Kestrel loads it at startup.

## Next

- Read [the integration spec](./mentor-integration-spec.md) for the
  full protocol.
- The sample chat agent under `src/wwwroot/sample-chat-agent/` (with
  its backend in `src/`) is a working reference implementation of the
  iframe side of the contract. Use it as inspiration for your own.
