# Reloading a Session

The **↻ Reload** button in the chat header restarts the agent without losing your place — the same way a browser's refresh button reloads a page. Use it when the agent feels stuck, after you change an MCP server or agent setting, or any time you want a clean agent process while keeping the conversation in front of you.

It works alongside the other browser-style controls: **+** opens a new tab (a brand-new conversation), and the **history** button browses past sessions. Reload is the refresh in that set.

## Soft reload (click)

Click the **↻** button for a soft reload. Agent Console:

- Restarts the agent process and reloads its MCP servers (a fresh, clean harness)
- Resumes the **same** conversation, so the transcript stays exactly where it was
- Keeps everything on screen — nothing is cleared

This is the everyday reload. Reach for it when a tool connection went bad or you just want the agent to start fresh without throwing away the chat.

While the reload runs, the **↻** icon spins and a "Reloading session…" notice appears, so you always know it's working. A "Session reloaded" notice confirms when it's done.

::: tip
Resuming the same conversation needs an agent that supports session resume. If your agent can't resume, Agent Console keeps the transcript visible and starts a fresh session underneath, then tells you the shown history is local only.
:::

## Hard reload (Shift-click)

Hold **Shift** and click the **↻** button for a hard reload. This restarts the agent and starts a **brand-new** session, clearing the transcript — the equivalent of a browser's hard refresh. If you have auto-export turned on, the current chat is exported first.

Use a hard reload when you want a truly clean slate but want to stay in the same tab.

## From the command palette

Two commands do the same thing without the mouse, so you can bind your own hotkeys under **Settings → Hotkeys**:

| Command | What it does |
|---------|--------------|
| **Reload session** | Soft reload — resume the same conversation under a fresh agent |
| **Hard reload session (fresh)** | Hard reload — fresh session, transcript cleared |

## Reload vs. new chat

- **Reload (↻)** keeps you in the same conversation (soft) or restarts the agent in place (hard).
- **New chat (+)** opens a separate tab with its own fresh conversation, leaving the current one untouched.
