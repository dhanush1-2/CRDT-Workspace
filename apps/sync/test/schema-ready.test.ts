import { describe, it, expect, vi } from 'vitest'
import { assertSchemaReady, SchemaNotReadyError, SCHEMA_NOT_READY_MESSAGE } from '../src/schema-ready.js'

// $queryRaw is used as a tagged template, so the stub is a plain function.
const stub = (impl: () => Promise<unknown>) => ({ $queryRaw: vi.fn(impl) }) as never

describe('assertSchemaReady', () => {
  it('resolves when the probe query succeeds', async () => {
    await expect(assertSchemaReady(stub(async () => []))).resolves.toBeUndefined()
  })

  it('throws a clear error naming the missing column and the fix when the probe fails', async () => {
    const failing = stub(async () => {
      throw new Error('column "userId" does not exist')
    })
    const error = await assertSchemaReady(failing).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(SchemaNotReadyError)
    expect((error as Error).message).toContain(SCHEMA_NOT_READY_MESSAGE)
    expect((error as Error).message).toContain('column "userId" does not exist')
    expect(SCHEMA_NOT_READY_MESSAGE).toBe(
      'DocumentUpdate.userId is missing: run prisma migrate deploy before deploying this version',
    )
  })
})
