# Quick Prompts

Save the prompts you type over and over — "debrief this meeting", "summarize the selection", "get the latest on this project" — as little markdown notes, then fire them in one click. No more retyping the same kickoff every session.

A quick prompt is just a note in a folder. The note's description is the button label; the note body is the prompt that gets sent. Add a note, and the prompt shows up right away — no restart.

## Set up the folder

By default Agent Console reads quick prompts from a folder named `Quick Prompts` in your vault. Change it under **Settings → Agent Console → Quick prompts → Quick prompts folder**.

Make a note in that folder for each prompt:

````markdown
---
description: "🗓️ Debrief meeting"
---
Debrief this meeting — pull the AI summary, extract action items, and update the vault note.
````

- **Label** comes from the `description` field (emoji welcome). If there's no `description`, Agent Console falls back to `name`, then `title`, then the filename.
- **Prompt text** is everything below the frontmatter.

## Fire a prompt

There are two ways to reach your prompts:

- **The ⚡ button** in the composer toolbar (bottom-left) opens a searchable list of every prompt. It stays reachable even while the agent is busy.
- **The Quick prompt picker command** (`Cmd/Ctrl + P`, then search for it) opens the same list, and you can bind it to a hotkey under **Settings → Hotkeys**.

In the list, press **Enter** to fire a prompt — it sends right away in the current chat, carrying the active note and any selection as context. Modifier keys change where it goes and whether it sends, mirroring how links open in a browser:

- **⌘ (Cmd) + Enter** → send in a **new tab**, in the background. Add **⇧ (Shift)** — ⌘⇧Enter — to switch to the new tab as it opens.
- **⌥ (Alt) + Enter** → drop the text into the composer to edit first, instead of sending.

The same keys work when you click a chip (below).

## Use your selection

Reference the text you have highlighted with the `{{selection}}` placeholder:

````markdown
---
description: "Summarize selection"
---
Summarize the following concisely:

{{selection}}
````

When you fire this with text selected in a note, the selection is filled in and sent. If nothing is selected, the prompt drops into the composer instead of sending — so you never fire a half-formed prompt by accident.

## Open in a new tab

Some prompts kick off a whole new conversation — "debrief this meeting", "get the latest on this project". Tick **`open in new tab`** in the note's properties and firing the prompt opens a fresh chat tab and sends it there, leaving your current conversation untouched:

````markdown
---
description: "🗓️ Debrief meeting"
open in new tab: true
---
Debrief this meeting — pull the AI summary, extract action items, and update the vault note.
````

- `open in new tab` is a checkbox property — toggle it in the note's Properties view, no typing. (Notes that still use the older `newTab: true` keep working.)
- Firing it always opens a new tab on your default agent and sends there — even if your current tab is mid-reply or has a message queued. A new-tab chip stays active while current-tab chips are locked.
- A plain click **switches to** the new tab; hold **⌘ (Cmd)** to open it in the **background** (you stay put) — Agent Console shows a brief "Started … in a new tab" note so you know it's running.
- Hold **⌥ (Alt)** to open the new tab and drop the text into its composer for editing instead of sending.
- A `{{selection}}` prompt with nothing selected opens the new tab and seeds its composer (with a heads-up) rather than sending half-formed.

## Contextual chips

Prompts can show up as **chips right above the composer**, but only when they're relevant to the note you're in. Add a `tags` field to scope a prompt to matching notes:

````markdown
---
description: "🗓️ Daily brief"
tags: [NoteType/DailyNote]
---
Give me the daily brief for this note.
````

- A prompt with **no `tags`** always shows as a chip.
- A prompt with `tags` shows only when the active note carries a matching tag. Matching is nested — `NoteType` matches a note tagged `NoteType/DailyNote`.
- When no prompts match the note you're in, there's **no chip row at all** — the space is reclaimed.

Click a chip to fire it in the current chat. Hold **⌘** to send it in a new tab (⌘⇧ to switch there), or **⌥** to drop it into the composer to edit first — the same keys as the picker.

## How it works with a busy agent

Quick prompts behave exactly like typing a message and pressing Enter, so they follow the same rules as the [queue-next-message](/usage/tabbed-sessions) behavior:

- **Agent idle** → the prompt sends and starts a turn.
- **Agent streaming a reply** → the prompt queues and sends the moment the current reply finishes.
- **A message already queued** → current-tab chips disable in place (a small lock marks them) until you send or edit the queued message. The ⚡ launcher stays reachable the whole time.
- **You have unsent text in the composer** → firing drops the prompt into your draft at the cursor instead of sending, so your half-typed message is never overwritten.

## Tips

- Keep prompt notes short and action-oriented — they're kickoffs, not essays.
- Use emoji in the `description` to make chips and the picker easy to scan.
- Prompts are plain notes, so you can version them, grep them, and share them like any other note.
