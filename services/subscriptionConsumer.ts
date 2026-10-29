import type { ExecutionResult } from 'graphql';
import { logger } from '../logger.js';

type Subscription = AsyncIterable<ExecutionResult>;
type Session = {
  cancelled: boolean;
  iterator?: AsyncIterator<ExecutionResult>;
  closing?: Promise<void>;
};

/** Owns one subscription and one retry. Event handlers retain their own semantics. */
export class SubscriptionConsumer {
  private session?: Session;
  private starting?: Promise<void>;
  private stopping?: Promise<void>;
  private retry?: ReturnType<typeof setTimeout>;

  constructor(
    private readonly name: string,
    private readonly subscribe: () => Promise<Subscription | ExecutionResult>,
    private readonly handle: (result: ExecutionResult) => Promise<void>,
  ) {}

  start(): Promise<void> {
    if (this.stopping) return this.stopping.then(() => this.start());
    if (this.starting) return this.starting;
    if (this.session || this.retry) return Promise.resolve();
    const session: Session = { cancelled: false };
    this.session = session;
    this.starting = this.open(session).finally(() => { this.starting = undefined; });
    return this.starting;
  }

  private async open(session: Session): Promise<void> {
    try {
      const result = await this.subscribe();
      if (!(Symbol.asyncIterator in result)) throw new Error('Subscription rejected');
      session.iterator = result[Symbol.asyncIterator]();
      if (session.cancelled) {
        await this.close(session);
        return;
      }
      logger.info('Subscription consumer running', { consumer: this.name });
      void this.consume(session);
    } catch {
      await this.finish(session, 'startup failure');
    }
  }

  private async consume(session: Session): Promise<void> {
    let reason = 'iterator completed';
    try {
      while (!session.cancelled) {
        const result = await session.iterator!.next();
        if (session.cancelled || result.done) break;
        await this.handle(result.value);
      }
    } catch {
      reason = 'iterator failure';
    }
    await this.finish(session, reason);
  }

  private close(session: Session): Promise<void> {
    if (!session.closing) {
      session.closing = Promise.resolve().then(async () => {
        await session.iterator?.return?.();
      });
    }
    return session.closing;
  }

  private async finish(session: Session, reason: string): Promise<void> {
    try {
      await this.close(session);
    } catch {
      // Do not replace a subscription whose cleanup failed: it may still be live.
      logger.error('Subscription consumer cleanup failed; restart required', { consumer: this.name });
      return;
    }
    if (session.cancelled || this.session !== session) return;
    this.session = undefined;
    logger.warn('Subscription consumer restarting', { consumer: this.name, reason, retryMs: 5000 });
    this.retry = setTimeout(() => {
      this.retry = undefined;
      void this.start();
    }, 5000);
    this.retry.unref?.();
  }

  stop(): Promise<void> {
    if (this.stopping) return this.stopping;
    if (this.retry) clearTimeout(this.retry);
    this.retry = undefined;
    const session = this.session;
    if (!session) return Promise.resolve();
    session.cancelled = true;
    this.stopping = (async () => {
      await this.starting;
      try {
        await this.close(session);
        if (this.session === session) this.session = undefined;
        logger.info('Subscription consumer stopped', { consumer: this.name });
      } catch {
        logger.error('Subscription consumer cleanup failed; restart required', { consumer: this.name });
      }
    })().finally(() => { this.stopping = undefined; });
    return this.stopping;
  }
}
