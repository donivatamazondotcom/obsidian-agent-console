# Tabbed Sessions

Run multiple AI agents in parallel as tabs in the chat sidebar.

::: tip Headline feature
Tabs are how Agent Console handles multi-session work. Each tab is an independent agent session with its own scroll position, mode, and model — you switch between them without losing context.
:::

## Why tabs

AI agents work asynchronously. Tell one to research a topic, another to fix a bug, a third to draft documentation. Tabs let you keep all three open, switch among them while they work, and come back when each is ready.

Status icons on each tab tell you at a glance which agent needs attention.

## The tab bar

The tab bar appears at the top of the chat sidebar. Each tab shows:

- **Label** — auto-generated from the first message; editable via right-click rename
- **Status icon** — at-a-glance signal:
  - 🟢 Ready (waiting for your next message)
  - ⏳ Busy (agent is generating)
  - ❓ Permission needed (agent paused on a tool call)
  - ⚠️ Disconnected (agent process exited)
- **Close button** (×) — appears on hover

A `+` button on the right of the tab bar opens a new tab.

## Creating tabs

Three ways:

1. **+ button** at the right of the tab bar — opens a new tab with the active tab's agent
2. **Right-click the +** to pick a different agent for the new tab (agent picker)
3. **Command palette** → "New tab" — same as the + button

Each new tab starts a fresh agent process. The tab inherits the active note as context if `Auto-mention active note` is enabled.

## Switching tabs

- **Click a tab** to switch
- **Hotkeys** — assign in Settings → Hotkeys:
  - `Focus next chat view` (recommend `Cmd/Ctrl + ]`)
  - `Focus previous chat view` (recommend `Cmd/Ctrl + [`)
- **Scroll position is preserved** — each tab remembers where you left it

## Reordering tabs

**Drag a tab** along the tab bar to reorder. The order persists for the session.

## Renaming tabs

Right-click a tab → **Rename**. Names must be unique within the session (duplicate rename is rejected). Names persist across reloads if the session was saved.

## Closing tabs

- **Close button** (×) on the tab — visible on hover
- **Middle-click** the tab
- **Right-click → Close** — same as ×
- **Right-click → Close Others** — closes every tab except this one
- **Right-click → Close to the Right** — closes all tabs to the right of this one

You can't close the last tab — at least one tab always remains. The chat sidebar always has an active session.

## Forking from a tab

Right-click → **Fork From Here** creates a new tab branched from the current session's history at this point. Useful for "what if I asked the same question differently" without losing the original conversation.

## Per-tab state

Each tab independently tracks:

- Agent process and session ID
- Mode and model
- Scroll position
- Input text (switching away doesn't lose what you were typing)
- Attached files (images, notes)
- Permission queue (pending tool-call approvals)

Switching tabs preserves all of this.

## Tab error recovery

If a tab crashes (rare; usually due to an agent process error), the tab shows an error boundary with a **Retry** button. Click Retry to reset just that tab without affecting others.

## Maximum tabs

Configure in **Settings → Agent Console → Tabs → Maximum tabs**. Default: 10. Past the maximum, new-tab creation is rejected with a notice.

## Sidebar placement (left or right)

Agent Console lives in the sidebar — dockable on the **left or right**. Multiplexing happens through in-panel session tabs, not separate editor panes. Choose the side under **Settings → Agent Console → Display → Sidebar side**.

Each sidebar pane manages its own tabs independently. Open Agent Console in both the left and right sidebars and each keeps its own set of tabs, restoring them separately across restarts.

## Broadcast commands

Control multiple tabs at once from the command palette:

| Command | Description |
|---------|-------------|
| **Broadcast prompt** | Copy the active tab's input text and images to all other tabs |
| **Broadcast send** | Send messages in all tabs simultaneously |
| **Broadcast cancel** | Cancel ongoing operations in all tabs |

::: tip
Broadcast send is useful for comparing how different agents respond to the same prompt. Pair it with `Broadcast prompt` to set up the same question across tabs.
:::

## Persistence across restarts

Open tabs survive an Obsidian restart. When you quit and reopen, each sidebar pane brings back its own tabs — same order, same active tab, each tab's conversation visible right away. Turn this off under Settings → Tabs → "Restore tabs on startup" (on by default). Panes restore independently; split views don't merge into one.

## Lazy sessions

Opening a tab no longer starts an agent session immediately. The session connects the moment you start typing, so you can open a tab just to reread an old conversation without starting an agent. A restored tab reconnects to its previous session on your first keystroke. If that session is gone — the agent restarted or it expired — the tab transparently continues from a transcript of the earlier conversation and shows a one-time notice that the agent's internal state from before wasn't recovered.

## See also

- [Session history](/usage/session-history) — browse past sessions, restore any in a new tab
- [Commands & Hotkeys](/usage/commands) — full list of keyboard shortcuts
