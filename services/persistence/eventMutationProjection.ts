import {execute, Kind, type GraphQLResolveInfo, type GraphQLSchema, type FieldNode, type SelectionSetNode, OperationTypeNode, getDirectiveValues, GraphQLSkipDirective, GraphQLIncludeDirective} from 'graphql';

// The write returns only identities. Complete the caller's generated read
// projection after the history/editor writes. Its caller defers GraphQL
// serialization errors until commit, preserving committed-write semantics.
export function eventMutationFields(info: GraphQLResolveInfo): FieldNode[] {
  const fields: FieldNode[] = [];
  function collect(set: SelectionSetNode | undefined) {
    for (const selection of set?.selections ?? []) {
      if (getDirectiveValues(GraphQLSkipDirective, selection, info.variableValues)?.if === true ||
          getDirectiveValues(GraphQLIncludeDirective, selection, info.variableValues)?.if === false) continue;
      if (selection.kind === Kind.FIELD) fields.push(selection);
      else if (selection.kind === Kind.INLINE_FRAGMENT) collect(selection.selectionSet);
      else collect(info.fragments[selection.name.value]?.selectionSet);
    }
  }
  for (const node of info.fieldNodes) collect(node.selectionSet);
  return fields;
}

export function eventMutationWriteInfo(info: GraphQLResolveInfo): GraphQLResolveInfo {
  return {...info, fieldNodes: [{...info.fieldNodes[0], selectionSet: {
    kind: Kind.SELECTION_SET,
    selections: eventMutationFields(info).map(field => field.name.value === 'events' ? {
      ...field, selectionSet: {kind: Kind.SELECTION_SET, selections:[{kind: Kind.FIELD, name:{kind: Kind.NAME, value:'id'}}]},
    } : field),
  }}]};
}

export async function projectEventMutation(
  schema: GraphQLSchema, result: Record<string, any>, context: unknown, info: GraphQLResolveInfo
): Promise<Record<string, any>> {
  const fields = eventMutationFields(info).filter(field => field.name.value === 'events');
  const projected = {...result};
  for (const field of fields) {
    const key = field.alias?.value ?? 'events';
    const ids = (result[key] ?? []).map((event: {id: string}) => event.id);
    if (!ids.length) continue;
    let variableName = '__atomicEventIds';
    while (Object.prototype.hasOwnProperty.call(info.variableValues, variableName)) variableName += '_';
    const query = await execute({schema, contextValue: context, variableValues: {...info.variableValues, [variableName]: ids}, document: {
      kind: Kind.DOCUMENT, definitions: [{
        kind: Kind.OPERATION_DEFINITION, operation: OperationTypeNode.QUERY,
        variableDefinitions: [...(info.operation.variableDefinitions ?? []), {
          kind: Kind.VARIABLE_DEFINITION, variable:{kind: Kind.VARIABLE, name:{kind: Kind.NAME, value:variableName}},
          type:{kind: Kind.LIST_TYPE, type:{kind: Kind.NON_NULL_TYPE, type:{kind: Kind.NAMED_TYPE, name:{kind: Kind.NAME, value:'ID'}}}},
        }],
        selectionSet:{kind: Kind.SELECTION_SET, selections:[{...field, alias:undefined, arguments:[{
          kind: Kind.ARGUMENT, name:{kind: Kind.NAME,value:'where'}, value:{kind: Kind.OBJECT,fields:[{
            kind: Kind.OBJECT_FIELD,name:{kind:Kind.NAME,value:'id'},value:{kind:Kind.OBJECT,fields:[{
              kind:Kind.OBJECT_FIELD,name:{kind:Kind.NAME,value:'in'},value:{kind:Kind.VARIABLE,name:{kind:Kind.NAME,value:variableName}},
            }]},
          }]},
        }]}]},
      }, ...Object.values(info.fragments)],
    }});
    if(query.errors?.length) throw query.errors[0];
    projected[key] = query.data?.events;
  }
  return projected;
}
