import * as assert from "node:assert/strict";
import { test } from "node:test";
import type { GraphQLResolveInfo } from "graphql";
import { stickyComment, unstickyComment } from "./stickyComment.js";
import type { StickyCommentRepository } from "../../services/persistence/stickyCommentRepository.js";
import type { GraphQLContext } from "../../types/context.js";

type CommentFixture = {
  id: string;
  isRootComment?: boolean;
  isFeedbackComment?: boolean;
  deleted?: boolean;
  archived?: boolean;
  isSticky?: boolean;
};

const createCommentModel = (comment: CommentFixture) => {
  const calls: Array<Record<string, unknown>> = [];
  const model = {
    findState: async () => [comment],
    updateMetadata: async (id: string, update: Record<string, unknown>) => {
      const input = {where:{id},update};
      calls.push(input);
      return [
          {
            id: comment.id,
            ...(input.update as Record<string, unknown>),
          },
        ];
    },
  };

  return {
    model: model as unknown as StickyCommentRepository,
    calls,
  };
};

const createContext = (username = "mod-user") =>
  ({
    user: {
      username,
      email: `${username}@example.com`,
      email_verified: true,
      data: null,
    },
  }) as unknown as GraphQLContext;

const resolveInfo = {} as GraphQLResolveInfo;

test("stickyComment records sticky metadata", async () => {
  const { model, calls } = createCommentModel({
    id: "comment-1",
    isRootComment: true,
    isSticky: false,
  });
  const resolver = stickyComment({ stickyCommentRepository: model });

  await resolver(null, { commentId: "comment-1" }, createContext("alice"), resolveInfo);

  assert.equal((calls[0].update as { stickyByUsername: string }).stickyByUsername, "alice");
});

test("unstickyComment clears sticky metadata", async () => {
  const { model, calls } = createCommentModel({
    id: "comment-1",
    isRootComment: true,
    isSticky: true,
  });
  const resolver = unstickyComment({ stickyCommentRepository: model });

  await resolver(null, { commentId: "comment-1" }, createContext(), resolveInfo);

  assert.deepEqual(calls[0].update, {
    isSticky: false,
    stickyAt: null,
    stickyByUsername: null,
  });
});

test("stickyComment rejects child comments", async () => {
  const { model } = createCommentModel({
    id: "comment-1",
    isRootComment: false,
  });
  const resolver = stickyComment({ stickyCommentRepository: model });

  await assert.rejects(
    resolver(null, { commentId: "comment-1" }, createContext(), resolveInfo),
    /Only root comments can be stickied/
  );
});

test("stickyComment rejects feedback comments", async () => {
  const { model } = createCommentModel({
    id: "comment-1",
    isRootComment: true,
    isFeedbackComment: true,
  });
  const resolver = stickyComment({ stickyCommentRepository: model });

  await assert.rejects(
    resolver(null, { commentId: "comment-1" }, createContext(), resolveInfo),
    /Feedback comments cannot be stickied/
  );
});

test("stickyComment rejects archived comments", async () => {
  const { model } = createCommentModel({
    id: "comment-1",
    isRootComment: true,
    archived: true,
  });
  const resolver = stickyComment({ stickyCommentRepository: model });

  await assert.rejects(
    resolver(null, { commentId: "comment-1" }, createContext(), resolveInfo),
    /Deleted or archived comments cannot be stickied/
  );
});

for(const [name,factory,initial] of [["sticky",stickyComment,false],["unsticky",unstickyComment,true]] as const){
 test(`${name} missing id, lookup, state and update errors preserve ordering`,async()=>{
  const order:string[]=[];let rows:any[]=[{id:"c",isRootComment:true,isSticky:initial}];let updateRows:any[]=[];
  const repository={findState:async()=>{order.push("read");return rows;},updateMetadata:async()=>{order.push("write");return updateRows;}};
  const resolver=factory({stickyCommentRepository:repository});
  await assert.rejects(resolver(null,{commentId:""},createContext(),resolveInfo),/Comment ID is required/);assert.deepEqual(order,[]);
  rows=[];await assert.rejects(resolver(null,{commentId:"c"},createContext(),resolveInfo),/Comment not found/);assert.deepEqual(order.splice(0),["read"]);
  rows=[{id:"c",isRootComment:true,isSticky:!initial}];await assert.rejects(resolver(null,{commentId:"c"},createContext(),resolveInfo),name==="sticky"?/already stickied/:/not stickied/);assert.deepEqual(order.splice(0),["read"]);
  rows=[{id:"c",isRootComment:true,isSticky:initial}];await assert.rejects(resolver(null,{commentId:"c"},createContext(),resolveInfo),/could not be updated/);assert.deepEqual(order.splice(0),["read","write"]);
  updateRows=[{id:"c",isSticky:!initial}];assert.deepEqual(await resolver(null,{commentId:"c"},createContext(),resolveInfo),updateRows[0]);assert.deepEqual(order,["read","write"]);
 });
}
test("sticky authenticates only after content checks; unsticky keeps middleware-owned auth",async()=>{
 const {model}=createCommentModel({id:"c",isRootComment:true,isSticky:false});
 await assert.rejects(stickyComment({stickyCommentRepository:model})(null,{commentId:"c"},createContext(""),resolveInfo),/logged in/);
 const unsticky=createCommentModel({id:"c",isRootComment:true,isSticky:true});
 assert.equal((await unstickyComment({stickyCommentRepository:unsticky.model})(null,{commentId:"c"},{} as GraphQLContext,resolveInfo)).isSticky,false);
});
