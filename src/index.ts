/**
 * Application entry point (SCAFFOLD).
 *
 * Wires nothing yet — it exists so the skeleton has a buildable root and a
 * single place to bootstrap the HTTP server, job scheduler, and webhook
 * receiver once the phases land. See `docs/BUILD_PLAN.md` for sequencing.
 */

import { config } from './config/index.js';

function main(): void {
  console.log(
    `[grape-shopify] scaffold boot — env=${config.env} port=${config.port} ` +
      `apiVersion=${config.shopify.apiVersion}`,
  );
  console.log('[grape-shopify] No phases wired yet. See docs/BUILD_PLAN.md.');
}

main();
