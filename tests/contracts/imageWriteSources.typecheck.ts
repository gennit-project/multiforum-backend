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
