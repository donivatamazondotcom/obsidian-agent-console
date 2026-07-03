# Editing

Agent Console allows AI agents to edit files in your vault and working directory.

## How Editing Works

When you ask the agent to modify files:

1. The agent proposes changes
2. You see the proposed edits in the chat
3. The agent may request permission to apply changes
4. Changes are applied to your files

<p align="center">
  <img src="/images/editing.webp" alt="Editing files with agents" />
</p>

## Permission Controls

Some agents request permission before performing certain actions. When a permission request appears:

1. Review the proposed action
2. Select one of the available options provided by the agent

::: tip
Permission options vary by agent. Some agents may not request permission at all and edit files directly.
:::

### Auto-Allow Permissions

In **Settings → Agent Console → Permissions → Auto-allow permissions**, you can automatically allow all permission requests from agents.

::: warning
Use with caution—this gives agents full access to your system without confirmation prompts.
:::

## Viewing Changes

The chat displays file changes with:

- **File path**: Which file was modified
- **Diff view**: What was added/removed (when available)
- **Status**: Success or failure of the operation

### Collapsed tool calls and diffs

Tool calls – including file diffs – render as a single collapsed row showing the tool name, status, and line count. Click the row to expand it and read the full detail. Failed calls stay collapsed but are flagged so you can spot them, and pending permission requests expand automatically. See [MCP Tools](/usage/mcp-tools) for more on how tool calls appear.

## Best Practices

1. **Use version control**: Keep your vault in Git before letting agents edit
2. **Review changes**: Check diffs before confirming major modifications
3. **Start small**: Test with minor edits before complex changes

## Undo Changes

If an agent makes unwanted changes:

- Use **Editor**: Cmd/Ctrl+Z in the affected file
- Use **Git**: `git checkout -- <file>` or `git restore <file>` (if your vault is version-controlled)
