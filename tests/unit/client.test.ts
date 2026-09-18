import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const rpcMock = vi.hoisted(() => vi.fn())
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ rpc: rpcMock }) }))

beforeEach(() => {
  vi.stubEnv('VITE_SUPABASE_URL', 'http://127.0.0.1:54321')
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon')
  vi.useFakeTimers()
  rpcMock.mockReset()
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs() })

const skew = { data: null, error: { message: 'JWT issued at future', code: 'PGRST303' } }

describe('rpc', () => {
  it('retries a token the server read as issued in the future', async () => {
    const { rpc, CLOCK_SKEW_RETRY_MS } = await import('../../src/app/data/client')
    rpcMock.mockResolvedValueOnce(skew).mockResolvedValueOnce({ data: { ok: true }, error: null })
    const result = rpc('get_workspace', { p_workspace_id: 'w' })
    await vi.advanceTimersByTimeAsync(CLOCK_SKEW_RETRY_MS)
    await expect(result).resolves.toEqual({ ok: true })
    expect(rpcMock).toHaveBeenCalledTimes(2)
  })

  it('gives up after two retries', async () => {
    const { rpc, CLOCK_SKEW_RETRY_MS } = await import('../../src/app/data/client')
    rpcMock.mockResolvedValue(skew)
    const result = rpc('get_workspace')
    const settled = expect(result).rejects.toThrow('JWT issued at future')
    await vi.advanceTimersByTimeAsync(CLOCK_SKEW_RETRY_MS * 2)
    await settled
    expect(rpcMock).toHaveBeenCalledTimes(3)
  })

  it('does not retry other errors', async () => {
    const { rpc } = await import('../../src/app/data/client')
    rpcMock.mockResolvedValue({ data: null, error: { message: 'CONFLICT', details: 'This task changed.' } })
    await expect(rpc('save_task')).rejects.toBeTruthy()
    expect(rpcMock).toHaveBeenCalledTimes(1)
  })
})
