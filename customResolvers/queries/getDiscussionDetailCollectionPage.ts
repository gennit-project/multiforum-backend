import {rememberCanonicalSource} from '../../services/canonicalSourceFields.js';
import {canonicalChannelAnswer} from "../../services/customCommentSources.js";
import {canonicalDetailFile,canonicalDetailImage} from "../../services/canonicalDiscussionDetail.js";
import type {CustomChannelAnswer} from "../contracts/customCommentSources.js";
import type {DetailFile,DetailImage} from "../contracts/discussionDetailSources.js";
import type { AgePolicyReader } from "../../services/persistence/instancePolicyRepository.js";
import type { Driver, ManagedTransaction } from "neo4j-driver";

import { mayAccessSensitiveContent } from "../../services/sensitiveContentAccess.js";
import type { GraphQLContext } from "../../types/context.js";
import {
  decodeDetailCollectionCursor,
  encodeDetailCollectionCursor,
  type DetailCollectionKind,
} from "../../services/detailCollectionCursor.js";
import { normalizePagination } from "../../services/pagination.js";
import {
  getDiscussionDetailAnswersPageQuery,
  getDiscussionDetailFilesPageQuery,
  getDiscussionDetailImagesPageQuery,
} from "../cypher/cypherQueries.js";

type Input = {
  driver: Driver;
  agePolicyRepository?: AgePolicyReader;
};

type Args = {
  discussionId: string;
  channelUniqueName: string;
  after?: string | null;
  limit?: number | null;
};

type PageItem=CustomChannelAnswer|DetailFile|DetailImage;
type PageRow<T>={item:T;cursorCreatedAt:unknown;cursorId:unknown};
async function readPage<T>(transaction:ManagedTransaction,query:string,params:Record<string,unknown>,canonical:(source:T)=>T):Promise<PageRow<T>[]> {
 const result=await transaction.run<PageRow<T>>(query,params);
 return result.records.map(record=>({item:canonical(record.get("item")),cursorCreatedAt:record.get("cursorCreatedAt"),cursorId:record.get("cursorId")}));
}
type PageConfig<T> = {
  kind: DetailCollectionKind;
  read:(transaction:ManagedTransaction,params:Record<string,unknown>)=>Promise<PageRow<T>[]>;
  defaultLimit: number;
};

const PAGE_LIMIT_MAX = 50;

const configs = {
  answer: {
    kind: "answer" as const,
    read:(tx,params)=>readPage(tx,getDiscussionDetailAnswersPageQuery,params,canonicalChannelAnswer),
    defaultLimit: 5,
  },
  file: {
    kind: "file" as const,
    read:(tx,params)=>readPage(tx,getDiscussionDetailFilesPageQuery,params,canonicalDetailFile),
    defaultLimit: 12,
  },
  image: {
    kind: "image" as const,
    read:(tx,params)=>readPage(tx,getDiscussionDetailImagesPageQuery,params,canonicalDetailImage<DetailImage>),
    defaultLimit: 12,
  },
} satisfies Record<DetailCollectionKind,PageConfig<PageItem>>;

const normalizeCursorDate = (value: unknown): string => {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "toString" in value) {
    return String(value);
  }
  return "";
};

const createPageResolver = <T>({driver,agePolicyRepository,config}:Input & {config:PageConfig<T>}) => {
  const {kind}=config;

  return async (_parent: unknown, args: Args, context: GraphQLContext) => {
    const { limit } = normalizePagination({
      limit: args.limit,
      defaultLimit: config.defaultLimit,
      maxLimit: PAGE_LIMIT_MAX,
    });
    const cursor = decodeDetailCollectionCursor({
      after: args.after,
      expectedKind: kind,
    });
    const canViewSensitiveContent = await mayAccessSensitiveContent({
      context,
      driver,
      agePolicyRepository,
    });
    const session = driver.session();

    try {
      return await session.executeWrite(async (transaction) => {
        const records = await config.read(transaction, {
          discussionId: args.discussionId,
          channelUniqueName: args.channelUniqueName,
          mayAccessSensitiveContent: canViewSensitiveContent,
          cursorCreatedAt: cursor?.createdAt ?? null,
          cursorId: cursor?.id ?? null,
          pageLimit: limit + 1,
        });
        const hasNextPage = records.length > limit;
        const selectedRecords = records.slice(0, limit);
        const lastRecord:PageRow<T>|undefined = selectedRecords[selectedRecords.length - 1];
        const cursorCreatedAt = lastRecord
          ? normalizeCursorDate(lastRecord.cursorCreatedAt)
          : "";
        const cursorId = lastRecord?.cursorId;
        const endCursor =
          cursorCreatedAt && cursorId
            ? encodeDetailCollectionCursor({
                kind,
                createdAt: cursorCreatedAt,
                id: cursorId,
              })
            : null;

        return rememberCanonicalSource({
          items: selectedRecords.map((record) => record.item),
          pageInfo: rememberCanonicalSource({ endCursor, hasNextPage }),
        });
      });
    } finally {
      await session.close();
    }
  };
};

type PageInfo={endCursor:string|null;hasNextPage:boolean};
type PageResult<K extends DetailCollectionKind> = K extends 'answer' ? {answers:CustomChannelAnswer[];pageInfo:PageInfo}
 : K extends 'file' ? {files:DetailFile[];pageInfo:PageInfo} : {images:DetailImage[];pageInfo:PageInfo};
type PageResolver<K extends DetailCollectionKind> = (_parent:unknown,args:Args,context:GraphQLContext)=>Promise<PageResult<K>>;
export function createDiscussionDetailCollectionPageResolver<K extends DetailCollectionKind>(input:Input & {kind:K}):PageResolver<K>;
export function createDiscussionDetailCollectionPageResolver(input:Input & {kind:DetailCollectionKind}):PageResolver<'answer'>|PageResolver<'file'>|PageResolver<'image'> {
 if(input.kind==='answer'){
  const read=createPageResolver({...input,config:configs.answer});
  const resolver:PageResolver<'answer'>=async(...args)=>{const result=await read(...args);return rememberCanonicalSource({answers:result.items,pageInfo:result.pageInfo});};
  return resolver;
 }
 if(input.kind==='file'){
  const read=createPageResolver({...input,config:configs.file});
  const resolver:PageResolver<'file'>=async(...args)=>{const result=await read(...args);return rememberCanonicalSource({files:result.items,pageInfo:result.pageInfo});};
  return resolver;
 }
 const read=createPageResolver({...input,config:configs.image});
 const resolver:PageResolver<'image'>=async(...args)=>{const result=await read(...args);return rememberCanonicalSource({images:result.items,pageInfo:result.pageInfo});};
 return resolver;
}
