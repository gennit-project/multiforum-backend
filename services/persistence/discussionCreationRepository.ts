import type { AttachedDiscussionFilesProjection, CreatedDiscussionProjection } from "../../customResolvers/contracts/contentProjections.js";
import type {Driver, ManagedTransaction} from 'neo4j-driver';
import type {DiscussionCreateInput} from '../../src/generated/graphql.js';
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
 createDiscussion(input:DiscussionCreateInput, transaction?:ManagedTransaction):Promise<{discussions:CreatedDiscussionProjection[]}>;
 findAttachedFiles(id:string, transaction?:ManagedTransaction):Promise<AttachedDiscussionFilesProjection[]>;
 findCreatedDiscussion(id:string, transaction?:ManagedTransaction):Promise<CreatedDiscussionProjection[]>;
}
export function createDiscussionCreationRepository(driver:Driver):DiscussionCreationRepository{return{
 async createDiscussion(input,transaction){const r=await executeGeneratedOperation<{createDiscussions:{discussions:CreatedDiscussionProjection[]}}>(driver,`mutation CreateDiscussionForChannels($input:[DiscussionCreateInput!]!){createDiscussions(input:$input){discussions${DISCUSSION_CREATE_SELECTION}}}`,{input:[input]},transaction);return r.createDiscussions;},
 async findAttachedFiles(id,transaction){const r=await executeGeneratedOperation<{discussions:AttachedDiscussionFilesProjection[]}>(driver,`query CreatedDiscussionFiles($where:DiscussionWhere){discussions(where:$where){id DownloadableFiles{id}}}`,{where:{id:{eq:id}}},transaction);return r.discussions;},
 async findCreatedDiscussion(id,transaction){const r=await executeGeneratedOperation<{discussions:CreatedDiscussionProjection[]}>(driver,`query CreatedDiscussionWithChannels($where:DiscussionWhere){discussions(where:$where)${DISCUSSION_CREATE_SELECTION}}`,{where:{id:{eq:id}}},transaction);return r.discussions;},
};}
