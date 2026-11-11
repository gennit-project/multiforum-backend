import type {Driver} from 'neo4j-driver';
import createImage from '../../customResolvers/mutations/createImageWithUploader.js';
import type {ImageWriteSourceMutationResolvers} from '../../customResolvers/contracts/imageWriteSources.js';
import type {CreatedImageSource} from '../../services/persistence/imageWriteRepository.js';
declare const driver:Driver;
const contracts={createImageWithUploader:createImage({driver})} satisfies ImageWriteSourceMutationResolvers;
declare const image:CreatedImageSource;
// @ts-expect-error storage metadata remains unvalidated
const storage:string=image.storageBucket;
// @ts-expect-error unchecked stored flags are not a promised Boolean
const flag:boolean=image.hasSensitiveContent;
// @ts-expect-error source id is generated string identity
const bad:CreatedImageSource={...image,id:4};
// @ts-expect-error non-null root cannot return an absent creation row
const missing:ImageWriteSourceMutationResolvers['createImageWithUploader']=async()=>undefined;
void [contracts,storage,flag,bad,missing];

// @ts-expect-error selected uploader identity cannot be omitted
const shortUploader:ImageWriteSourceMutationResolvers['createImageWithUploader']=async()=>({id:'i',createdAt:'date',Uploader:{},Albums:[]});
// @ts-expect-error returned album identity must be a completed string
const badAlbum:ImageWriteSourceMutationResolvers['createImageWithUploader']=async()=>({id:'i',createdAt:'date',Uploader:null,Albums:[{id:42}]});
// @ts-expect-error unselected album owner remains unavailable
const owner=image.Albums[0].Owner;
void [shortUploader,badAlbum,owner];

// @ts-expect-error owned nullable Uploader key is always present
const absentUploader:ImageWriteSourceMutationResolvers['createImageWithUploader']=async()=>({id:'i',createdAt:'date',Albums:[]});
void absentUploader;
