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

In the list, press **Enter** to fire a prompt — it sends right away, carrying the active note and any selection as context. Hold **⌥ (Alt)** or **⇧ (Shift)** while choosing to drop the text into the composer for editing instead of sending.

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

Click a chip to fire it; hold ⌥/⇧ and click to insert instead.

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
