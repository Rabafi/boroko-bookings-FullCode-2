import {
  ensureDir,
  readJsonFile,
  writeJsonFile,
} from "../../../src/main/domains/fileStore.js";

ensureDir(42);
writeJsonFile(42, { ok: true });

const loaded = readJsonFile("/tmp/b02b-file-store/invalid/a.json", null);
const unsafeValue = loaded.name;

const blockedGlobal = document;

void unsafeValue;
void blockedGlobal;
