import db from './src/main/database.js';
console.log(Object.keys(db).filter(k => k.toLowerCase().includes('payment') || k.toLowerCase().includes('audit')));
