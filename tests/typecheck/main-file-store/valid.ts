import fs from "node:fs";
import path from "node:path";
import {
  ensureDir,
  readJsonFile,
  writeJsonFile,
} from "../../../src/main/domains/fileStore.js";

ensureDir("/tmp/b02b-file-store/valid");
ensureDir(null);
ensureDir();

// readJsonFile results stay unknown even with a shaped fallback: a fallback
// does not validate successfully parsed JSON.
const fromPath: unknown = readJsonFile("/tmp/b02b-file-store/valid/a.json", null);
const withShapedFallback: unknown = readJsonFile("/tmp/b02b-file-store/valid/a.json", { ok: true });

// Node builtins resolve through the declared Node typings.
const joined: string = path.join("a", "b");
const present: boolean = fs.existsSync("/tmp");

writeJsonFile("/tmp/b02b-file-store/valid/a.json", { ok: true });

void fromPath;
void withShapedFallback;
void joined;
void present;
