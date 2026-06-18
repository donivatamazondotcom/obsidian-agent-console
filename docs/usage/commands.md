# Commands & Hotkeys

All commands available in Agent Console. Open the command palette (`Cmd/Ctrl + P`) to access them, or assign keyboard shortcuts in **Settings → Hotkeys**.

::: tip
Commands operate on the **last focused chat view**. Click on a chat view to focus it before running a command.
:::

## Chat Commands

| Command | Description |
|---------|-------------|
| **Open chat view** | Open the chat panel |
| **Open new chat view** | Open an additional chat view |
| **New chat** | Start a fresh conversation |
| **Reload session** | Reload the current session under a fresh harness, resuming the same conversation (agent process respawned, MCP servers reloaded) |
| **Hard reload session (fresh)** | Restart the agent and start a brand-new session (clears the transcript) |
| **Cancel current message** | Stop the agent's current response |
| **Export chat** | Export the current conversation to a note |
| **Toggle auto-mention** | Toggle auto-mention of the active note |
| **Approve active permission** | Approve the current permission request |
| **Reject active permission** | Reject the current permission request |
| **Focus next chat view** | Move focus to the next chat view |
| **Focus previous chat view** | Move focus to the previous chat view |

## Settings Commands

| Command | Description |
|---------|-------------|
| **Import settings from another agent plugin** | Import agent definitions, defaults, and API keys from another plugin (e.g. Agent Client). Shows a preview first. See [Importing Settings](/usage/importing-settings). |

## Broadcast Commands

Control multiple tabs at once. See [Tabbed Sessions](/usage/tabbed-sessions) for details.

| Command | Description |
|---------|-------------|
| **Broadcast prompt** | Copy the active tab's input to all other tabs (every view) |
| **Broadcast send** | Send messages in all tabs simultaneously |
| **Broadcast cancel** | Cancel operations in all tabs |

## Agent Commands

| Command | Description |
|---------|-------------|
| **Switch agent to [Agent Name]** | Switch to a specific agent in the last active view |

::: tip
Agent-specific commands are generated automatically based on your configured agents.
:::
