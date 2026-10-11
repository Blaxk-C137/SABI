// Runs after `npm install`. Fetches the voice models when the Node version can run the
// TypeScript installer. Set SABI_SKIP_MODELS=1 to skip the download.
import { spawnSync } from 'node:child_process'
import process from 'node:process'

if (process.env.SABI_SKIP_MODELS === '1') process.exit(0)

const [major, minor] = process.versions.node.split('.').map(Number)
const supported = major > 22 || (major === 22 && minor >= 18)
if (!supported) {
  console.warn(
    `[sabi] Node ${process.versions.node} cannot run the model installer. Use Node 22.18+, then run: npm run models:install`,
  )
  process.exit(0)
}

const r = spawnSync(process.execPath, ['scripts/install-models.ts', '--postinstall'], { stdio: 'inherit' })
process.exit(r.status ?? 0)
