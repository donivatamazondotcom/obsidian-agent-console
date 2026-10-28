# Kiro CLI Setup

[Kiro CLI](https://kiro.dev) is Amazon's AI coding CLI with built-in ACP support — no adapter needed.

## Install and Configure

1. Install Kiro CLI by following the instructions at [kiro.dev](https://kiro.dev). Once installed, the binary is named `kiro-cli`.

2. Find the installation path:

::: code-group

```bash [macOS/Linux]
which kiro-cli
# Example output: /usr/local/bin/kiro-cli
```

```cmd [Windows]
where.exe kiro-cli
# Example output: C:\Users\Username\.kiro\bin\kiro-cli.exe
```

:::

3. Open **Settings → Agent Console**. Switch to the **Kiro CLI** section.

4. Configure:
   - **Path**: `kiro-cli` (works in many cases via login shell PATH; or set the full path from step 2, or click **Auto-detect**)
   - **Arguments**: `acp` (set by default)

## Authentication

Run Kiro CLI in your terminal to trigger its sign-in flow:

```bash
kiro-cli
```

Follow the browser-based login. That's all — the Kiro CLI section has **no API key field**; Agent Console reuses the cached credential from your local Kiro config.

::: tip
Kiro CLI natively supports ACP, so no additional adapter is required. Just point Agent Console at the `kiro-cli` binary and you're set.
:::

## Use the V3 engine (preview)

Kiro CLI has a newer engine, V3. Some agent configs, such as recent auto-sa releases, only load on V3. If your custom agent never shows up and chats run the default agent instead, switch to V3:

1. In the **Kiro CLI** section, set **Kiro CLI engine** to **V3 (preview)**. If you run Kiro through a custom agent instead (for example one per Kiro profile), the same setting appears on that custom agent whenever its path is `kiro-cli`.
2. Keep your arguments as they are, for example `acp --agent auto-sa`. V3 doesn't accept `--agent`, `--model` or `--effort` on launch, so Agent Console passes them to each new chat instead. `--trust-all-tools` and `--trust-tools` are dropped; V3 uses its own permission rules.
3. Start a new chat.

With V3, your agent's hooks (start, prompt and stop) run in Agent Console chats too.

On V2, starting a new chat in the same tab restarts Kiro, so it takes a few seconds longer. That keeps each tab to one copy of your MCP servers. **Rename with AI** isn't available on V2 for the same reason. V3 has neither limit.

Pick the model, the [effort level](../usage/thought-level-selection.md) and other Kiro options (such as Autopilot or Supervised) from the dropdowns below the message box. The effort dropdown only shows for models that support it. Agent Console remembers your model and effort picks for the next chat. If a model you saved is no longer offered, the chat switches to the first model on the list and tells you. When you reopen an earlier chat from history or after a restart, it keeps the model, effort and mode it was using.

## Verify Setup

1. Click the robot icon in the ribbon or use the command palette: **"Open chat"**
2. Switch to Kiro CLI from the agent dropdown in the chat header
3. Try sending a message to verify the connection

Having issues? See [Troubleshooting](/help/troubleshooting).
