# FAQ

Frequently asked questions about Agent Console.

## General

### What is Agent Console?

Agent Console is an Obsidian plugin that lets you chat with AI agents directly within Obsidian. It supports Claude Code, Codex, Gemini CLI, and any ACP-compatible agent. The plugin uses the [Agent Client Protocol (ACP)](https://agentclientprotocol.com/) to communicate with agents.

### Is this an official Anthropic/OpenAI/Google plugin?

No. Agent Console is a community-developed plugin. It uses official agent packages but is not affiliated with any AI provider.

### Does this work on mobile?

No. Agent Console is desktop-only. Agents run as local processes, which is not supported on mobile devices.

### Is my data sent to AI providers?

Yes. When you send a message, it's processed by the AI provider behind your selected agent (Anthropic, OpenAI, Google, etc.). Review each provider's privacy policy for details.

## Note Mentions

### How do I reference my notes in a conversation?

Type `@` in the input field and a dropdown appears with matching notes. Select a note to insert a mention in `@[[Note Name]]` format. The note's content is sent to the agent.

See [Note Mentions](/usage/mentions) for details.

### Is there a length limit on notes I send?

Nothing to configure – long notes and selections are sent as a truncated preview (up to 10,000 characters) plus a link to the full note, so the agent can read the rest on demand. It's automatic.

### Is the note I'm looking at included automatically?

Yes. On a fresh chat, the note you have open rides along as a provisional pill in the [context strip](/usage/context-strip) and pins into the conversation when you send your first message. Prefer to start every chat empty? Turn it off under **Settings → Agent Console → Chat behavior → Active note as default context**.

### Can I include just part of a note?

Yes. Select text in your note before sending and only that selection is sent as context. Long selections are sent as a truncated preview with a link back to the full note.

### How do I drop the active note from one chat?

Remove its pill in the [context strip](/usage/context-strip) – click the ✕ on the pill, or focus it and press Backspace. To stop the active note being added by default at all, turn off **Settings → Agent Console → Chat behavior → Active note as default context**.

## Agents

### How do I switch between agents?

Click the **⋮** (ellipsis) menu in the chat header. Under **"Switch agent"**, select the agent you want to use. This is a one-time change for that view only.

To change the default agent for new chat views, go to **Settings → Agent Console → Default agent**.

### Can I run multiple agents at the same time?

Yes. Click the **+** in the tab bar to open a new tab – each tab runs an independent agent session. Right-click the **+** to start the new tab on a different agent, and use the Broadcast commands to drive several at once.

See [Tabbed Sessions](/usage/tabbed-sessions) for details.

### How do I send the same prompt to multiple agents?

Use the **Broadcast** commands:
1. Type your prompt in one chat view
2. Open command palette and run **"Broadcast prompt"** to copy it to all views
3. Run **"Broadcast send"** to send simultaneously

### Where do new chat views open?

Agent Console runs in the sidebar and multiplexes with in-panel tabs, so new chats open as tabs in the same panel – not as separate editor panes. Choose which sidebar it docks in under **Settings → Agent Console → Display → Sidebar side** (left or right).

### What is a custom agent?

Any ACP-compatible agent beyond the built-in ones (Claude Code, Codex, Gemini CLI). You can add custom agents in **Settings → Agent Console → Custom agents**. See [Custom Agents](/agent-setup/custom-agents).

### Do all agents support the same features?

No. Features like slash commands, modes, and models depend on the agent. The plugin adapts its UI based on what the agent supports. For example, the mode dropdown only appears if the agent provides multiple modes.

## Slash Commands

### Why don't I see slash commands?

Slash commands are provided by the agent, not the plugin. If the input placeholder doesn't show `/ for commands`, your current agent doesn't support slash commands.

### Why are the commands different from what I expected?

Each agent provides its own commands. Claude Code, Codex, and Gemini CLI all have different command sets. Refer to your agent's documentation for available commands.

## Permissions

### Why does the agent ask for permission?

Some agents request permission before performing certain actions (like editing files or running commands). This is a safety feature controlled by the agent.

### Can I auto-approve all permissions?

Yes. Enable **Settings → Agent Console → Permissions → Auto-allow permissions**. Use with caution—this gives agents full access without confirmation prompts.

### Some agents don't ask for permission at all?

Correct. Permission behavior is agent-specific. Some agents may edit files directly without requesting permission.

## Exporting

### How do I export a conversation?

Click the **export button** in the chat header. The conversation is saved as a Markdown file in your vault.

### Where are exports saved?

By default, exports are saved to the `Agent Console` folder in your vault. You can change this in **Settings → Agent Console → Export → Export folder**.

### Can I auto-export conversations?

Yes. Enable **Auto-export on new chat** or **Auto-export on close chat** in export settings.

### Can I customize the frontmatter tag?

Yes. In **Settings → Agent Console → Export → Frontmatter tag**, you can set a custom tag. Nested tags like `projects/agent-console` are supported.

## Session History

### How do I resume a previous conversation?

Click the **History** button (clock icon) in the chat header to open the session history modal. Select a session and click **Restore** to reopen it in a new tab, right where you left off.

See [Session History](/usage/session-history) for details.

### What's the difference between Restore and Fork?

**Restore** reopens the session in a **new tab**, right where you left off – your current chat is untouched, and the agent reconnects when you send your first message. **Fork** branches the session into a **new tab** and starts creating that branch immediately, so you can explore a different direction without changing the original. Fork works with any agent: agents that support server-side forking keep the assistant's full context, while others start a fresh session that shows the earlier transcript for reference.

### The modal says "This agent does not support session restoration"

This appears only when a session can't be reopened at all – the agent advertises no restore capability **and** Agent Console has no locally saved transcript to reopen from. Whenever a local transcript exists, Restore stays available: it reopens the session in a new tab and reconnects on your first message. You can always view and delete locally saved sessions.

### Are my sessions saved automatically?

Yes. The plugin automatically saves session metadata and message history when you send messages. Sessions are stored locally in Obsidian's data folder.

### Can I delete old sessions?

Yes. Open the session history modal and click the **Delete** button (trash icon) on any session. Deletion is permanent.

## Windows

### What is WSL mode?

WSL (Windows Subsystem for Linux) mode runs agents inside a Linux environment on Windows. Enable it in **Settings → Agent Console → Windows Subsystem for Linux → Enable WSL mode**. This is useful for agents that work better in Linux environments.

### Do I need to specify a WSL distribution?

Only if you have multiple WSL distributions installed and want to use a specific one. Leave it empty to use your default distribution.

## Cost & Billing

### Is Agent Console free?

The plugin itself is free and open source. However, using AI agents may incur costs depending on the agent and your authentication method.

### API key vs account login—what's the difference?

- **API key**: Billed per usage by the AI provider. You pay for what you use.
- **Account login**: Uses your subscription's included usage. May have limits depending on your plan.

## Getting Help

### Where can I get help?

1. Check the [Troubleshooting](/help/troubleshooting) page
2. Search [GitHub Issues](https://github.com/donivatamazondotcom/obsidian-agent-console/issues)
3. Open a new issue if your problem isn't covered

### How do I report a bug?

[Open an issue on GitHub](https://github.com/donivatamazondotcom/obsidian-agent-console/issues/new) with:
- Your OS and Obsidian version
- The agent you're using
- Steps to reproduce
- Error messages (enable **Debug Mode** in **Settings → Agent Console**)
