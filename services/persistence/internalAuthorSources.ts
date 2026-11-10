import { getNamedType, isObjectType, isUnionType, type GraphQLSchema } from 'graphql';
import { applyMiddleware } from 'graphql-middleware';
import { generatedAuthorTypesAtPaths, commentAuthorSourcePaths } from '../../middleware/userChildIdentityMiddleware.js';

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
    const paths = type === "Comment" ? commentAuthorSourcePaths : [[author]];
    if (queryFields?.[root] && getNamedType(queryFields[root].type).name === type) {
      roots[root] = generatedAuthorTypesAtPaths(paths.map(path => ({path})));
    }
    const connection = root + 'Connection';
    if (queryFields?.[connection] && getNamedType(queryFields[connection].type).name === type + 'sConnection') {
      roots[connection] = generatedAuthorTypesAtPaths(paths.map(path => ({path:['edges','node',...path],sourceKeys:['canonical','canonical',...path.map((): 'response' => 'response')]})));
    }
  }
  return Object.keys(roots).length ? applyMiddleware(schema, {Query:roots}) : schema;
}
