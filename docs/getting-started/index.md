# Installation

## Install the Plugin

### From Community Plugins (recommended)

Agent Console is available in the official Obsidian Community Plugins marketplace. This is the simplest install path, and Obsidian keeps it updated automatically.

1. Open **Settings → Community Plugins → Browse**
2. Search for "Agent Console"
3. Click **Install**, then **Enable**

### Manual Installation

For users who prefer to install manually:

1. Download the latest release files from [GitHub Releases](https://github.com/donivatamazondotcom/obsidian-agent-console/releases):
   - `main.js`
   - `manifest.json`
   - `styles.css`
2. Create the plugin folder: `<vault>/.obsidian/plugins/agent-console/`
3. Place the downloaded files in this folder
4. Enable the plugin in **Obsidian Settings → Community Plugins**

## Prerequisites

### Node.js

::: tip Not always required
Node.js is needed for npm-based agents like Claude Code, Codex, and Gemini CLI. If your agent is a standalone binary, you can skip this step.
:::

If you need Node.js:

1. Download from [nodejs.org](https://nodejs.org/)
2. Install the LTS version (recommended)

### Find Your Node.js Path

If auto-detect doesn't find Node.js, you can locate it manually. Open a terminal (Terminal on macOS/Linux, PowerShell on Windows) and run:

::: code-group

```bash [macOS/Linux]
which node
# Example output: /usr/local/bin/node
```

```cmd [Windows]
where.exe node
# Example output: C:\Program Files\nodejs\node.exe
```

:::

### Configure Node.js Path

In most cases, the plugin automatically finds Node.js through your login shell's PATH, so no configuration is needed. If Node.js is not detected automatically:

1. Open **Settings → Agent Console**
2. Click the **Auto-detect** button next to the **Node.js path** field, or enter the path manually

## Next Steps

Continue to [Quick Start](./quick-start) to set up your first agent and start chatting!
