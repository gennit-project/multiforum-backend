import type {MutationUpdateCommentsArgs,MutationUpdateDiscussionsArgs,MutationUpdateEventsArgs} from '../../src/generated/graphql.js';
import type {canEditCommentsHandler} from '../../rules/permission/canEditComments.js';
import type {canEditDiscussionsHandler} from '../../rules/permission/canEditDiscussions.js';
import type {canEditEventsHandler} from '../../rules/permission/canEditEvents.js';
declare const comments:MutationUpdateCommentsArgs;
declare const discussions:MutationUpdateDiscussionsArgs;
declare const events:MutationUpdateEventsArgs;
const commentInput:Parameters<typeof canEditCommentsHandler>[1]=comments;
const discussionInput:Parameters<typeof canEditDiscussionsHandler>[1]=discussions;
const eventInput:Parameters<typeof canEditEventsHandler>[1]=events;
// @ts-expect-error generated ID filters contain strings, never a nested filter as the ID value
const malformed:Parameters<typeof canEditCommentsHandler>[1]={where:{id:{eq:{eq:'id'}}}};
void [commentInput,discussionInput,eventInput,malformed];
