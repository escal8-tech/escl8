import fs from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()
const SRC_DIR = path.join(ROOT, 'src')
const FILE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'])
const RAW_TOKEN_PATTERN = /\bgetIdToken\s*\(/g

const ALLOWLIST = new Map([
  ['src/lib/client-auth-ops.ts', 'shared client auth wrapper'],
  ['src/utils/trpc.tsx', 'central tRPC auth header injection'],
])

function collectSourceFiles(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  const files = []

  for (const entry of entries) {
    if (entry.name === '.next' || entry.name === 'node_modules') continue
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...collectSourceFiles(fullPath))
      continue
    }
    if (FILE_EXTENSIONS.has(path.extname(entry.name))) {
      files.push(fullPath)
    }
  }

  return files
}

const hits = []
for (const filePath of collectSourceFiles(SRC_DIR)) {
  const relativePath = path.relative(ROOT, filePath).replaceAll(path.sep, '/')
  const source = fs.readFileSync(filePath, 'utf8')
  const lines = source.split('\n')

  lines.forEach((line, index) => {
    if (!RAW_TOKEN_PATTERN.test(line)) return
    hits.push({
      approved: ALLOWLIST.has(relativePath),
      line: index + 1,
      path: relativePath,
      text: line.trim(),
    })
    RAW_TOKEN_PATTERN.lastIndex = 0
  })
}

const approvedHits = hits.filter((hit) => hit.approved)
const violations = hits.filter((hit) => !hit.approved)

console.log('Raw getIdToken() usage inventory:')
for (const [filePath, reason] of ALLOWLIST.entries()) {
  const count = approvedHits.filter((hit) => hit.path === filePath).length
  console.log(`- ${filePath} (${count} hit${count === 1 ? '' : 's'}): ${reason}`)
}

if (violations.length === 0) {
  console.log('client_auth_usage_ok')
  process.exit(0)
}

console.error('\nUnapproved raw getIdToken() usage found:')
for (const hit of violations) {
  console.error(`- ${hit.path}:${hit.line}`)
  console.error(`  ${hit.text}`)
}
console.error('\nUse fetchWithFirebaseAuth() or getFirebaseIdTokenOrThrow() from src/lib/client-auth-ops.ts instead.')
process.exit(1)
