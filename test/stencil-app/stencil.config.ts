import { Config } from '@stencil/core';
export const config: Config = {
  namespace: 'demo',
  // Built into a temporary folder by test/stencil.test.mjs.
  outputTargets: [{ type: 'www', serviceWorker: null, baseUrl: '/', dir: process.env.STENCIL_OUT ?? 'www' }],
};
