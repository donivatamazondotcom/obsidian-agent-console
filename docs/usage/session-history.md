# Session History

Resume previous conversations, search across them, or branch off from past sessions.

## Agent Support

Session history features are agent-specific. Not all agents support all features.

## Opening Session History

Click the **History** button (clock icon) in the chat header to open the session history modal.

<p align="center">
  <img src="/images/session-history-button.webp" alt="Session history button in chat header" />
</p>

## Searching Sessions

A search box sits at the top of the history modal. Type to filter the list as you go:

- **Title match** is instant.
- **Content match** searches inside your saved transcripts — so you can find a session by something that was *said* in it, even when the title doesn't mention it. The first time you focus the search box the plugin indexes your transcripts (a brief "Searching transcripts…" note shows while it works); after that, filtering is immediate.

Matches that hit message content show a short snippet with the term highlighted, so you can confirm it's the right session before opening it. Search is fully local — no agent connection required.

## Available Actions

Depending on the agent's capabilities, you can perform the following actions:

| Action | Description |
|--------|-------------|
| **Search** | Filter the list by title or message content as you type |
| **Edit title** | Rename the session from the history modal |
| **Restore** | Resume the session where you left off |
| **Fork** *(experimental)* | Create a new branch from that point — only shown for agents that advertise the experimental session-fork capability |
| **Delete** | Remove the session from history |

::: tip
Not all actions are available for every agent. The modal shows only the actions supported by your current agent.
:::

## Session Storage

Sessions are saved automatically when you send messages. The plugin stores:

- **Session metadata**: Title (derived from your first message), timestamps, and working directory
- **Message history**: Full conversation including agent responses, tool calls, and plans

### Where Sessions Are Stored

Sessions are saved in two places:

- **Plugin side**: Stored locally in Obsidian's data folder
- **Agent side**: Managed by the agent

## Restore vs Fork

### Restore

Restoring a session continues the existing conversation:

1. The agent reconnects to the previous session
2. Your conversation history is displayed
3. New messages continue the same session

Use restore when you want to **continue where you left off**.

### Fork

Forking creates a new session branching from a previous point:

1. A new session is created with a copy of the conversation up to that point
2. The original session remains unchanged
3. New messages go to the forked session

Use fork when you want to **explore a different direction** without affecting the original conversation.

::: warning
Forking relies on an **experimental** agent capability (`session/fork`). The Fork action only appears when your agent advertises support — most agents currently do not, so you may never see it.
:::

## Deleting Sessions

To delete a session:

1. Click the **Delete** button (trash icon) on the session
2. Confirm the deletion in the dialog

::: warning
Deletion removes the session from the plugin's local storage only. The session still exists on the agent side.
:::

## Troubleshooting

### "This agent does not support session restoration"

The current agent doesn't provide session restore/fork capabilities. You can still view and delete locally saved sessions.

### "Preparing agent..."

The agent is still initializing. Wait a moment for the agent to become ready.

### "No previous sessions"

No sessions have been saved yet for the current agent and vault. Start a new conversation to create your first session.
