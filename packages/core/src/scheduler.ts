export type RunTask = (task: () => Promise<void>) => Promise<void>;

export class Scheduler {
  private readonly limit: number;
  private slots = new Set<Promise<void>>();

  constructor(jobs: number) {
    this.limit = jobs;
  }

  async run(task: () => Promise<void>): Promise<void> {
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
    await Promise.all(this.slots);
  }
}
