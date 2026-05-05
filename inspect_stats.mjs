import db from './src/main/database.js';
async function run() {
  const stats = await db.getDashboardStats().catch(e => e.message);
  console.log(JSON.stringify(stats, null, 2));
}
run();
