import {getPermissionRequestCache} from '../../rules/permission/getPermissionRequestCache.js';
import {getServerConfigForPermissions} from '../../rules/permission/getServerConfigForPermissions.js';
type Cache=ReturnType<typeof getPermissionRequestCache>;
type Snapshot=Awaited<ReturnType<typeof getServerConfigForPermissions>>;
type IsAny<T>=0 extends (1 & T)?true:false;
const noErasure:IsAny<Snapshot>=false;
declare const cache:Cache;
// @ts-expect-error cache must not accept an arbitrary server-config object
cache.serverConfigPromise=Promise.resolve({pluginPipelines:[]});
declare const snapshot:Snapshot;
// @ts-expect-error missing config is a real nullable outcome
void snapshot.Admins;
if(snapshot){
 // @ts-expect-error permission snapshot does not read plugin configuration
 void snapshot.pluginPipelines;
 // @ts-expect-error memberships retain nullable identities
 const username:string=snapshot.Admins[0].username;
 void username;
}
void noErasure;
