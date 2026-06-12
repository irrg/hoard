import { describe, expect, it } from 'vitest';

import { FairScheduler, Scheduler } from '../src/scheduler.js';

describe('Scheduler', () => {
  it('runs tasks up to the concurrency limit', async () => {
    const scheduler = new Scheduler(2);
    const running: number[] = [];
    const maxConcurrent: number[] = [];

    const makeTask = (id: number) => async () => {
      running.push(id);
      maxConcurrent.push(running.length);
      await new Promise((r) => setTimeout(r, 10));
      running.splice(running.indexOf(id), 1);
    };

    await Promise.all([0, 1, 2, 3].map((id) => scheduler.run(makeTask(id))));
    expect(Math.max(...maxConcurrent)).toBe(2);
  });

  it('resolves when all tasks complete', async () => {
    const scheduler = new Scheduler(3);
    let completed = 0;
    const tasks = Array.from({ length: 5 }, () => async () => {
      await new Promise((r) => setTimeout(r, 5));
      completed++;
    });
    await Promise.all(tasks.map((t) => scheduler.run(t)));
    expect(completed).toBe(5);
  });

  it('propagates task errors to the caller', async () => {
    const scheduler = new Scheduler(2);
    const result = scheduler.run(async () => {
      throw new Error('task failed');
    });
    await expect(result).rejects.toThrow('task failed');
  });

  it('continues scheduling after a failed task', async () => {
    const scheduler = new Scheduler(2);
    let completed = 0;
    const tasks: Array<() => Promise<void>> = [
      async () => {
        throw new Error('fail');
      },
      async () => {
        completed++;
      },
      async () => {
        completed++;
      },
    ];
    const results = await Promise.allSettled(tasks.map((t) => scheduler.run(t)));
    expect(results[0].status).toBe('rejected');
    expect(completed).toBe(2);
  });

  it('drain() resolves when all in-flight tasks complete', async () => {
    const scheduler = new Scheduler(4);
    let completed = 0;
    const tasks = Array.from({ length: 3 }, () => async () => {
      await new Promise((r) => setTimeout(r, 10));
      completed++;
    });
    tasks.forEach((t) => scheduler.run(t));
    await scheduler.drain();
    expect(completed).toBe(3);
  });

  it('constructor throws on zero or negative jobs', () => {
    expect(() => new Scheduler(0)).toThrow(RangeError);
    expect(() => new Scheduler(-1)).toThrow(RangeError);
  });

  it('constructor throws on non-integer jobs', () => {
    expect(() => new Scheduler(1.5)).toThrow(RangeError);
    expect(() => new Scheduler(NaN)).toThrow(RangeError);
  });

  it('drain() waits for tasks queued behind the concurrency limit', async () => {
    const scheduler = new Scheduler(2);
    let completed = 0;
    const tasks = Array.from({ length: 5 }, () => async () => {
      await new Promise((r) => setTimeout(r, 10));
      completed++;
    });
    tasks.forEach((t) => scheduler.run(t));
    await scheduler.drain();
    expect(completed).toBe(5);
  });
});

