import { GraphQLError } from "graphql";
import type { Driver } from "neo4j-driver";
import type { GraphQLContext } from "../../types/context.js";
import type { WriteWikiPageInput } from "../../src/generated/graphql.js";
import { setUserDataOnContext } from "../../rules/permission/userDataHelperFunctions.js";
import { evaluateCanEditWikiPagesRule, evaluateWikiHomeChannelPermission } from "../../rules/definitions/wikiRules.js";
import { executeManagedWrite } from "../../services/neo4jTransactions.js";
import { writeWikiPageRecord, linkWikiHome } from "../../services/persistence/wikiPageWriteRepository.js";

const requireAllowed = (result: unknown) => {
  if (result !== true) throw result instanceof Error ? result : new GraphQLError("Wiki edit is not permitted.");
};
async function actor(context: GraphQLContext) {
  context.user = await setUserDataOnContext({context});
  if (!context.user?.username) throw new GraphQLError("Authentication required.");
  return context.user.username;
}
export const writeWikiPage = ({driver}: {driver:Driver}) => async (_:unknown, {input}:{input:WriteWikiPageInput}, context:GraphQLContext) => {
  const username = await actor(context);
  if (!input.title.trim()) throw new GraphQLError("A title is required.");
  if (input.id && (input.slug || input.parentId)) throw new GraphQLError("Page identity and parent cannot be changed.");
  if (!input.id && !input.slug?.trim()) throw new GraphQLError("A slug is required for a new page.");
  requireAllowed(await evaluateCanEditWikiPagesRule(input.id
    ? {where:{id:{eq:input.id}}}
    : {input:[{channelUniqueName:input.channelUniqueName,title:input.title,slug:input.slug!}]}, context));
  if (input.parentId) requireAllowed(await evaluateCanEditWikiPagesRule({where:{id:{eq:input.parentId}}},context));
  if (input.setAsHome) requireAllowed(await evaluateWikiHomeChannelPermission(input.channelUniqueName,context));
  return writeWikiPageRecord(driver,input,username);
};
export const setWikiHomePage = ({driver}:{driver:Driver}) => async (_:unknown,args:{channelUniqueName:string;pageId:string},context:GraphQLContext) => {
  await actor(context);
  requireAllowed(await evaluateWikiHomeChannelPermission(args.channelUniqueName,context));
  return executeManagedWrite(driver,async tx => {await linkWikiHome(tx,args.channelUniqueName,args.pageId);return true;});
};
