import { createApp } from './app.js';
import { loadEnv } from './lib/env.js';

async function main() {
  const env = loadEnv();
  const app = createApp();
  app.listen(env.PORT, () => {
    console.info(`api_listening port=${env.PORT}`);
  });
}

main().catch((err) => {
  console.error('api_boot_failed', err);
  process.exit(1);
});
