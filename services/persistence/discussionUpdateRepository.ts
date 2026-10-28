import type {Driver, ManagedTransaction} from 'neo4j-driver';
import type {DiscussionWhere,DiscussionUpdateInput} from '../../src/generated/graphql.js';
import type {Discussion} from '../../ogm_types.js';
import {executeGeneratedOperation} from './generatedSchemaOperations.js';
import {DISCUSSION_REVISION_DEFAULT_SELECTION} from './discussionRevisionRepository.js';
export const DISCUSSION_UPDATE_SNAPSHOT_SELECTION=`{
              id
              title
              body
              Author { username }
              BodyLastEditedBy { username }
              DiscussionChannels { channelUniqueName }
              PastTitleVersions { id body createdAt }
              PastBodyVersions { id body createdAt }
            }`;
export const UPDATED_DISCUSSION_SELECTION = `
        {
          id
          title
          body
          Author {
            username
          }
          DiscussionChannels {
            id
            channelUniqueName
            discussionId
            Flairs {
              id
              channelUniqueName
              displayName
              color
              order
              archived
            }
            Channel {
              uniqueName
            }
            Discussion {
              id
            }
          }
          createdAt
          updatedAt
          Tags {
            text
          }
          PastTitleVersions {
            id
            body
            createdAt
            Author {
              username
            }
          }
          PastBodyVersions {
            id
            body
            createdAt
            Author {
              username
            }
          }
        }
      `;
export interface DiscussionUpdateRepository{
 findRevisionSnapshot(where:DiscussionWhere):Promise<Discussion[]>;
 updateWithinTransaction(where:DiscussionWhere,update:DiscussionUpdateInput,tx:ManagedTransaction):Promise<void>;
 findUpdatedDiscussion(id:string|undefined|null):Promise<Discussion[]>;
}
export function createDiscussionUpdateRepository(driver:Driver):DiscussionUpdateRepository{return{
 async findRevisionSnapshot(where){const r=await executeGeneratedOperation<{discussions:Discussion[]}>(driver,`query DiscussionBeforeCustomUpdate($where:DiscussionWhere){discussions(where:$where)${DISCUSSION_UPDATE_SNAPSHOT_SELECTION}}`,{where});return r.discussions;},
 async updateWithinTransaction(where,update,tx){await executeGeneratedOperation(driver,`mutation UpdateDiscussionInTransaction($where:DiscussionWhere,$update:DiscussionUpdateInput){updateDiscussions(where:$where,update:$update){discussions${DISCUSSION_REVISION_DEFAULT_SELECTION}}}`,{where,update},tx);},
 async findUpdatedDiscussion(id){const r=await executeGeneratedOperation<{discussions:Discussion[]}>(driver,`query DiscussionAfterCustomUpdate($where:DiscussionWhere){discussions(where:$where)${UPDATED_DISCUSSION_SELECTION}}`,{where:{id:{eq:id}}});return r.discussions;},
};}
