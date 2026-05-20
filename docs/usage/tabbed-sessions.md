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

## Multi-session via separate views (alternative)

In addition to tabs in the sidebar, Agent Console supports opening multiple separate chat views (right pane, editor area, split). This is preserved from upstream for users who prefer side-by-side panels.

| Location | Description |
|----------|-------------|
| **Right pane (tabs)** (default) | Opens in the right sidebar with tabs |
| **Editor area (tabs)** | Opens as a tab in the editor area |
| **Editor area (split)** | Opens in a new split pane |

Configure in **Settings → Agent Console → Display → Chat view location**.

For most users, tabs in the right sidebar is the recommended setup. Multiple separate views are useful for side-by-side comparisons across editor splits.

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

## See also

- [Floating chat](/usage/floating-chat) — alternative single-window UX, kept for users who prefer it
- [Session history](/usage/session-history) — browse past sessions, restore any in a new tab
- [Commands & Hotkeys](/usage/commands) — full list of keyboard shortcuts
