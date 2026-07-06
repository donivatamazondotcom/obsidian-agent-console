// I157: the plugin's chat view type. Namespaced to "agent-console-chat-view"
// so `registerView` can't collide with the upstream Agent Client plugin's
// legacy "agent-client-chat-view" registration when both plugins are enabled
// (the collision silently broke Agent Console's load for existing Agent Client
// users). Kept in its own module — separate from the heavy ItemView subclass in
// ChatView.tsx — so the constant is importable (by migrate-legacy-view-type.ts
// and its tests) without pulling in the full view.
export const VIEW_TYPE_CHAT = "agent-console-chat-view";
