import assert from 'node:assert/strict';
import {mock} from 'node:test';
import http from 'node:http';
import https from 'node:https';
export function denyExternalHttp() {
  let attempts=0;
  const deny=()=>{attempts++;throw new Error('External HTTP forbidden in test');};
  const guards=[mock.method(globalThis,'fetch',deny),mock.method(http,'request',deny),mock.method(http,'get',deny),mock.method(https,'request',deny),mock.method(https,'get',deny)];
  return {assertUnused(){assert.equal(attempts,0);},restore(){for(const guard of guards)guard.mock.restore();}};
}
