// -----------------------------------------------------------------------------
// The SDK handlers, wired to the app. Shared by index.js and the end-to-end
// tests, so the tests run the exact wiring of the container.
// -----------------------------------------------------------------------------

import { ACTIONS } from './constants.js';

export function registerHandlers(gladys, app, logger) {
  // Discovery: the Wolf devices appear once the ISM8 reported their values.
  gladys.onScanRequest(() => app.scan());
  gladys.onDeviceCreated(() => app.deviceChanged());
  gladys.onDeviceUpdated(() => app.deviceChanged());
  gladys.onDeviceDeleted(() => app.deviceChanged());

  // Commands: hot water setpoints and programs; standby always allowed.
  gladys.onSetValue((device, feature, value) => app.setValue(device, feature, value));

  // Configuration screen button.
  gladys.onAction(ACTIONS.REFRESH, () => app.refreshButton());

  // Configuration changed by the user.
  gladys.onConfigUpdated((config) => {
    logger?.info('Configuration updated');
    return app.configUpdated(config);
  });

  // Connection lifecycle: the configuration is read (retried without end
  // while it fails), then the status and the Discovery are sent again (the
  // core keeps them in memory only).
  gladys.on('connected', () => {
    app.gladysConnected().catch((err) => logger?.error('Start failed', err));
  });
}
