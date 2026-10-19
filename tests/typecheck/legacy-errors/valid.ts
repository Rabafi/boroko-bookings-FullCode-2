import { sanitizePosError } from "../../../legacy-pos/src/shared/errors.js";

const fromString: string = sanitizePosError("fetch failed");
const fromError: string = sanitizePosError(new Error("fetch failed"));
const fromObject: string = sanitizePosError({ code: 500 });
const fromUnknown: string = sanitizePosError(undefined);
const fromNull: string = sanitizePosError(null);
const fromNumber: string = sanitizePosError(42);
const length: number = sanitizePosError("session expired").length;
const upper: string = sanitizePosError("duplicate key").toUpperCase();

void fromString;
void fromError;
void fromObject;
void fromUnknown;
void fromNull;
void fromNumber;
void length;
void upper;
