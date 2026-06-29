# Switching Agents

Agent Console lets you hand a conversation from one agent to another without losing your place. It always asks before clearing anything, so you never lose work by accident.

## Bring your conversation to another agent

Open the agent menu in a tab and pick a different agent. If the current chat has messages, Agent Console asks whether to switch and bring those messages along:

- **Switch and bring messages** – starts a fresh chat with the new agent and gives it the earlier conversation as context, so it can pick up where you left off.
- **Cancel** – stays on the current agent; nothing changes.

When you switch and bring messages, the new tab shows the earlier conversation in a read-only **"Carried over from …"** block at the top. It stays there for the rest of the session so you can refer back to it – collapse it with its header button if you want it out of the way. Your first message to the new agent includes that earlier conversation as context.

One thing to know: the new agent *reads* the earlier messages, but it did not take part in them. It has the text, not the first agent's tools or working memory. For "keep going with a different model" this is usually exactly what you want.

The earlier conversation also stays saved in [Session History](/usage/session-history), so you can always reopen it with the original agent.

## Start a new chat without losing the old one

Starting a new chat in a tab that already has messages asks for confirmation first. Choose **New chat** to clear the tab and begin fresh, or **Cancel** to keep what is there. Either way, the conversation you were in stays saved in Session History.

## Restart an agent

Restarting an agent (a hard reload) begins the conversation fresh with the same agent. Because that clears the current chat, Agent Console asks first. See [Reloading a Session](/usage/reload-session) for the difference between a soft reload, which keeps your messages, and a hard reload, which starts fresh.
