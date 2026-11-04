import type {Driver} from 'neo4j-driver';
import type {AccountObjectMutationResolvers} from '../../customResolvers/contracts/accounts.js';
import {createDiscussionsFromInput} from '../../customResolvers/mutations/createDiscussionWithChannelConnections.js';
import shareCollection from '../../customResolvers/mutations/shareCollectionAsDiscussion.js';
declare const driver:Driver;
const checked:AccountObjectMutationResolvers['shareCollectionAsDiscussion'] = shareCollection({driver});
// @ts-expect-error a successful batch cannot be empty
const empty:Awaited<ReturnType<typeof createDiscussionsFromInput>> = [];
// @ts-expect-error dependencies must preserve the nonempty successful result contract
shareCollection({driver,createDiscussions:async()=>[]});
void [checked,empty];
