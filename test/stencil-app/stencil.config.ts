import { Config } from '@stencil/core';
export const config: Config = {
  namespace: 'demo',
  outputTargets: [{ type: 'www', serviceWorker: null, baseUrl: '/', dir: process.env.STENCIL_OUT ?? 'www' }],
};
