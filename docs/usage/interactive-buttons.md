# Clickable choices

When an agent offers you a small set of options — "minimal fix or full refactor?", "which file first?" — it can show them as **buttons right in the reply**. Click one and your pick is sent back as a normal message. No retyping the option you want.

## How it works

Agents learn this ability from the [Obsidian system prompt](/usage/obsidian-context): a default-on item teaches them to offer choices as buttons when it genuinely helps. The agent's reply still explains the options in words — the buttons are a faster way to answer, not a replacement for reading.

- **Buttons activate when the reply finishes.** While the agent is still writing, they show up but stay off.
- **One click, one answer.** After you pick, your choice is highlighted and the other buttons fade. The choice group is answered once — the agent's next reply carries on from your pick.
- **Your pick is a visible message.** Clicking sends a regular message that starts with a line like `Selected: Complete migration`, with the machine-readable details tucked behind a small expander. Nothing is sent invisibly.
- **Keyboard works everywhere.** Tab to a button, press Enter or Space — same as clicking.

## When buttons wait

Buttons only work when the chat is ready for a new message. If a reply is still streaming, a message is already queued, or the conversation is still loading, the buttons stay off with a short tooltip explaining why. They come back as soon as the chat is idle.

## Safety

The buttons are drawn entirely by Agent Console using your theme — agents can't inject their own styling, images, links, or code. A button can only ever do one thing: send a message you can see. And the label on the button is never trusted blindly — the sent message always shows the real underlying choice, so what you clicked and what was sent can't quietly differ.

## Turning it off

Open **Settings → Community plugins → Agent Console → Obsidian system prompt** and switch off **Offer clickable choices**. New chats stop teaching agents the ability; any choice blocks in old replies simply show as code.

::: tip
If a reply shows a code block labeled `a2ui` instead of buttons, that block didn't pass Agent Console's safety checks (or this ability is switched off). The conversation still works — just answer by typing.
:::
