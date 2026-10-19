/**
 * Electron Vite replaces this identifier through the `define` entry in
 * electron.vite.config.js. It may be absent in unbundled test environments;
 * productIdentity.js keeps its existing typeof guard for those runtimes.
 */
type TsaBonnoBuildProductId =
  (typeof import('../../packages/product-config/index.js').PRODUCTS)[
    keyof typeof import('../../packages/product-config/index.js').PRODUCTS
  ]['id'];

declare const __TSA_BONNO_PRODUCT__: TsaBonnoBuildProductId | undefined;
