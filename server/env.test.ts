import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { readConfig } from './env.ts'

describe('readConfig', () => {
  it('defaults to port 5173 and a model dir under server/', () => {
    const cfg = readConfig({})
    expect(cfg.port).toBe(5173)
    expect(cfg.modelDir).toBe(path.join(process.cwd(), 'server', '.models'))
    expect(cfg.production).toBe(false)
  })

  it('reads PORT from the environment', () => {
    expect(readConfig({ PORT: '8080' }).port).toBe(8080)
  })

  it('rejects a non-numeric PORT', () => {
    expect(() => readConfig({ PORT: 'eighty' })).toThrow(/PORT/)
  })

  it('rejects an out-of-range PORT', () => {
    expect(() => readConfig({ PORT: '70000' })).toThrow(/PORT/)
  })

  it('accepts an absolute SABI_MODEL_DIR override', () => {
    expect(readConfig({ SABI_MODEL_DIR: '/tmp/models' }).modelDir).toBe('/tmp/models')
  })

  it('resolves a relative SABI_MODEL_DIR against the working directory', () => {
    expect(readConfig({ SABI_MODEL_DIR: 'cache' }).modelDir).toBe(path.resolve('cache'))
  })

  it('sets production only for NODE_ENV=production', () => {
    expect(readConfig({ NODE_ENV: 'production' }).production).toBe(true)
    expect(readConfig({ NODE_ENV: 'development' }).production).toBe(false)
  })

  it('succeeds with an empty environment — a missing .env must not crash boot', () => {
    expect(() => readConfig({})).not.toThrow()
  })
})

