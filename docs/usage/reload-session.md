# Reloading a Session

The **↻** button in the chat header gives the agent a clean process without losing your place — the same way a browser's refresh button reloads a page. It does two things depending on how you click it:

- **Reload** (plain click) keeps your conversation.
- **Restart** (Shift-click) starts over with a fresh, empty session.

It works alongside the other browser-style controls: **+** opens a new tab (a brand-new conversation), and the **history** button browses past sessions.

<p align="center">
  <img src="/images/reload-control.webp" alt="Agent Console chat header with the reload button among the header actions" />
</p>

## Reload (click)

Click the **↻** button to reload. Agent Console:

- Restarts the agent process and reloads its MCP servers (a fresh, clean harness)
- Resumes the **same** conversation, so the transcript stays exactly where it was
- Keeps everything on screen — nothing is cleared

This is the everyday control. Reach for it when a tool connection went bad or you just want the agent to start fresh without throwing away the chat.

While the reload runs, the **↻** icon spins and a "Reloading session…" notice appears, so you always know it's working. A "Session reloaded" notice confirms when it's done.

::: tip
Resuming the same conversation needs an agent that supports session resume. If your agent can't resume, Agent Console keeps the transcript visible and starts a fresh session underneath — only the live agent loses context; your conversation stays on screen.
:::

## Restart (Shift-click)

Hold **Shift** and click the **↻** button to restart. This restarts the agent and starts a **brand-new** session, clearing the transcript — the equivalent of a browser's hard refresh. If you have auto-export turned on, the current chat is exported first.

Use Restart when you want a truly clean slate but want to stay in the same tab.

## From the command palette

Two commands do the same thing without the mouse, so you can bind your own hotkeys under **Settings → Hotkeys**:

| Command | What it does |
|---------|--------------|
| **Reload session** | Resume the same conversation under a fresh agent process |
| **Restart session (fresh)** | Fresh session, transcript cleared |

## Reload vs. new chat

- **Reload (↻)** keeps you in the same conversation; **Shift-click (Restart)** starts over in place.
- **New chat (+)** opens a separate tab with its own fresh conversation, leaving the current one untouched.
