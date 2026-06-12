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

  run<T>(task: () => Promise<T>): Promise<T> {
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

  private async _execute<T>(task: () => Promise<T>): Promise<T> {
    while (this.slots.size >= this.limit) {
      await Promise.race(this.slots);
    }

    let done!: () => void;
    const slot = new Promise<void>((r) => {
      done = r;
    });
    this.slots.add(slot);

    try {
      return await task();
    } finally {
      this.slots.delete(slot);
      done();
    }
  }

  async drain(): Promise<void> {
    await Promise.all(this.pending);
  }
}

type AnyEntry = {
  task: () => Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
};

export class FairScheduler {
  private readonly limit: number;
  private active = 0;
  private activeByProvider = new Map<string, number>();
  private submittedProviders = new Set<string>();
  private queues = new Map<string, AnyEntry[]>();
  private providerOrder: string[] = [];
  private rrIndex = 0;

  constructor(jobs: number, providers: Iterable<string> = []) {
    if (!Number.isInteger(jobs) || jobs < 1) {
      throw new RangeError(`FairScheduler: jobs must be a positive integer, got ${jobs}`);
    }
    this.limit = jobs;
    for (const provider of providers) this.register(provider);
  }

  register(provider: string): void {
    if (this.queues.has(provider)) return;
    this.queues.set(provider, []);
    this.activeByProvider.set(provider, 0);
    this.providerOrder.push(provider);
  }

  release(provider: string): void {
    const queue = this.queues.get(provider);
    if (!queue || queue.length > 0 || (this.activeByProvider.get(provider) ?? 0) > 0) return;

    const idx = this.providerOrder.indexOf(provider);
    if (idx >= 0) {
      this.providerOrder.splice(idx, 1);
      if (this.providerOrder.length === 0) this.rrIndex = 0;
      else if (idx < this.rrIndex) this.rrIndex--;
      this.rrIndex %= this.providerOrder.length || 1;
    }
    this.queues.delete(provider);
    this.activeByProvider.delete(provider);
    this.submittedProviders.delete(provider);
    this._dispatch();
  }

  run<T>(provider: string, task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.register(provider);
      this.submittedProviders.add(provider);
      this.queues.get(provider)!.push({
        task: task as () => Promise<unknown>,
        resolve: (v) => resolve(v as T),
        reject,
      });
      this._dispatch();
    });
  }

  private _dispatch(): void {
    while (this.active < this.limit) {
      const entry = this._next();
      if (!entry) break;
      this.active++;
      const { provider, task, resolve, reject } = entry;
      this.activeByProvider.set(provider, (this.activeByProvider.get(provider) ?? 0) + 1);
      task().then(
        (v) => {
          resolve(v);
          this._complete(provider);
        },
        (e) => {
          reject(e);
          this._complete(provider);
        },
      );
    }
  }

  private _complete(provider: string): void {
    this.active--;
    this.activeByProvider.set(provider, (this.activeByProvider.get(provider) ?? 1) - 1);
    this._dispatch();
  }

  private _next(): (AnyEntry & { provider: string }) | null {
    const n = this.providerOrder.length;
    for (let i = 0; i < n; i++) {
      const idx = (this.rrIndex + i) % n;
      const provider = this.providerOrder[idx];
      const q = this.queues.get(provider)!;
      if (q.length > 0 && this._canRun(provider)) {
        this.rrIndex = (idx + 1) % n;
        return { provider, ...q.shift()! };
      }
    }
    return null;
  }

  private _canRun(provider: string): boolean {
    if (this.providerOrder.length > this.limit) return true;

    let reservedForOthers = 0;
    for (const other of this.providerOrder) {
      const otherNeedsProgress =
        !this.submittedProviders.has(other) || (this.queues.get(other)?.length ?? 0) > 0;
      if (
        other !== provider &&
        otherNeedsProgress &&
        (this.activeByProvider.get(other) ?? 0) === 0
      ) {
        reservedForOthers++;
      }
    }
    return this.active < this.limit - reservedForOthers;
  }
}
