import {sourceMetadataRecorder} from '../delegatedSourceMetadata.js';
import { defaultFieldResolver, getNamedType, GraphQLObjectType, GraphQLSchema, isObjectType, isUnionType } from 'graphql';
import { generatedAuthorTypesAtPaths, selectedCommentAuthorPaths, issueSourceIdentity } from '../../middleware/userChildIdentityMiddleware.js';

/** Projection metadata only: never installs Shield or adds request context. */
export function withInternalAuthorSources(schema: GraphQLSchema): GraphQLSchema {
  const roots: Record<string, ReturnType<typeof generatedAuthorTypesAtPaths>> = {};
  const queryFields = schema.getQueryType()?.getFields();
  for (const {root, type, author} of [
    {root:'comments',type:'Comment',author:'CommentAuthor'},
    {root:'issues',type:'Issue',author:'Author'},
  ]) {
    const sourceType = schema.getType(type);
    if (!isObjectType(sourceType)) continue;
    const authorField = sourceType.getFields()[author];
    if (!authorField) continue;
    const union = getNamedType(authorField.type);
    if (!isUnionType(union) || union.getTypes().map(member => member.name).sort().join(',') !== 'ModerationProfile,User') continue;
    const paths = [[author]];
    if (queryFields?.[root] && getNamedType(queryFields[root].type).name === type) {
      roots[root] = type === "Comment"
        ? (resolve, parent, args, context, info) => generatedAuthorTypesAtPaths(selectedCommentAuthorPaths(info))(resolve, parent, args, context, info)
        : (resolve, parent, args, context, info) => sourceMetadataRecorder(context, info)
          ? issueSourceIdentity()(resolve, parent, args, context, info)
          : generatedAuthorTypesAtPaths(paths.map(path => ({path})))(resolve, parent, args, context, info);
    }
    const connection = root + 'Connection';
    if (queryFields?.[connection] && getNamedType(queryFields[connection].type).name === type + 'sConnection') {
      roots[connection] = type === "Comment"
        ? (resolve, parent, args, context, info) => generatedAuthorTypesAtPaths(selectedCommentAuthorPaths(info, {path:['edges','node'],sourceKeys:['canonical','canonical']}))(resolve, parent, args, context, info)
        : generatedAuthorTypesAtPaths(paths.map(path => ({path:['edges','node',...path],sourceKeys:['canonical','canonical',...path.map((): 'response' => 'response')]})));
    }
  }
  const query = schema.getQueryType();
  if (!query || !Object.keys(roots).length) return schema;
  // Wrap only root execution. Keep child types/resolvers shared with the raw
  // schema used by public adapters and fault-injection tests. Resolve through
  // the original root field at call time rather than snapshotting its resolver.
  const config = query.toConfig();
  const fields = Object.fromEntries(Object.entries(config.fields).map(([name, field]) => [name, {
    ...field,
    resolve: (parent: unknown, args: Record<string, unknown>, context: unknown, info: import('graphql').GraphQLResolveInfo) => {
      const resolve = query.getFields()[name].resolve ?? defaultFieldResolver;
      return roots[name] ? roots[name](resolve, parent, args, context, info) : resolve(parent, args, context, info);
    },
  }]));
  return new GraphQLSchema({
    ...schema.toConfig(),
    query: new GraphQLObjectType({...config, fields}),
    types: schema.toConfig().types.filter(type => type !== query),
  });
}
