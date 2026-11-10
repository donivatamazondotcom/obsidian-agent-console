# Antigravity CLI Setup

[Antigravity CLI](https://antigravity.google/docs/cli/acp/) (`agy`) is Google's command-line coding agent and the successor to Gemini CLI. It has ACP built in (`agy acp`), so no adapter is needed. Agent Console ships it as a built-in agent.

::: warning Check Google's terms before you sign in
Google's [ACP guide](https://antigravity.google/docs/ide/extensions/acp/) shows editors running `agy acp` with your Antigravity sign-in. Google's [FAQ](https://antigravity.google/docs/faq) also says that using third-party software with an Antigravity login breaks its Terms of Service, and recommends a Gemini Enterprise or Google AI Studio API key for third-party coding agents. If that applies to you, use the [API key option](#option-b-gemini-api-key) below.
:::

## Install and Configure

1. Install Antigravity CLI by following [Google's instructions](https://antigravity.google/docs/cli/getting-started). On macOS with Homebrew:

```bash
brew install --cask antigravity-cli
```

2. Confirm your version includes ACP:

```bash
agy acp --help
```

3. Find the installation path:

::: code-group

```bash [macOS/Linux]
which agy
# Example output: /opt/homebrew/bin/agy
```

```cmd [Windows]
where.exe agy
```

:::

4. Open **Settings → Agent Console** and open the **Antigravity CLI** page. The default **Path** (`agy`) works in many cases. If the agent isn't found, set the full path from step 3, or click **Auto-detect**.

5. Keep **Arguments** set to `acp` (the default).

Added `agy acp` as a custom agent before this built-in existed? Delete that custom agent under **Custom agents**, so Antigravity doesn't appear twice in your agent lists. If your custom agent has a different id, chats you started with it keep running on it until you delete it. If you gave it the id `antigravity-acp`, those chats already run on the built-in, and Agent Console renames the custom agent with a `-2` suffix the next time you edit its id.

## Authentication

### Option A: Google account sign-in

1. Run Antigravity CLI once in a terminal and sign in:

```bash
agy
```

To sign in without a browser (for example over SSH), run `agy acp --login` instead.

2. In Agent Console, leave the **API key** field empty. Antigravity CLI reuses the sign-in you just made.

### Option B: Gemini API key

1. Get an API key from [Google AI Studio](https://aistudio.google.com/apikey).
2. In **Settings → Agent Console → Antigravity CLI → API key**, choose or create a secret with the key.

Agent Console passes the key to Antigravity CLI as `GEMINI_API_KEY`. The key is kept in Obsidian's secret storage, not in your vault's plugin settings. When a key is chosen, it replaces any `GEMINI_API_KEY` in the **Environment variables** field. If the chosen secret has no value on this device (for example after your settings synced from another computer), Antigravity CLI starts with an empty key, which also overrides a `GEMINI_API_KEY` in **Environment variables**: it works only if you have signed in with `agy`. Choose the secret again or clear the field.

## Models and thinking level

Antigravity CLI offers a **Model** and a **Thinking level** picker in the chat composer. The chat header shows the model you picked; the thinking level shows as **Effort** in the header tooltip.

## Optional arguments

Add these after `acp` in **Arguments**:

| Argument | What it does |
|---|---|
| `--disable-telemetry` | Turns off Antigravity CLI's telemetry for this agent |
| `--sandbox` | Runs commands with terminal sandbox restrictions |
| `--log-file <path>` | Writes the agent's log to a file you choose |

Google's [ACP guide](https://antigravity.google/docs/ide/extensions/acp/) lists every flag.

## Verify Setup

1. Click the robot icon in the ribbon or use the command palette: **"Open chat"**
2. Switch to Antigravity CLI from the agent menu in the chat header
3. Send a message to check the connection

## Troubleshooting

- **"Session Creation Failed … Authentication required"** – Antigravity CLI isn't signed in. Run `agy` once in a terminal to sign in, or set an API key (Option B), then try again.
- **The agent doesn't start** – run `agy acp --help` in a terminal. If it works there but not in Agent Console, set **Path** to the full path from `which agy`.
- **More detail** – Antigravity CLI writes logs to `~/.gemini/antigravity-cli/log/`.

Having other issues? See [Troubleshooting](/help/troubleshooting).
