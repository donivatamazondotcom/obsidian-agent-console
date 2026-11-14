import { useCallback, useEffect } from "react";

import {
	closeNotificationsForOwner,
	showOwnedNotification,
} from "../services/notification-registry";

/**
 * Posts a panel's system notifications and ties them to the panel's lifetime
 * (I52 rounds 8–9).
 *
 * Returns `notify(title, options, onClick)`. The registry constructs the
 * notification and gives it a fresh tag (`<ownerId>:<suffix>`) — reusing the
 * tab id as the tag made a tab's later notifications lose their click (round
 * 9). When the panel unmounts (tab closed, or view torn down), its
 * notifications are marked for removal after the app-wide quiet period, and a
 * click on one in the meantime only raises the window.
 *
 * See [[I52 Notification click focuses wrong vault window]] § rounds 8–9.
 */
export function useOwnedNotifications(
	ownerId: string,
): (
	title: string,
	options: NotificationOptions,
	onClick: (event: Event) => void,
) => Notification | null {
	useEffect(() => {
		return () => closeNotificationsForOwner(ownerId);
	}, [ownerId]);

	return useCallback(
		(
			title: string,
			options: NotificationOptions,
			onClick: (event: Event) => void,
		) => showOwnedNotification({ owner: ownerId, title, options, onClick }),
		[ownerId],
	);
}
