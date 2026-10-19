import { APP_VERSION, getWorkerBuildInfo } from '../../../manager-pwa/src/lib/buildInfo.js';
const numeric: number = APP_VERSION;
const info = getWorkerBuildInfo(null);
const upper = info.buildId.toUpperCase();
getWorkerBuildInfo(42);
const nodeVersion = process.version;
const privileged = window.api;
void numeric; void upper; void nodeVersion; void privileged;
