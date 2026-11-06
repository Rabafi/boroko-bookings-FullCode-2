const fs=require('fs'),crypto=require('crypto'),path=require('path');
const out='docs/engineering/typescript-migration/evidence/preimage-batch84';
fs.mkdirSync(out,{recursive:true});
const files=[
 'src/main/domains/starterBackup.js','src/main/domains/starterRecovery.js',
 'src/main/ai/aiOrchestrator.js',
 'src/main/domains/reports.js','src/main/domains/restaurantAccountingV2.js',
 'src/main/domains/customerCredit.js','src/main/domains/inventory.js',
 'src/main/domains/admin.js','src/main/domains/supplies.js',
 'src/main/domains/bookings.js','src/main/domains/pos.js','src/main/index.js',
 'src/renderer/src/components/Reports.jsx','src/renderer/src/components/Bookings.jsx',
 'src/renderer/src/components/POS.jsx','src/renderer/src/components/Settings.jsx',
 'src/renderer/src/components/hotel/StaffOperations.jsx','src/renderer/src/components/hotel/VenueManagement.jsx',
 'src/renderer/src/components/AdminCentral.jsx','src/renderer/src/components/Dashboard.jsx',
 'src/renderer/src/components/hospitality-pos/HposSystemHealth.jsx',
 'src/renderer/src/components/LicensingWorkbench.jsx',
 'src/renderer/src/components/hospitality-pos/HposTerminal.jsx',
 'src/renderer/src/App.jsx'
];
const rows=['path,sha256,bytes'];
for(const f of files){
 const b=fs.readFileSync(f); const target=path.join(out,f.replace(/\//g,'__')+'.before');
 fs.writeFileSync(target,b);
 rows.push(`${f},${crypto.createHash('sha256').update(b).digest('hex').toUpperCase()},${b.length}`);
}
fs.writeFileSync(path.join(out,'HASHES.csv'),rows.join('\n')+'\n');
console.log(rows.join('\n'));
