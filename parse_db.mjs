import fs from 'fs';
const src = fs.readFileSync('./src/main/database.js', 'utf8');
const exportsRegex = /export\s+(?:async\s+)?function\s+([a-zA-Z0-9_]+)/g;
let match;
const fns = [];
while ((match = exportsRegex.exec(src)) !== null) {
  fns.push(match[1]);
}
console.log(fns.filter(k => k.toLowerCase().includes('payment') || k.toLowerCase().includes('audit') || k.toLowerCase().includes('booking')).join(', '));
