/**
 * In-memory "show the card anyway" flag for the "Show what's new" command
 * (I300). One per plugin load, shared by every chat view; never persisted.
 * Shaped for `useSyncExternalStore`.
 */
export interface WhatsNewForcedStore {
	subscribe: (listener: () => void) => () => void;
	get: () => boolean;
	set: (value: boolean) => void;
}

export function createWhatsNewForcedStore(): WhatsNewForcedStore {
	let value = false;
	const listeners = new Set<() => void>();
	return {
		subscribe: (listener) => {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		get: () => value,
		set: (next) => {
			if (next === value) return;
			value = next;
			for (const l of listeners) l();
		},
	};
}