describe('FairScheduler', () => {
  it('runs tasks up to the global slot limit', async () => {
    const s = new FairScheduler(2);
    let active = 0;
    let maxActive = 0;

    const makeTask = () => async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 10));
      active--;
    };

    await Promise.all([
      s.run('a', makeTask()),
      s.run('b', makeTask()),
      s.run('a', makeTask()),
      s.run('b', makeTask()),
    ]);
    expect(maxActive).toBe(2);
  });

  it('returns values from tasks', async () => {
    const s = new FairScheduler(2);
    const result = await s.run('a', async () => 42);
    expect(result).toBe(42);
  });

  it('propagates errors to caller', async () => {
    const s = new FairScheduler(2);
    await expect(
      s.run('a', async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
  });

  it('continues scheduling after a failed task', async () => {
    const s = new FairScheduler(1);
    let completed = 0;
    const results = await Promise.allSettled([
      s.run('a', async () => {
        throw new Error('fail');
      }),
      s.run('a', async () => {
        completed++;
      }),
    ]);
    expect(results[0].status).toBe('rejected');
    expect(completed).toBe(1);
  });

  it('interleaves tasks across providers — no single provider monopolizes', async () => {
    const s = new FairScheduler(1);
    const order: string[] = [];

    // a1 is dispatched synchronously before 'b' is registered, so order starts [a, a, b, a, b, b].
    // Key property: NOT all-a then all-b, which would be ['a','a','a','b','b','b'].
    await Promise.all([
      s.run('a', async () => {
        order.push('a');
      }),
      s.run('a', async () => {
        order.push('a');
      }),
      s.run('a', async () => {
        order.push('a');
      }),
      s.run('b', async () => {
        order.push('b');
      }),
      s.run('b', async () => {
        order.push('b');
      }),
      s.run('b', async () => {
        order.push('b');
      }),
    ]);

    expect(order).toEqual(['a', 'a', 'b', 'a', 'b', 'b']);
    // Confirm it is NOT sequential provider ordering
    expect(order).not.toEqual(['a', 'a', 'a', 'b', 'b', 'b']);
  });

  it('FIFO within a single provider', async () => {
    const s = new FairScheduler(1);
    const order: number[] = [];
    await Promise.all([
      s.run('a', async () => {
        order.push(1);
      }),
      s.run('a', async () => {
        order.push(2);
      }),
      s.run('a', async () => {
        order.push(3);
      }),
    ]);
    expect(order).toEqual([1, 2, 3]);
  });

  it('reserves progress slots for registered providers', async () => {
    const s = new FairScheduler(4, ['humble', 'itchio', 'drivethru', 'boh']);
    const started: string[] = [];
    let releaseHumble!: () => void;
    const humbleGate = new Promise<void>((resolve) => {
      releaseHumble = resolve;
    });

    const humbleTasks = Array.from({ length: 4 }, (_, i) =>
      s.run('humble', async () => {
        started.push(`humble-${i}`);
        await humbleGate;
      }),
    );

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(started).toEqual(['humble-0']);

    const itchTask = s.run('itchio', async () => {
      started.push('itchio');
    });
    await itchTask;
    expect(started).toContain('itchio');

    releaseHumble();
    await Promise.all(humbleTasks);
  });

  it('hands a single slot to the next queued provider', async () => {
    const s = new FairScheduler(1, ['humble', 'itchio']);
    const started: string[] = [];
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const first = s.run('humble', async () => {
      started.push('humble-1');
      await firstGate;
    });
    const second = s.run('humble', async () => {
      started.push('humble-2');
    });
    const itch = s.run('itchio', async () => {
      started.push('itchio');
    });

    releaseFirst();
    await Promise.all([first, itch, second]);
    expect(started).toEqual(['humble-1', 'itchio', 'humble-2']);
  });

  it('releases a completed provider reservation', async () => {
    const s = new FairScheduler(2, ['a', 'b']);
    s.release('b');

    let active = 0;
    let maxActive = 0;
    const tasks = Array.from({ length: 2 }, () =>
      s.run('a', async () => {
        active++;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active--;
      }),
    );

    await Promise.all(tasks);
    expect(maxActive).toBe(2);
  });

  it('lends idle capacity after every provider has checked in', async () => {
    const providers = ['a', 'b', 'c', 'd'];
    const s = new FairScheduler(4, providers);
    await Promise.all(providers.map((provider) => s.run(provider, async () => {})));

    let active = 0;
    let maxActive = 0;
    const tasks = Array.from({ length: 4 }, () =>
      s.run('a', async () => {
        active++;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active--;
      }),
    );

    await Promise.all(tasks);
    expect(maxActive).toBe(4);
  });

  it('constructor throws on invalid jobs', () => {
    expect(() => new FairScheduler(0)).toThrow(RangeError);
    expect(() => new FairScheduler(-1)).toThrow(RangeError);
    expect(() => new FairScheduler(1.5)).toThrow(RangeError);
  });
});
