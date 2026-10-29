import type {TestContext} from 'node:test';
import {Neo4jError, type Driver} from 'neo4j-driver';

/** Fail after a real query has executed but before its transaction commits. */
export function failManagedQuery(t: TestContext, driver: Driver, marker: string, retry = false) {
  const session = driver.session.bind(driver);
  let failures = 0;
  t.mock.method(driver, 'session', (config: any) => {
    const active = session(config);
    const executeWrite = active.executeWrite.bind(active);
    active.executeWrite = ((work: any, options: any) => executeWrite(async tx => {
      const wrapped = new Proxy(tx, {get(target, key) {
        if(key === 'run') return async (query: string, params: any) => {
          const result = await target.run(query, params);
          if(query.includes(marker) && (!retry || failures === 0)) {
            failures++;
            if(retry)throw new Neo4jError('injected transient failure','Neo.TransientError.Transaction.DeadlockDetected', '50N42', 'injected transient failure');
            throw Error('injected write failure');
          }
          return result;
        };
        const value = Reflect.get(target,key);return typeof value === 'function' ? value.bind(target) : value;
      }});
      return work(wrapped);
    }, options)) as typeof active.executeWrite;
    return active;
  });
  return () => failures;
}
