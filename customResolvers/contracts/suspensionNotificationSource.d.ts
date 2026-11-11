/** The native RETURN CASE emits these literals, never persisted user data.
 * An absent row is separately mapped to user-not-found by the repository. */
export type SuspensionNotificationRow={status:'created'|'disabled'|'duplicate'};
export type SuspensionNotificationStatus=SuspensionNotificationRow['status']|'user-not-found';
