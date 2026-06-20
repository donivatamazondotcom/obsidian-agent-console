# Troubleshooting

This guide covers common issues and solutions for Agent Console.

## Connection Issues

### "Connecting to [Agent]..." doesn't complete

The plugin is trying to start the agent process but isn't receiving a response.

**Common causes:**
- Incorrect agent path
- Missing Node.js
- Agent not installed

**Solutions:**

1. **Verify the agent path** in **Settings → Agent Console → [Agent Name] → Path**
   - On macOS/Linux, find the path with: `which claude-agent-acp`
   - On Windows, find the path with: `where claude-agent-acp`

2. **Verify Node.js path** in **Settings → Agent Console → Node.js path**
   - Many agents require Node.js
   - Find it with: `which node` (macOS/Linux) or `where node` (Windows)

3. **Reload the plugin** after changing path settings (disable then re-enable in Settings → Community plugins)

### "Command Not Found" error

The agent executable cannot be found at the specified path.

**Solutions:**

1. Verify the agent is installed by running it directly in Terminal
2. Try the **Auto-detect** button in the agent's path setting, or use the full absolute path
3. On Windows, include the `.cmd` extension if needed

Agent Console captures your interactive login shell's `PATH` (the same one your terminal uses, including entries added in `.zshrc`/`.bashrc` such as version-manager shims or `~/.toolbox/bin`) and uses it when launching agents, so a bare command name usually resolves without any path configuration. If it still can't be found, set the full absolute path.

## Authentication Issues

### "Authentication Required" error

The agent requires authentication before processing requests.

**For Claude Code:**
- **API key**: Set in **Settings → Agent Console → Claude Code (ACP) → API key**
- **Account login**: Run `claude` in Terminal first and complete the login flow

**For Codex:**
- Set your OpenAI API key in **Settings → Agent Console → Codex → API key**

**For Gemini CLI:**
- Set your Google API key in **Settings → Agent Console → Gemini CLI → API key**
- Or run `gemini` in Terminal first to authenticate with your Google account

### "No Authentication Methods" error

The agent didn't provide authentication options.

**Solution:** Check your agent configuration. The agent may not be properly initialized—try reloading the plugin.

## Rate Limiting

### "Rate Limit Exceeded" error

You've sent too many requests.

**Solutions:**

