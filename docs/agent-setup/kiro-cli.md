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

Follow the browser-based login. Once authenticated, leave the **API key field empty** in Agent Console — Kiro CLI reuses the cached credential from your local config.

::: tip
Kiro CLI natively supports ACP, so no additional adapter is required. Just point Agent Console at the `kiro-cli` binary and you're set.
:::

## Verify Setup

1. Click the robot icon in the ribbon or use the command palette: **"Open chat view"**
2. Switch to Kiro CLI from the agent dropdown in the chat header
3. Try sending a message to verify the connection

Having issues? See [Troubleshooting](/help/troubleshooting).
