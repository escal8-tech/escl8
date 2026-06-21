const fs = require('fs');

const files = [
  'src/app/api/upload/docs/route.ts',
  'src/app/api/widget/session/route.ts',
  'src/app/api/widget/chat/route.ts',
  'src/app/api/events/negotiate/route.ts',
  'src/app/api/rag/retrain/route.ts',
  'src/app/api/meta/whatsapp/send/route.ts',
  'src/app/api/meta/whatsapp/sync/route.ts',
  'src/app/api/trpc/[trpc]/route.ts',
];

for (const file of files) {
  if (!fs.existsSync(file)) continue;
  let content = fs.readFileSync(file, 'utf8');

  // Replace `checkRateLimit(...)` with `{ ok: true, headers: {} }` or just remove it
  content = content.replace(/const\s+rl\s*=\s*checkRateLimit\([\s\S]*?\}\);[\s\S]*?if\s*\(!rl\.ok\)\s*\{[\s\S]*?return\s*NextResponse\.json\([\s\S]*?\}\);?\s*\}/g, '');
  content = content.replace(/const\s+rl\s*=\s*checkRateLimit\([^;]+\);[\s\S]*?if\s*\(!rl\.ok\)\s*\{[\s\S]*?return\s*NextResponse\.json\([\s\S]*?\}\);?\s*\}/g, '');
  content = content.replace(/const\s+rl\s*=\s*checkRateLimit\([^;]+\);[\s\S]*?if\s*\(!rl\)\s*return\s*rl;/g, '');

  content = content.replace(/,\s*\{\s*headers:\s*rl\.headers\s*\}/g, '');
  content = content.replace(/headers:\s*rl\.headers/g, 'headers: {}');

  // TRPC
  content = content.replace(/const\s+rl\s*=\s*checkRateLimit\([^;]+\);[\s\S]*?if\s*\(!?rl\)\s*return\s*rl;/g, '');
  content = content.replace(/const\s+rl\s*=\s*checkRateLimit\([^;]+\);[\s\S]*?if\s*\(rl\)\s*return\s*rl;/g, '');

  fs.writeFileSync(file, content, 'utf8');
}
console.log('Done 3!');
