import { accountChildIdentity } from '../../services/accountChildIdentity.js';
const identity = accountChildIdentity({});
if (identity.found) {
  // @ts-expect-error Raw persisted identity has not been validated as a string.
  const username: string = identity.value;
  void username;
}
