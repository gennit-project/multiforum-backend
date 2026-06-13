export type FindArgs = {
  where?: Record<string, unknown>;
  selectionSet?: string;
};

export type UpdateArgs = {
  where?: Record<string, unknown>;
  update?: Record<string, unknown>;
};

export class ModelStub {
  findCalls: FindArgs[] = [];
  updateCalls: UpdateArgs[] = [];

  constructor(
    private findImpl: (args: FindArgs) => any[] = () => [],
    private updateImpl: (args: UpdateArgs) => any = () => ({})
  ) {}

  async find(args: FindArgs) {
    this.findCalls.push(args);
    return this.findImpl(args);
  }

  async update(args: UpdateArgs) {
    this.updateCalls.push(args);
    return this.updateImpl(args);
  }
}

export const createRecord = (value: any) => ({
  get: (key: string) => (key === "result" ? value : value?.[key]),
});

export const createTransactionDriver = ({
  firstRunRecords = [],
}: {
  firstRunRecords?: any[];
} = {}) => {
  const calls = {
    run: [] as any[],
    commit: 0,
    rollback: 0,
    close: 0,
  };

  const tx = {
    run: async (...args: any[]) => {
      calls.run.push(args);

      if (calls.run.length === 1) {
        return { records: firstRunRecords };
      }

      return { records: [] };
    },
    commit: async () => {
      calls.commit += 1;
    },
    rollback: async () => {
      calls.rollback += 1;
    },
  };

  const driver = {
    session: () => ({
      beginTransaction: () => tx,
      close: () => {
        calls.close += 1;
      },
    }),
  };

  return { driver, calls };
};

export const withMutedConsoleError = async <T>(fn: () => Promise<T>) => {
  const originalConsoleError = console.error;
  console.error = () => {};

  try {
    return await fn();
  } finally {
    console.error = originalConsoleError;
  }
};
