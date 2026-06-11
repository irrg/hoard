export type RunTask = (task: () => Promise<void>) => Promise<void>;

export class Scheduler {
  private readonly limit: number;
  private slots = new Set<Promise<void>>();
  private pending = new Set<Promise<void>>();

  constructor(jobs: number) {
    if (!Number.isInteger(jobs) || jobs < 1) {
      throw new RangeError(`Scheduler: jobs must be a positive integer, got ${jobs}`);
    }
    this.limit = jobs;
  }

  run(task: () => Promise<void>): Promise<void> {
    const p = this._execute(task);
    // settled always resolves so it's safe to store in pending without a rejection handler
    const settled = p.then(
      () => {},
      () => {},
    );
    this.pending.add(settled);
    settled.then(() => this.pending.delete(settled));
    return p;
  }

  private async _execute(task: () => Promise<void>): Promise<void> {
    while (this.slots.size >= this.limit) {
      await Promise.race(this.slots);
    }

    let done!: () => void;
    const slot = new Promise<void>((r) => {
      done = r;
    });
    this.slots.add(slot);

    try {
      await task();
    } finally {
      this.slots.delete(slot);
      done();
    }
  }

  async drain(): Promise<void> {
    await Promise.all(this.pending);
  }
}
