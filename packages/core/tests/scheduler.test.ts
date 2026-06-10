import { describe, expect, it } from 'vitest';

import { Scheduler } from '../src/scheduler.js';

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
});