1. Wait before sending another message
2. Check your usage limits at the provider's console:
   - Anthropic: [console.anthropic.com](https://console.anthropic.com/)
   - OpenAI: [platform.openai.com](https://platform.openai.com/)
   - Google: [console.cloud.google.com](https://console.cloud.google.com/)

## Session Issues

### "Session Creation Failed" error

The agent connected but couldn't create a session.

**Solutions:**

1. Click **+** in the tab bar to open a fresh session (or **Shift-click** the **↻ Reload** button to restart the agent with a fresh session)
2. Check if your vault path contains special characters that might cause issues
3. Reload the plugin

### "Agent Not Found" error

The selected agent ID doesn't exist in settings.

**Solution:** Go to **Settings → Agent Console** and select a valid agent from the **Active agent** dropdown.

## Message Sending Issues

### "Cannot Send Message" error

No active session available.

**Solutions:**

1. Wait for the connection to complete (status shows agent name, not "Connecting...")
2. Click **+** in the tab bar to create a fresh session (or run **New chat** from the command palette)

### "Send Message Failed" error

The message was sent but the agent returned an error.

**Solutions:**

1. Check the error message for details
2. Verify your API key or login status
3. Try a simpler message to test the connection

## Export Issues

### "Failed to export chat" notification

The conversation couldn't be saved.

**Solutions:**

1. Check that the export folder exists (**Settings → Agent Console → Export → Export folder**)
2. Verify the folder name is valid (no special characters that aren't allowed in folder names)
3. Check the filename template for invalid characters (**Settings → Agent Console → Export → Filename**)

## Multi-Device Vault Sync

### Agent paths break when syncing across machines

If you sync your vault (e.g., via Nextcloud, Syncthing, or iCloud) across machines with different environments (macOS, Linux, WSL2), absolute paths stored in `data.json` will not work on every machine.

**Solution:** Leave the agent path and Node.js path fields **empty**. The plugin uses bare command names by default (e.g., `claude-agent-acp`) and resolves them through each machine's login shell PATH.

## Windows-Specific Issues

### WSL mode not working

**Prerequisites:**
- WSL must be installed: Run `wsl --status` in Command Prompt
- A Linux distribution must be installed: Run `wsl --list`

**Settings:**
- Enable **Settings → Agent Console → Windows Subsystem for Linux → Enable WSL mode**
- Optionally specify your distribution in **WSL distribution**

### Agent works in Terminal but not in Obsidian

The PATH environment may differ between Terminal and Obsidian.

**Solutions:**

1. Try the **Auto-detect** button, or use full absolute paths for both agent and Node.js
2. Enable WSL mode for better compatibility
3. Add the agent's directory to your system PATH (not just user PATH)

## macOS-Specific Issues

### Agent installed via Homebrew not found

Agent Console captures your login shell's `PATH`, so Homebrew binaries (and version-manager shims) are normally found automatically. If one still isn't:

**Solution:** Try the **Auto-detect** button, or use the full path (find it with `which <agent-name>` in Terminal).

## Linux-Specific Issues

### Agent not found when using Flatpak version of Obsidian

The Flatpak version of Obsidian runs in a sandbox that cannot access paths like `/usr/local/bin`.

**Solution:** Use the AppImage or .deb version of Obsidian instead of Flatpak.

### Agent works in Terminal but not in Obsidian

Desktop applications on Linux may not inherit PATH settings from `.bashrc`.

**Solutions:**

1. Try the **Auto-detect** button, or use the full absolute path (e.g., `/usr/local/bin/gemini`)
2. Ensure the agent is installed in a standard location (`/usr/bin` or `/usr/local/bin`)

## Debug Mode

If you need more detailed information about an issue, enable Debug mode:

1. Go to **Settings → Agent Console → Developer → Debug mode**
2. Enable the toggle
3. Open DevTools:
   - macOS: `Cmd + Option + I`
   - Windows/Linux: `Ctrl + Shift + I`
4. Go to the **Console** tab
5. Filter by these prefixes:
   - `[AcpClient]` - Agent process and connection
   - `[AcpHandler]` - Agent event handling
   - `[PermissionManager]` - Permission requests
   - `[VaultService]` - Vault access
   - `[useAgentSession]` - Session management

## Common Error Messages

| Error | Meaning | Quick Fix |
|-------|---------|-----------|
| Command Not Found | Agent executable not at specified path | Check Path setting |
| Authentication Required | API key missing or login needed | Add API key or run agent in Terminal first |
| No Authentication Methods | Agent configuration issue | Reload the plugin |
| Rate Limit Exceeded | Too many API requests | Wait and retry |
| Session Creation Failed | Agent couldn't start session | Click New Chat |
| Agent Not Found | Invalid agent ID in settings | Select valid agent |
| Cannot Send Message | No active session | Wait for connection or click New Chat |
| Send Message Failed | Agent returned an error | Check error details |

## Updating Agent Console

Obsidian updates community plugins for you when a new version is released. When an update is waiting, the chat header shows a **Plugin update available!** pill. Click it to open **Settings → Community plugins**, then update Agent Console from there.

The pill is a shortcut into Obsidian's own updater — it doesn't update in place, so your open conversations stay connected until you choose to update and reload.

## Getting Help

If you're still experiencing issues:

1. Enable **Debug mode** and check console logs
2. Search [GitHub Issues](https://github.com/donivatamazondotcom/obsidian-agent-console/issues)
3. Open a new issue with:
   - Your OS and Obsidian version
   - The agent you're using
   - Steps to reproduce
   - Error messages from Debug mode
