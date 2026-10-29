import assert from 'node:assert/strict';
import test from 'node:test';
import type { ExecutionResult } from 'graphql';
import { SubscriptionConsumer } from './subscriptionConsumer.js';

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}
function iterator() {
  let pending = deferred<IteratorResult<ExecutionResult>>();
  let rejectNext!: (error: Error) => void;
  let returns = 0;
  const source: AsyncIterableIterator<ExecutionResult> = {
    [Symbol.asyncIterator]() { return this; },
    next() { return Promise.race([pending.promise, new Promise<never>((_, reject) => { rejectNext = reject; })]); },
    async return() { returns++; pending.resolve({ done: true, value: undefined }); return { done: true, value: undefined }; },
  };
  return {
    source,
    get returns() { return returns; },
    fail() { rejectNext(new Error('failed')); },
    end() { pending.resolve({ done: true, value: undefined }); },
    emit(value: ExecutionResult) {
      const old = pending;
      pending = deferred();
      old.resolve({ done: false, value });
    },
  };
}

test('repeated failures clean up before replacement and handle subsequent events', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const sources = [iterator(), iterator(), iterator()];
  const seen: ExecutionResult[] = [];
  let calls = 0;
  const consumer = new SubscriptionConsumer('test', async () => {
    if (calls) assert.equal(sources[calls - 1].returns, 1);
    return sources[calls++].source;
  }, async (event) => { seen.push(event); });
  await Promise.all([consumer.start(), consumer.start()]);
  assert.equal(calls, 1);
  for (let i = 0; i < 2; i++) {
    sources[i].fail();
    await flush();
    await consumer.start();
    assert.equal(calls, i + 1);
    t.mock.timers.tick(4999);
    await flush();
    assert.equal(calls, i + 1);
    t.mock.timers.tick(1);
    await flush();
    sources[i + 1].emit({ data: { id: i } });
    await flush();
  }
  assert.deepEqual(seen, [{ data: { id: 0 } }, { data: { id: 1 } }]);
  await consumer.stop();
  assert.equal(sources[2].returns, 1);
});

for (const mode of ['failure', 'completion', 'startup rejection', 'error result'] as const) {
  test(`stop cancels retry after ${mode}`, async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const source = iterator();
    let calls = 0;
    const consumer = new SubscriptionConsumer('test', async () => {
      calls++;
      if (mode === 'startup rejection') throw new Error('unavailable');
      if (mode === 'error result') return {};
      return source.source;
    }, async () => {});
    await consumer.start();
    if (mode === 'failure') source.fail();
    if (mode === 'completion') source.end();
    await flush();
    await Promise.all([consumer.stop(), consumer.stop()]);
    t.mock.timers.tick(10000);
    await flush();
    assert.equal(calls, 1);
  });
}

test('normal termination retries once', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const source = iterator();
  const replacement = iterator();
  let calls = 0;
  const consumer = new SubscriptionConsumer('test', async () => ++calls === 1 ? source.source : replacement.source, async () => {});
  await consumer.start();
  source.end();
  await flush();
  t.mock.timers.tick(5000);
  await flush();
  assert.equal(calls, 2);
  assert.equal(source.returns, 1);
  await consumer.stop();
});

test('stop during startup closes late iterator without processing; later start is serialized', async () => {
  const opening = deferred<AsyncIterableIterator<ExecutionResult>>();
  const old = iterator();
  const replacement = iterator();
  let calls = 0;
  let handled = 0;
  const consumer = new SubscriptionConsumer('test', async () => ++calls === 1 ? opening.promise : replacement.source, async () => { handled++; });
  const start = consumer.start();
  const stop = consumer.stop();
  const restart = consumer.start();
  assert.equal(calls, 1);
  opening.resolve(old.source);
  await Promise.all([start, stop, restart]);
  assert.equal(old.returns, 1);
  assert.equal(calls, 2);
  assert.equal(handled, 0);
  await consumer.stop();
});

test('cleanup failure prevents overlapping replacement', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const source = iterator();
  source.source.return = async () => { throw new Error('cannot close'); };
  let calls = 0;
  const consumer = new SubscriptionConsumer('test', async () => { calls++; return source.source; }, async () => {});
  await consumer.start();
  source.fail();
  await flush();
  t.mock.timers.tick(10000);
  await consumer.start();
  assert.equal(calls, 1);
  await consumer.stop();
});

test('retry waits for cleanup and stale next result after stop cannot reach handler', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const cleanup = deferred<IteratorResult<ExecutionResult>>();
  const source = iterator();
  const replacement = iterator();
  source.source.return = () => cleanup.promise;
  let calls = 0;
  let handled = 0;
  const consumer = new SubscriptionConsumer('test', async () => ++calls === 1 ? source.source : replacement.source, async () => { handled++; });
  await consumer.start();
  const stopping = consumer.stop();
  const restarting = consumer.start();
  source.emit({ data: { stale: true } });
  await flush();
  t.mock.timers.tick(10000);
  assert.equal(calls, 1);
  assert.equal(handled, 0);
  cleanup.resolve({ done: true, value: undefined });
  await Promise.all([stopping, restarting]);
  assert.equal(calls, 2);
  await consumer.stop();
});

test('startup failures recover and stop cancels an in-flight rejection', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const source = iterator();
  let calls = 0;
  const consumer = new SubscriptionConsumer('test', async () => {
    if (++calls === 1) throw new Error('unavailable');
    return source.source;
  }, async () => {});
  await consumer.start();
  t.mock.timers.tick(5000);
  await flush();
  assert.equal(calls, 2);
  await consumer.stop();

  const opening = deferred<ExecutionResult>();
  let cancelledCalls = 0;
  const cancelled = new SubscriptionConsumer('test', () => { cancelledCalls++; return opening.promise; }, async () => {});
  const start = cancelled.start();
  const stop = cancelled.stop();
  opening.resolve({});
  await Promise.all([start, stop]);
  t.mock.timers.tick(5000);
  await flush();
  assert.equal(cancelledCalls, 1);
});

test('failed iterator cleanup must finish before backoff and replacement', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const cleanup = deferred<IteratorResult<ExecutionResult>>();
  const first = iterator();
  const second = iterator();
  first.source.return = () => cleanup.promise;
  let calls = 0;
  const consumer = new SubscriptionConsumer('test', async () => ++calls === 1 ? first.source : second.source, async () => {});
  await consumer.start();
  first.fail();
  await flush();
  t.mock.timers.tick(10000);
  await consumer.start();
  assert.equal(calls, 1);
  cleanup.resolve({ done: true, value: undefined });
  await flush();
  t.mock.timers.tick(5000);
  await flush();
  assert.equal(calls, 2);
  await consumer.stop();
});
