import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

const legacyRoot = path.resolve(process.cwd());
const workspaceRoot = path.resolve(legacyRoot, '..');
const outputDir = path.join(legacyRoot, 'build', 'generated');
const outputPath = path.join(outputDir, 'legacy-pos-runtime-config.json');

function readEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  return dotenv.parse(fs.readFileSync(filePath, 'utf-8'));
}

const merged = {};
for (const filePath of [
  path.join(workspaceRoot, '.env'),
  path.join(workspaceRoot, '.env.local'),
  path.join(legacyRoot, '.env'),
  path.join(legacyRoot, '.env.local')
]) {
  Object.assign(merged, readEnvFile(filePath));
}

const runtimeConfig = {
  supabaseUrl: process.env.VITE_SUPABASE_URL || merged.VITE_SUPABASE_URL || '',
  supabaseAnonKey: process.env.VITE_SUPABASE_KEY || merged.VITE_SUPABASE_KEY || '',
  generatedAt: new Date().toISOString()
};

fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(outputPath, JSON.stringify(runtimeConfig, null, 2), 'utf-8');

if (!runtimeConfig.supabaseUrl || !runtimeConfig.supabaseAnonKey) {
  console.warn('Legacy POS runtime config was generated without Supabase credentials.');
}
