import path from 'node:path'

export interface ServerConfig {
  port: number
  modelDir: string
  production: boolean
}

/**
 * Every field has a working default, so a missing .env is not fatal —
 * only an explicitly invalid value throws.
 */
export function readConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const rawPort = env.PORT?.trim()
  const port = rawPort ? Number(rawPort) : 5173
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`PORT must be an integer between 1 and 65535, got "${env.PORT}".`)
  }

  const rawDir = env.SABI_MODEL_DIR?.trim()

  return {
    port,
    modelDir: rawDir ? path.resolve(rawDir) : path.join(process.cwd(), 'server', '.models'),
    production: env.NODE_ENV === 'production',
  }
}

