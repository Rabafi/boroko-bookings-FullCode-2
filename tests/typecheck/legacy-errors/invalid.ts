import { sanitizePosError } from '../../../legacy-pos/src/shared/errors.js';
const numeric: number = sanitizePosError('fetch failed');
const message = sanitizePosError({ message: 'x' });
const success = message.success;
const nodeVersion = process.version;
const browserDocument = document;
const managerBuild = __BOROKO_APP_VERSION__;
void numeric; void success; void nodeVersion; void browserDocument; void managerBuild;
