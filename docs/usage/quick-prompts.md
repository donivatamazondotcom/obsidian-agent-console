# Quick Prompts

Save the prompts you type over and over — "debrief this meeting", "summarize the selection", "get the latest on this project" — as little markdown notes, then fire them in one click. No more retyping the same kickoff every session.

A quick prompt is just a note in a folder. The note's `label` is the button text; the note body is the prompt that gets sent. Add a note, and the prompt shows up right away — no restart.

## Set up the folder

By default Agent Console reads quick prompts from a folder named `Quick Prompts` in your vault. Change it under **Settings → Agent Console → Chat behavior → Quick prompts folder**.

Make a note in that folder for each prompt:

````markdown
---
label: "🗓️ Debrief meeting"
---
Debrief this meeting — pull the AI summary, extract action items, and update the vault note.
````

- **Label** comes from the `label` field (emoji welcome). If there's no `label`, Agent Console falls back to `name`, then `title`, then the filename. (`description` is intentionally not used — it clashes with the common note-summary field.)
- **Prompt text** is everything below the frontmatter.

## Fire a prompt

Two ways, depending on whether you can already see the prompt:

- **Chips above the composer** — click one to fire it (see [Contextual chips](#contextual-chips) below).
- **Type `!` at the start of a line in the message box** — a search opens right where you're typing, the same place `@` mentions a note and `/` runs a command. Keep typing to filter, then press **Enter** to fire. (It only triggers at the start of a line, so an everyday `!` in your prose won't open it.) No need to leave the composer, so it's the fastest way to run any prompt.

You can also run **Quick prompts: Search** from the command palette (`Cmd/Ctrl + P`) — or bind it to a hotkey under **Settings → Hotkeys** — to drop a `!` into the composer and open the search hands-free.

Firing sends the prompt right away in the current chat, carrying the active note and any selection as context. Modifier keys change where it goes and whether it sends, mirroring how links open in a browser:

On Windows and Linux, use **Ctrl** / **Alt** / **Shift** wherever these show ⌘ / ⌥ / ⇧ — Agent Console shows the keys for your system automatically.
- **⌘ (Cmd) + Enter** → send in a **new tab**, in the background. Add **⇧ (Shift)** — ⌘⇧Enter — to switch to the new tab as it opens.
- **⌥ (Alt) + Enter** → drop the text into the composer to edit first, instead of sending.

The same keys work when you click a chip (below). The `!` search shows this legend right in the dropdown, so you don't have to remember it.

## Use your selection

Reference the text you have highlighted with the `{{selection}}` placeholder:

````markdown
---
label: "Summarize selection"
---
Summarize the following concisely:

{{selection}}
````

When you fire this with text selected in a note, the selection is filled in and sent. If nothing is selected, the prompt drops into the composer instead of sending — so you never fire a half-formed prompt by accident.

## Open in a new tab

Some prompts kick off a whole new conversation — "debrief this meeting", "get the latest on this project". Tick **`open in new tab`** in the note's properties and firing the prompt opens a fresh chat tab and sends it there, leaving your current conversation untouched:

````markdown
---
label: "🗓️ Debrief meeting"
open in new tab: true
---
Debrief this meeting — pull the AI summary, extract action items, and update the vault note.
````

- `open in new tab` is a checkbox property — toggle it in the note's Properties view, no typing.
- Firing it always opens a new tab on your default agent and sends there — even if your current tab is mid-reply or has a message queued. A new-tab chip stays active while current-tab chips are locked.
- A plain click **switches to** the new tab; hold **⌘ (Cmd)** to open it in the **background** (you stay put) — Agent Console shows a brief "Started … in a new tab" note so you know it's running.
- Hold **⌥ (Alt)** to open the new tab and drop the text into its composer for editing instead of sending.
- A `{{selection}}` prompt with nothing selected opens the new tab and seeds its composer (with a heads-up) rather than sending half-formed.

## Contextual chips

Prompts can show up as **chips right above the composer**. There are two ways to make a prompt appear as a chip — otherwise it stays search-only (you'll still find it by typing `!` in the composer, it just doesn't take up space in the row).

**Show a chip only on relevant notes** — add a `show on tags` field to scope a prompt to matching notes:

````markdown
---
label: "🗓️ Daily brief"
show on tags: [NoteType/DailyNote]
---
Give me the daily brief for this note.
````

**Show a chip everywhere** — tick the **`always show`** checkbox for prompts you reach for on any note ("new chat", "debrief"):

````markdown
---
label: "🚀 Start a debrief"
always show: true
---
Debrief the meeting I just had.
````

- A prompt with **`always show`** is a chip on every note.
- A prompt with **`show on tags`** is a chip only when the active note carries a matching tag. Matching is nested — `NoteType` matches a note tagged `NoteType/DailyNote`.
- A prompt with **neither** is **search-only** — never in the chip row, always one keystroke away by typing `!`. This is the default, so new prompts don't clutter the row until you opt them in.
- `always show` is a checkbox property — toggle it in the note's Properties view, no typing.
- When no prompts apply to the note you're in, there's **no chip row at all** — the space is reclaimed.

Click a chip to fire it in the current chat. Hold **⌘** to send it in a new tab (⌘⇧ to switch there), or **⌥** to drop it into the composer to edit first — the same keys as the `!` search. When the row runs out of space, a **+N** at the end folds the rest into the `!` search.

## How it works with a busy agent

Quick prompts behave exactly like typing a message and pressing Enter, so they follow the same rules as the [queue-next-message](/usage/tabbed-sessions) behavior:

- **Agent idle** → the prompt sends and starts a turn.
- **Agent streaming a reply** → the prompt queues and sends the moment the current reply finishes.
- **A message already queued** → current-tab chips disable in place (a small lock marks them) until you send or edit the queued message. The `!` search stays reachable the whole time.
- **You have unsent text in the composer** → firing drops the prompt into your draft at the cursor instead of sending, so your half-typed message is never overwritten.

## Tips

- Keep prompt notes short and action-oriented — they're kickoffs, not essays.
- Use emoji in the `label` to make chips and the `!` search easy to scan.
- Prompts are plain notes, so you can version them, grep them, and share them like any other note.
