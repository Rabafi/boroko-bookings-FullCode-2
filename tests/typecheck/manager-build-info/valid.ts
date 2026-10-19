import {
  APP_VERSION,
  APP_BUILD_ID,
  shortBuildId,
  serviceWorkerUrl,
  getWorkerBuildInfo,
} from "../../../manager-pwa/src/lib/buildInfo.js";

const version: string = APP_VERSION;
const buildId: string = APP_BUILD_ID;
const shortDefault: string = shortBuildId();
const shortKnown: string = shortBuildId("abcdef1234567890xyz");
const shortFromUnknown: unknown = shortBuildId(42);
const workerUrl: string = serviceWorkerUrl();

const fromNull = getWorkerBuildInfo(null);
const fromOmitted = getWorkerBuildInfo();
const nullVersion: string | undefined = fromNull.version;
const upper: string = fromOmitted.buildId === undefined ? "missing" : fromOmitted.buildId.toUpperCase();

// Declared ServiceWorker input without touching registration/update flows.
declare const waitingWorker: ServiceWorker;
const fromWorker = getWorkerBuildInfo(waitingWorker);
const workerVersion: string | undefined = fromWorker.version;

// Real browser APIs resolve here (compile only, never invoked).
const controller: ServiceWorker | null = navigator.serviceWorker.controller;
const parsedUrl: URL = new URL("/sw.js", window.location.origin);

void version;
void buildId;
void shortDefault;
void shortKnown;
void shortFromUnknown;
void workerUrl;
void nullVersion;
void upper;
void workerVersion;
void controller;
void parsedUrl;
