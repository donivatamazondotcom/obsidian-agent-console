# Commands & Hotkeys

All commands available in Agent Console. Open the command palette (`Cmd/Ctrl + P`) to access them, or assign keyboard shortcuts in **Settings → Hotkeys**.

::: tip
Most commands operate on the **last focused chat view** — click a chat view to focus it before running a command. The navigate, act-on-chat, and broadcast commands appear only once at least one chat view is open, so a fresh install's palette shows just the three start-a-chat commands below.
:::

## Start a chat

Always available, including from a cold start with no chat view open. **New chat** and **New chat with agent…** open a *new tab* — to clear and restart the conversation in the current tab instead, use **Hard reload session (fresh)**.

| Command | Description |
|---------|-------------|
| **Open chat** | Reveal the chat panel, creating one if none is open |
| **New chat** | Open a new tab with a fresh chat — opens a panel first if none is open |
| **New chat with agent…** | Pick an agent from a list, then open a new tab with a fresh chat on it |

<p align="center">
  <img src="/images/command-palette.webp" alt="Obsidian command palette filtered to Agent Console, showing Open chat, New chat, and New chat with agent" width="560" />
</p>

<p align="center">
  <img src="/images/new-chat-agent-picker.webp" alt="Agent Console New chat with agent picker listing the configured agents" width="460" />
</p>

## Act on the current chat

These appear only when a chat view is open.

| Command | Description |
|---------|-------------|
| **Reload session** | Reload the current session under a fresh harness, resuming the same conversation (agent process respawned, MCP servers reloaded) |
| **Hard reload session (fresh)** | Restart the agent and start a brand-new session (clears the transcript) |
| **Cancel current message** | Stop the agent's current response |
| **Export chat** | Export the current conversation to a note |
| **Toggle active note in context** | Pin or unpin the active note in the context strip |
| **Approve active permission** | Approve the current permission request |
| **Reject active permission** | Reject the current permission request |

## Navigate

These appear only when a chat view is open.

| Command | Description |
|---------|-------------|
| **Focus next chat view** | Move focus to the next chat view |
| **Focus previous chat view** | Move focus to the previous chat view |
| **Next session tab** | Switch to the next tab in the active panel |
| **Previous session tab** | Switch to the previous tab in the active panel |
| **Close session tab** | Close the active tab |
| **Reopen closed session tab** | Reopen the most-recently-closed tab and restore its conversation — transcript, agent, label, and pinned context. Repeat to walk further back (browser-style Cmd+Shift+T). Closed tabs are remembered for the current session only |
| **Reopen closed view** | Reopen the whole panel you last closed, restoring its entire tab set — every tab, the active tab, each conversation, and any unsent draft. The per-*panel* analog of the per-*tab* command above. Opening the panel normally (ribbon / **Open chat**) always starts fresh; this command is how you bring a closed panel back. Remembered for the current session only |

## Settings Commands

| Command | Description |
|---------|-------------|
| **Import settings from another agent plugin** | Import agent definitions, defaults, and API keys from another plugin (e.g. Agent Client). Shows a preview first. See [Importing Settings](/usage/importing-settings). |

## Broadcast Commands

Control multiple tabs at once. These appear only when a chat view is open. See [Tabbed Sessions](/usage/tabbed-sessions) for details.

| Command | Description |
|---------|-------------|
| **Broadcast prompt** | Copy the active tab's input to all other tabs (every view) |
| **Broadcast send** | Send messages in all tabs simultaneously |
| **Broadcast cancel** | Cancel operations in all tabs |

::: info Upgrading from an earlier version?
v1.2.0 simplified the start-a-chat commands. **Open new chat view**, **New session tab**, and the per-agent **Switch agent to [Agent]** commands were removed — use **New chat** and **New chat with agent…** instead. If you had hotkeys bound to any of the removed commands, rebind them under **Settings → Hotkeys**.
:::
