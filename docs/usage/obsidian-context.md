# Obsidian context

When you start a chat, Agent Console gives the agent a short briefing about where it's running — so it acts like a natural part of Obsidian from the very first message, without you having to explain your setup.

By default the agent is told four things:

- **It's running in Obsidian** — so it knows the app it's working inside.
- **How your replies are shown** — your messages render as Obsidian-flavored Markdown, so the agent knows to use clickable `[[links]]`, math, and Mermaid diagrams, and they'll display properly.
- **Its working folder** — the folder this chat is working in.
- **It can work with your notes** — the agent is told it can read and edit your notes to build things with you. This one is only sent when the chat is running inside your vault, so the agent is never told it can touch notes it can't actually reach.

This happens once, on the first message of each chat. Later messages don't repeat it.

## Choose what's included

Open **Settings → Community plugins → Agent Console** and find the **Obsidian context** section.

Each of the four items above has its own switch — turn off anything you'd rather not send. The agent still works either way; these just help it fit in better.

## Write your own briefing

Want exact control? The **Custom briefing** box lets you type your own text to send instead of the switches above. Leave it blank to use the switches — the box shows the default briefing as a preview, so you can see exactly what gets sent.

When you type your own briefing, it's sent word-for-word and the switches above are ignored.

## Start over

**Reset to defaults** turns all four switches back on and clears any custom briefing — handy if you've experimented and want the original behavior back.

::: tip
Not sure what to change? Leave everything on. The default briefing is short and helps any agent work more naturally in your vault.
:::
