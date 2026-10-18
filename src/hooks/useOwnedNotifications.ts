import { useCallback, useEffect } from "react";

import {
	closeNotificationsForOwner,
	retainNotification,
} from "../utils/notification-registry";

/**
 * Ties a panel's system notifications to the panel's lifetime (I52 round 8).
 *
 * Returns a `retain(notification, onClick)` function to use instead of
 * `retainNotification`. Every notification retained through it is owned by
 * `ownerId` (the panel's viewId, which equals its tab id). When the panel
 * unmounts — its tab was closed, or its view was torn down — the panel's
 * notifications are closed, so none survives into Notification Center with a
 * click handler that points at a panel that no longer exists.
 *
 * See [[I52 Notification click focuses wrong vault window]] § round 8.
 */
export function useOwnedNotifications(
	ownerId: string,
): (notification: Notification, onClick: (event: Event) => void) => void {
	useEffect(() => {
		return () => closeNotificationsForOwner(ownerId);
	}, [ownerId]);

	return useCallback(
		(notification: Notification, onClick: (event: Event) => void) =>
			retainNotification(notification, onClick, ownerId),
		[ownerId],
	);
}
