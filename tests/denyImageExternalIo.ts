import assert from 'node:assert/strict';
import {mock} from 'node:test';
import http from 'node:http';
import https from 'node:https';
import {Storage} from '@google-cloud/storage';

/** A fake variant generator must never fall through to native storage/HTTP. */
export function denyImageExternalIo() {
  let attempts = 0;
  const deny = () => { attempts++; throw new Error('Native image storage/HTTP forbidden in test'); };
  const guards = [mock.method(Storage.prototype, 'bucket', deny),
    mock.method(globalThis, 'fetch', deny), mock.method(http, 'request', deny),
    mock.method(http, 'get', deny), mock.method(https, 'request', deny), mock.method(https, 'get', deny)];
  return {
    assertUnused() { assert.equal(attempts, 0, 'No native storage/HTTP attempts allowed, including caught failures'); },
    restore() { for (const guard of guards) guard.mock.restore(); },
  };
}
