const fs = require('fs');
const files = [
  'src/server/routers/orders.ts',
  'src/server/routers/customers.ts',
  'src/server/routers/requests.ts',
  'src/server/routers/agents.ts',
  'src/server/routers/tickets.ts'
];

files.forEach(file => {
  if (!fs.existsSync(file)) return;
  let content = fs.readFileSync(file, 'utf8');
  
  // Remove import
  content = content.replace(/import\s*\{\s*getCached\s*,\s*setCached\s*\}\s*from\s*['"]@\/lib\/redis['"];?\n?/g, '');
  
  // Remove simple cache read
  content = content.replace(/const\s+cacheKey\s*=\s*`[^`]+`;\n\s*const\s+cached\s*=\s*await\s+getCached[^;]+;\n\s*if\s*\(cached\)\s*return\s*cached;\n/g, '');
  
  // Remove simple cache set
  content = content.replace(/await\s+setCached\([^,]+,\s*[a-zA-Z0-9_]+,\s*\d+\);\n/g, '');
  
  fs.writeFileSync(file, content);
});
