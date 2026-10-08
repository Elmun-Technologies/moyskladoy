// ============================================================================
// Tick drayveri: REDIS_URL bo'lsa - BullMQ repeatable job (bir nechta
// nusxada ishlatilganda ham dedupe DB tomonida); bo'lmasa - in-process
// setInterval (dev/demo). Ikkalasi ham shu interfeys orqali.
// ============================================================================
import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';

export interface TickDriver {
  start(onTick: () => Promise<void>): Promise<void>;
  stop(): Promise<void>;
}

export interface QueueOptions {
  redisUrl?: string | null;
  intervalMs: number;
  name?: string;
  log?: (m: string) => void;
}

export async function createTickDriver(opts: QueueOptions): Promise<TickDriver> {
  const name = opts.name ?? 'moy-skladoy-tick';
  if (opts.redisUrl) {
    const connection = new Redis(opts.redisUrl, { maxRetriesPerRequest: null });
    const queue = new Queue(name, { connection });
    let worker: Worker | null = null;
    return {
      async start(onTick) {
        await queue.add('tick', {}, { repeat: { every: opts.intervalMs }, removeOnComplete: true, removeOnFail: 50 });
        const w = new Worker(name, async () => { await onTick(); }, { connection });
        w.on('failed', (_job, err) => opts.log?.('[queue] tick failed: ' + String(err).slice(0, 160)));
        worker = w;
        opts.log?.('[queue] BullMQ driver');
      },
      async stop() {
        await worker?.close();
        await queue.close();
      },
    };
  }
  let timer: NodeJS.Timeout | null = null;
  let tickRunning = false;
  return {
    async start(onTick) {
      timer = setInterval(() => {
        // setInterval does not await async callbacks; serialize work so a slow
        // tick cannot double-dispatch the same SMS window/campaign rows.
        if (tickRunning) return;
        tickRunning = true;
        void onTick()
          .catch((e) => opts.log?.('[queue] tick error: ' + String((e as Error).message).slice(0, 160)))
          .finally(() => { tickRunning = false; });
      }, opts.intervalMs);
      opts.log?.('[queue] interval driver (redis yo\'q)');
    },
    async stop() {
      if (timer) clearInterval(timer);
    },
  };
}
