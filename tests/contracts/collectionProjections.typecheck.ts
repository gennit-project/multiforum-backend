import type {CollectionShareProjection,PublicCollectionProjection,ProfileCollectionProjection,CollectionShareChannelProjection} from '../../customResolvers/contracts/accountProjections.js';
import {CollectionVisibility} from '../../src/generated/graphql.js';
const absentCreator:CollectionShareProjection={id:'id',name:'name',description:null,visibility:CollectionVisibility.Public,CreatedBy:null};
// @ts-expect-error selected nullable fields are present, not optional
const incomplete:CollectionShareProjection={id:'id',name:'name',visibility:CollectionVisibility.Public};
// @ts-expect-error selected creator must include its required username
const invalidCreator:CollectionShareProjection={...absentCreator,CreatedBy:{}};
// @ts-expect-error visibility is the schema enum, not an arbitrary string
const invalidVisibility:CollectionShareProjection={...absentCreator,visibility:'invalid'};
declare const publicCollection:PublicCollectionProjection;
declare const profile:ProfileCollectionProjection;
declare const channel:CollectionShareChannelProjection;
// @ts-expect-error public read does not select private email
void publicCollection.CreatedBy?.Email;
// @ts-expect-error profile read does not select complete discussions
void profile.Discussions[0].body;
// @ts-expect-error channel read only selects its identity
void channel.displayName;
void [absentCreator,incomplete,invalidCreator,invalidVisibility];
