# OpenCode Setup

[OpenCode](https://opencode.ai) is an open-source, single-binary AI coding agent with built-in ACP support — no adapter needed. It's the easiest way to run Agent Console fully offline against a local model.

## Install and Configure

1. Install OpenCode with its one-line installer:

::: code-group

```bash [macOS/Linux]
curl -fsSL https://opencode.ai/install | bash
```

```cmd [Windows]
:: See opencode.ai for the current Windows install options
```

:::

2. Find the installation path:

::: code-group

```bash [macOS/Linux]
which opencode
# Example output: /Users/you/.opencode/bin/opencode
```

```cmd [Windows]
where.exe opencode
```

:::

3. Open **Settings → Agent Console**. Switch to the **OpenCode** section.

4. Configure:
   - **Path**: `opencode` (works in many cases via login shell PATH; or set the full path from step 2, or click **Auto-detect**)
   - **Arguments**: `acp` (set by default)

## Choose a model

Agent Console only launches OpenCode over ACP — it doesn't pick the model. OpenCode chooses its own model and sign-in through its config, so there's **no API key field** in the OpenCode section here.

Pick a model in OpenCode itself: run `opencode` once in a terminal, use the `/connect` command to add a provider, then `/models` to choose one. OpenCode supports cloud providers (Anthropic, OpenAI, and many others) as well as local models.

## Run local models (offline) with ollama

OpenCode can talk to a local model server, so your chats never leave your machine. This is configured in **OpenCode's own config file**, not in Agent Console.

1. Install [ollama](https://ollama.com) and pull a model with a large context window and strong tool-calling (for example, a Qwen-Coder variant):

   ```bash
   ollama pull qwen2.5-coder
   ```

2. Add ollama as a provider in your OpenCode config at `~/.config/opencode/opencode.json`:

   ```json
   {
     "$schema": "https://opencode.ai/config.json",
     "provider": {
       "ollama": {
         "npm": "@ai-sdk/openai-compatible",
         "name": "Ollama (local)",
         "options": {
           "baseURL": "http://localhost:11434/v1"
         },
         "models": {
           "qwen2.5-coder": {
             "name": "Qwen2.5 Coder (local)",
             "limit": {
               "context": 65536,
               "output": 8192
             }
           }
         }
       }
     }
   }
   ```

3. Run `opencode`, then `/models`, and pick the local model.

::: tip
Give the model plenty of context — a 64k+ context window keeps long chats and tool calls working. In ollama, raise `num_ctx` if tool calls misbehave (start around 16k–32k). See OpenCode's [providers guide](https://opencode.ai/docs/providers/) for the full list of options.
:::

::: info
Agent Console spawns `opencode acp` and speaks the protocol; the model backend lives entirely in OpenCode. That separation is deliberate — the plugin stays model-agnostic, so the same OpenCode setup works whether you point it at ollama, a cloud provider, or anything else OpenCode supports.
:::

## Verify Setup

1. Click the robot icon in the ribbon or use the command palette: **"Open chat"**
2. Switch to OpenCode from the agent dropdown in the chat header
3. Try sending a message to verify the connection

Having issues? See [Troubleshooting](/help/troubleshooting).
