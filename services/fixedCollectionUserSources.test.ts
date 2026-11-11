import assert from 'node:assert/strict';
import test from 'node:test';
import {captureFixedCollectionUsers} from './fixedCollectionUserSources.js';
import {accountChildIdentity} from './accountChildIdentity.js';
test('fixed collection capture names only owned User paths and leaves values unchanged',()=>{
 const owner={username:17.5},author={username:'alice'},unrelated={username:'outside'};
 const source=[{CreatedBy:owner,Downloads:[{Author:author},null,{Author:null}],Other:unrelated},null];
 const before=JSON.stringify(source);
 const observed:Array<{path:readonly (string|number)[];identity:ReturnType<typeof accountChildIdentity>}>=[];
 captureFixedCollectionUsers(source,(path,value)=>observed.push({path,identity:accountChildIdentity(value)}));
 assert.deepEqual(observed,[{path:[0,'CreatedBy'],identity:{found:true,value:17.5}},{path:[0,'Downloads',0,'Author'],identity:{found:true,value:'alice'}}]);
 assert.deepEqual(accountChildIdentity(unrelated),{found:false});assert.equal(JSON.stringify(source),before);
});
test('malformed or absent collection containers do not invent identity or change completion',()=>{
 for(const source of [null,{},17,[null,{}, {CreatedBy:null,Downloads:null},{Downloads:[17]}]]){
  captureFixedCollectionUsers(source,()=>assert.fail('No known User source is present'));
 }
});
