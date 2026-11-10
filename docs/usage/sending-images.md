# Sending Images and Files

Attach images and files to your messages to provide context to the AI agent.

## Attaching Files

### The Attach Button

1. Click the paperclip at the right of the text area, just above the send button
2. Pick one or more files in the file picker that opens
3. Thumbnails (images) or file icons (other files) appear below the text area

From the keyboard: press `Tab` from the text area to reach the paperclip, then `Enter` or `Space` to open the picker. After you pick, the cursor goes back to the text area.

<p align="center">
  <img src="/images/attach-button.webp" alt="The paperclip above the send button in the Agent Console composer, with its Attach files tooltip" class="inline-shot" width="560" />
</p>

### Drag and Drop

1. Drag files from Finder/Explorer onto the input area
2. The input area highlights when you drag over it
3. Thumbnails (images) or file icons (other files) appear below the text area

### Paste from Clipboard

1. Copy a file or image to your clipboard
2. Focus the input field
3. Paste with `Cmd/Ctrl + V`

<p align="center">
  <img src="/images/sending-images.webp" alt="Sending Images and Files" />
</p>

::: info
Images can be attached once the agent has connected (usually a second or two). Clicking the paperclip starts connecting, so a picked image usually goes straight in. If you attach an image before then, you'll see `[Agent Console] Still connecting to the agent – attach the image again in a moment.` (or `… paste the image again …` for a paste) – just try again once it connects. If the agent didn't start, reload the chat first.
:::

::: tip
Embedding images in messages requires agent support. If the agent doesn't support images, image files are sent as file references instead (via the paperclip, drag and drop, or paste from Finder/Explorer). They show as a file chip instead of a thumbnail; hover it to see why. The agent can open the file with its own tools.
:::

## Managing Attachments

Attached files appear as thumbnails or file icons below the text area.

- **Remove an attachment**: Hover over it and click the **×** button. From the keyboard, `Tab` to the **×** (it shows when focused) and press `Enter`, `Delete` or `Backspace`; focus moves to the next attachment, so you can clear several in a row
- **Attachments are sent with your message**: When you send, all attached files are included
- **While a message is queued**, its attachments are locked in with it: you can't add or remove files until it sends. The paperclip says so, and a drop or paste shows `[Agent Console] Wait for the queued message to send, then attach files.`

<p align="center">
  <img src="/images/remove-image.webp" alt="Remove attachment button" class="inline-shot" width="360" />
</p>

## Supported Image Formats

| Format | MIME Type |
|--------|-----------|
| PNG | `image/png` |
| JPEG | `image/jpeg` |
| GIF | `image/gif` |
| WebP | `image/webp` |

Non-image files have no format restriction.

::: info
Non-image files are sent as file path references. How the agent processes the file depends on its capabilities and available tools.
:::

::: tip
To give the agent a note from your vault, pin it in the context strip or `@`-mention it instead – see [Context Strip](./context-strip.md) and [Note Mentions](./mentions.md). That sends the note's content, not just its path.
:::

## Limits

| Limit | Value |
|-------|-------|
| Maximum image size | 5 MB per image |
| Maximum attachments | 10 per message (images + files combined) |

::: info
If you exceed these limits, a notification will inform you:
- `[Agent Console] Image too large (max 5MB)`
- `[Agent Console] Maximum 10 attachments allowed`

At 10 attachments the paperclip is greyed out and says so.
:::
