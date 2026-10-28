// -----------------------------------------------------------------------------
// Entry point: SDK wiring only (src/handlers.js registers every handler BEFORE
// connect(), and delegates to the Ism8App of src/app.js).
//
// Environment variables provided by the Gladys supervisor, read by the SDK:
// GLADYS_HOST_API_URL, GLADYS_INTEGRATION_TOKEN, GLADYS_INTEGRATION_SELECTOR.
// The same image runs the `ism8-link` sub-container (src/receiver.js).
// -----------------------------------------------------------------------------

import { GladysIntegration, logger } from '@gladysassistant/integration-sdk';
import { Ism8App } from './src/app.js';
import { registerHandlers } from './src/handlers.js';

const gladys = new GladysIntegration();
const app = new Ism8App({ gladys });

registerHandlers(gladys, app, logger);
gladys.handleShutdown(() => app.stop());

// /data first: a stop kept there leaves as soon as the link answers, before Gladys.
app.boot().catch((err) => logger.error('Start-up failed', err));

logger.info('Starting the Wolf ISM8 integration...');
gladys.connect().catch((err) => {
  logger.error('Initial connection failed', err);
  process.exit(1);
});
