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
];

for (const file of files) {
  if (!fs.existsSync(file)) continue;
  let content = fs.readFileSync(file, 'utf8');

  // Remove imports
  content = content.replace(/^import\s+\{\s*checkRateLimit\s*\}\s+from\s+['"].*['"];?\s*$/gm, '');
  content = content.replace(/^import\s+\{\s*RATE_LIMITS\s*\}\s+from\s+['"].*['"];?\s*$/gm, '');

  // Remove block
  // Pattern 1:
  // const rateLimitError = await checkRateLimit(...);
  // if (rateLimitError) return rateLimitError;
  content = content.replace(/\s*const\s+rateLimitError\s*=\s*await\s+checkRateLimit\([^)]+\);\s*if\s*\(rateLimitError\)\s*return\s*rateLimitError;/g, '');

  // Pattern 2:
  // const rl = checkRateLimit(req, { ... });
  // if (rl) return rl;
  content = content.replace(/\s*const\s+(?:rl|rlLimit)\s*=\s*checkRateLimit\([\s\S]*?\);\s*if\s*\((?:rl|rlLimit)\)\s*return\s*(?:rl|rlLimit);/g, '');

  // trpc specific:
  // const rl = checkRateLimit(req, { max, windowMs });
  // if (rl) return rl;
  // Also remove `const max = Number(...)` and `const windowMs = Number(...)`
  if (file.includes('trpc')) {
    content = content.replace(/\s*const\s+max\s*=\s*Number[^;]+;/g, '');
    content = content.replace(/\s*const\s+windowMs\s*=\s*Number[^;]+;/g, '');
  }

  // trpc specific pattern 2:
  content = content.replace(/\s*const\s+rl\s*=\s*await\s+checkRateLimit\([\s\S]*?\);\s*if\s*\(rl\)\s*return\s*rl;/g, '');

  fs.writeFileSync(file, content, 'utf8');
}
console.log('Done!');
