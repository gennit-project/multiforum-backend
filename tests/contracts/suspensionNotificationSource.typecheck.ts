import type {SuspensionNotificationRow,SuspensionNotificationStatus} from '../../customResolvers/contracts/suspensionNotificationSource.js';
// @ts-expect-error no persisted arbitrary status is part of the CASE projection
const arbitrary:SuspensionNotificationRow={status:'other'};
// @ts-expect-error user-not-found is a repository fallback, not a returned row
const absentRow:SuspensionNotificationRow={status:'user-not-found'};
// @ts-expect-error the selected status key cannot be missing
const missing:SuspensionNotificationRow={};
const absentResult:SuspensionNotificationStatus='user-not-found';
void [arbitrary,absentRow,missing,absentResult];
