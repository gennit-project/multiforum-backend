import type {Driver} from 'neo4j-driver';
import type {DiscussionCreateInput} from '../../src/generated/graphql.js';
import type {Discussion} from '../../ogm_types.js';
import {executeGeneratedOperation} from './generatedSchemaOperations.js';
export const DISCUSSION_CREATE_SELECTION = `
  {
    id
    title
    body
    Author {
      username
    }
    DiscussionChannels {
      id
      createdAt
      channelUniqueName
      discussionId
      archived
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
      UpvotedByUsers {
        username
      }
    }
    createdAt
    updatedAt
    Tags {
      text
    }
  }
`;
export interface DiscussionCreationRepository {
 createDiscussion(input:DiscussionCreateInput):Promise<{discussions:Discussion[]}>;
 findAttachedFiles(id:string):Promise<Array<{id:string;DownloadableFiles:Array<{id:string}>}>>;
 findCreatedDiscussion(id:string):Promise<Discussion[]>;
}
export function createDiscussionCreationRepository(driver:Driver):DiscussionCreationRepository{return{
 async createDiscussion(input){const r=await executeGeneratedOperation<{createDiscussions:{discussions:Discussion[]}}>(driver,`mutation CreateDiscussionForChannels($input:[DiscussionCreateInput!]!){createDiscussions(input:$input){discussions${DISCUSSION_CREATE_SELECTION}}}`,{input:[input]});return r.createDiscussions;},
 async findAttachedFiles(id){const r=await executeGeneratedOperation<{discussions:Array<{id:string;DownloadableFiles:Array<{id:string}>}>}>(driver,`query CreatedDiscussionFiles($where:DiscussionWhere){discussions(where:$where){id DownloadableFiles{id}}}`,{where:{id:{eq:id}}});return r.discussions;},
 async findCreatedDiscussion(id){const r=await executeGeneratedOperation<{discussions:Discussion[]}>(driver,`query CreatedDiscussionWithChannels($where:DiscussionWhere){discussions(where:$where)${DISCUSSION_CREATE_SELECTION}}`,{where:{id:{eq:id}}});return r.discussions;},
};}
