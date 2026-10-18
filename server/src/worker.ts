import { loadEnv } from './lib/env.js';
import { cleanupOldRows, processBatch } from './outbox/process-batch.js';

async function main() {
  const env = loadEnv();
  console.info(`worker_started pollMs=${env.OUTBOX_POLL_MS}`);

  let stopping = false;
  let lastCleanup = 0;

  const shutdown = () => {
    console.info('worker_shutdown_requested');
    stopping = true;
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  while (!stopping) {
    try {
      const result = await processBatch();
      if (result.claimed > 0) {
        console.info(
          `worker_batch claimed=${result.claimed} done=${result.done} failed=${result.failed} retried=${result.retried} recovered=${result.recovered}`,
        );
      }

      // Cleanup about once an hour
      if (Date.now() - lastCleanup > 60 * 60 * 1000) {
        await cleanupOldRows();
        lastCleanup = Date.now();
        console.info('worker_cleanup_ok');
      }

      // If the batch was full, loop immediately; else wait
      if (result.claimed >= env.OUTBOX_BATCH_SIZE) {
        continue;
      }
    } catch (err) {
      console.error('worker_tick_failed', err);
    }

    await sleep(env.OUTBOX_POLL_MS);
  }

  console.info('worker_stopped');
  process.exit(0);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((err) => {
  console.error('worker_boot_failed', err);
  process.exit(1);
});
