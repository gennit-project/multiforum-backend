import type {Channel} from '../../src/generated/graphql.js';
import type {forumMembershipSelection} from './forumMembershipSelection.js';

type SelectedFields=Required<Pick<Channel,keyof typeof forumMembershipSelection>>;
/** Completed fixed internal GraphQL data, not an entire Channel model.
 * DateTime completion is textual; unrestricted JSON fields remain unknown.
 * Every selected key exists, including explicit nulls for nullable fields.
 */
export type ForumMembershipChannel=Omit<SelectedFields,'createdAt'|'lockedAt'|'variantUrls'|'rules'|'pluginPipelines'> & {
 createdAt:string;
 lockedAt:string|null;
 variantUrls:unknown;
 rules:unknown;
 pluginPipelines:unknown;
};
export type ForumMembershipWriteResult={channels:ForumMembershipChannel[]};
