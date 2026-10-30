# Mode Selection

Some agents support different operational modes that change how the agent behaves. **Agent** is the program you chat with. **Mode** is a setting that agent offers for each chat: for Kiro CLI, modes are your Kiro agents (built-in and custom); for Claude Code, they're permission modes.

## What are Modes?

Modes are predefined configurations that alter the agent's behavior for specific tasks. For example:

- **Default Mode**: General-purpose assistance
- **Plan Mode**: Focus on planning and architecture before implementation

## Changing Modes

1. Open the chat panel
2. Look for the **mode dropdown** below the input field
3. Select the desired mode from the available options

<p align="center">
  <img src="/images/mode-selection.webp" alt="Mode selection dropdown" />
</p>

::: tip
Available modes depend on the active agent. Not all agents support multiple modes.

To run a [quick prompt](./quick-prompts.md#choose-the-agent-and-mode) in a specific mode, add `mode:` to the prompt note.
:::

## Mode Persistence

The selected mode persists for the current session. Your preference is remembered across sessions.
