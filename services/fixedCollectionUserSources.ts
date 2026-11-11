import {rememberAccountChildIdentity} from './accountChildIdentity.js';
import type {SourceMetadataRecorder} from './delegatedSourceMetadata.js';
function object(value:unknown):value is Record<string,unknown>{return value!==null&&typeof value==='object'&&!Array.isArray(value);}
/** Only the fixed canonical PublicCollections document: it explicitly selects
 * username at both paths. Capture before GraphQL scalar completion without
 * changing its document, context, lazy child resolvers or database reads. */
export function captureFixedCollectionUsers(result:unknown,capture:SourceMetadataRecorder):void {
 if(!Array.isArray(result))return;
 const rows:readonly unknown[]=result;
 const user=(value:unknown,path:(string|number)[])=>{
  if(!object(value))return;
  rememberAccountChildIdentity(value,value.username);capture(path,value);
 };
 rows.forEach((row,index)=>{
  if(!object(row))return;
  user(row.CreatedBy,[index,'CreatedBy']);
  if(!Array.isArray(row.Downloads))return;
  const downloads:readonly unknown[]=row.Downloads;
  downloads.forEach((download,child)=>{if(object(download))user(download.Author,[index,'Downloads',child,'Author']);});
 });
}
