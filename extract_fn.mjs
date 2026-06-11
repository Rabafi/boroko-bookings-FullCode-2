import fs from 'fs';
const src = fs.readFileSync('./src/main/database.js', 'utf8');

function extractFunction(name) {
  const regex = new RegExp(`export\\s+(?:async\\s+)?function\\s+${name}\\s*\\([^{]*\\)\\s*\\{`, 'g');
  const match = regex.exec(src);
  if (!match) return `Function ${name} not found`;
  let start = match.index;
  let braceCount = 0;
  let inString = false;
  let escape = false;
  let stringChar = '';
  let end = start;
  for (let i = start + match[0].length - 1; i < src.length; i++) {
    const char = src[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (char === '\\') {
      escape = true;
      continue;
    }
    if (inString) {
      if (char === stringChar) {
        inString = false;
      }
    } else {
      if (char === '"' || char === "'" || char === '`') {
        inString = true;
        stringChar = char;
      } else if (char === '{') {
        braceCount++;
      } else if (char === '}') {
        braceCount--;
        if (braceCount === 0) {
          end = i + 1;
          break;
        }
      }
    }
  }
  return src.substring(start, end);
}

console.log(extractFunction('getFinancialAuditLog'));
console.log('---');
console.log(extractFunction('getAllBookings'));
console.log('---');
console.log(extractFunction('getBookingPayments'));
