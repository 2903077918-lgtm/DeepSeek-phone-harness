const fs = require('fs');
const c = fs.readFileSync('web/index.html', 'utf8');
const lines = c.split('\n');
const emojiRe = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}\u{2190}-\u{21FF}\u{2B50}\u{2705}\u{274C}\u{2753}\u{2764}\u{2795}\u{2796}\u{2708}\u{2709}\u{270F}\u{2714}\u{2716}\u{2728}\u{2B05}\u{2B06}\u{2B07}\u{2B95}\u{25AA}\u{25AB}\u{25B6}\u{25C0}\u{25FB}-\u{25FE}]/u;
let n = 0;
lines.forEach((l, i) => {
  const m = l.match(emojiRe);
  if (m) { n++; const t = l.trim().slice(0, 100); console.log(`L${i+1} [${m[0]}] ${t}`); }
});
console.log('--- 总行数:', n);
