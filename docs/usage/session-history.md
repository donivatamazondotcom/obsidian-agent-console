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
| **Restore** | Reopen the session in a **new tab**, right where you left off — your current chat is never replaced |
| **Fork** | Branch the session into a **new tab**. Works with any agent — see Fork below for how context is (or isn't) carried over |
| **Delete** | Remove the session from history |

::: tip
Restore and Fork don't require a connected agent — opening a session reconnects automatically on your first message. Both are offered whenever a session can be reopened (from the agent or from local data).
:::

## Session Storage

Sessions are saved automatically when you send messages. The plugin stores:

- **Session metadata**: Title (the AI-suggested session title once it resolves, otherwise derived from your first message), timestamps, and working directory
- **Message history**: Full conversation including agent responses, tool calls, and plans

### Where Sessions Are Stored

Sessions are saved in two places:

- **Plugin side**: Stored locally in Obsidian's data folder
- **Agent side**: Managed by the agent

## Restore

Restoring a session reopens it in a **new tab** — your current chat is left untouched. If the session is already open in another tab, you're switched to that tab instead.

1. The session opens in a new tab with its conversation history displayed
2. The agent reconnects automatically when you send your first message — no need to connect first
3. New messages continue the same session

Use restore when you want to **continue where you left off** without losing your current chat.

### Fork

Forking opens a **new tab** that branches from a previous session:

1. The new tab opens immediately, showing the conversation up to that point
2. The original session and your current chat both remain unchanged
3. New messages go to the forked branch

Use fork when you want to **explore a different direction** without affecting the original conversation.

**Agent support.** Fork works with any agent, but how much context carries over depends on the agent:

- Agents that support server-side forking (`session/fork`) create a true branch that keeps the assistant's full context.
- Other agents start a **fresh session** that shows the prior transcript for reference, but the assistant won't have the earlier conversation's context (the transcript is stored locally, not on the agent). You'll see a one-time notice on the first reply — the same notice shown when restoring a session that only exists on disk.

## Deleting Sessions

To delete a session:

1. Click the **Delete** button (trash icon) on the session
2. Confirm the deletion in the dialog

::: warning
Deletion removes the session from the plugin's local storage only. The session still exists on the agent side.
:::

## Troubleshooting

### "This agent does not support restoring sessions"

This appears only when a session can't be reopened at all — the agent advertises no restore capability **and** there's no locally saved transcript to reopen from. Whenever local data exists, Restore stays available (it reopens the session in a new tab and reconnects on your first message). You can always view and delete locally saved sessions.

### "Preparing agent..."

The agent is still initializing. Wait a moment for the agent to become ready.

### "No previous sessions"

No sessions have been saved yet for the current agent and vault. Start a new conversation to create your first session.
