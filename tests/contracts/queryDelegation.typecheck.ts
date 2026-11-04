import type {GraphQLResolveInfo,GraphQLSchema} from 'graphql';
import {delegateQueryField} from '../../services/persistence/delegateQueryField.js';
declare const schema:GraphQLSchema,info:GraphQLResolveInfo;
const base={schema,info,context:{jwt:{mayAccessSensitiveContent:true}}};
const result=delegateQueryField({...base,fieldName:'issues',args:{where:{id:{eq:'issue'}}}});
// @ts-expect-error dynamic delegation does not certify selected child properties
const fullIssues:import('../../src/generated/graphql.js').Issue[]=result;
// @ts-expect-error no unchecked string query names
void delegateQueryField({...base,fieldName:'isssues',args:{}});
// @ts-expect-error mutation names cannot be sent as queries
void delegateQueryField({...base,fieldName:'updateIssues',args:{}});
// @ts-expect-error generated filter requires an ID comparison object
void delegateQueryField({...base,fieldName:'issues',args:{where:{id:'issue'}}});
// @ts-expect-error root arguments are tied to the selected field, not widened from arguments
void delegateQueryField({...base,fieldName:'issues',args:{campaignId:'campaign'}});
void fullIssues;
