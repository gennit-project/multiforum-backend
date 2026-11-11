import { accountChildIdentity } from '../../services/accountChildIdentity.js';
const identity = accountChildIdentity({});
if (identity.found) {
  // @ts-expect-error Raw persisted identity has not been validated as a string.
  const username: string = identity.value;
  void username;
}

import { userChildIdentityAtPaths } from '../../middleware/userChildIdentityMiddleware.js';
import { rememberAuthorSourceType } from '../../services/authorSourceType.js';
// @ts-expect-error Only the explicitly supported author union may be registered.
userChildIdentityAtPaths([{path: ['Author'], userUnion: 'ArbitraryUnion'}]);
// @ts-expect-error Source discriminators cannot be arbitrary strings.
rememberAuthorSourceType({}, 'Admin');
