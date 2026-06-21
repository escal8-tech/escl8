const fs = require('fs');

const files = [
  'src/app/api/auth/token/route.ts',
  'src/app/api/auth/refresh/route.ts',
  'src/app/api/upload/docs/route.ts',
  'src/app/api/widget/session/route.ts',
  'src/app/api/widget/chat/route.ts',
  'src/app/api/events/negotiate/route.ts',
  'src/app/api/rag/retrain/route.ts',
  'src/app/api/meta/whatsapp/send/route.ts',
  'src/app/api/meta/whatsapp/sync/route.ts',
  'src/app/api/trpc/[trpc]/route.ts',
  'src/lib/redis.ts',
];

for (const file of files) {
  if (!fs.existsSync(file)) continue;
  let content = fs.readFileSync(file, 'utf8');

  // Remove `checkRateLimit` definition from redis.ts
  if (file === 'src/lib/redis.ts') {
    content = content.replace(/export\s+async\s+function\s+checkRateLimit[\s\S]*?^}/m, '');
  }

  // Multi-line replacement for route files
  content = content.replace(/\s*const\s+rl\s*=\s*checkRateLimit\([^)]+\{[\s\S]*?\}\);\s*if\s*\(rl\)\s*return\s*rl;/g, '');
  content = content.replace(/\s*const\s+rl\s*=\s*checkRateLimit\([^)]+\);\s*if\s*\(rl\)\s*return\s*rl;/g, '');

  fs.writeFileSync(file, content, 'utf8');
}
console.log('Done 2!');
