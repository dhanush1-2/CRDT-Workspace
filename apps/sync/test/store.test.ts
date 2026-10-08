import { describe, it, expect } from 'vitest'
import { Prisma, type PrismaClient } from '@crdt/db'
import { DocumentStore } from '../src/store.js'

// The retry-without-author branch must terminate. A real database cannot exercise that:
// once every row is unattributed it cannot raise a user foreign-key violation, so the
// guard is unreachable against it. This stub always claims the user constraint failed,
// which is the only way to prove a second violation cannot recurse.
describe('DocumentStore author foreign key', () => {
  it('retries once without authors and does not loop on a repeated user violation', async () => {
    const calls: Array<Array<string | null>> = []
    const stub = {
      documentUpdate: {
        createManyAndReturn: async (args: { data: Array<{ userId: string | null }> }) => {
          calls.push(args.data.map((row) => row.userId))
          if (calls.length > 5) throw new Error('runaway retry')
          throw new Prisma.PrismaClientKnownRequestError('fk', {
            code: 'P2003',
            clientVersion: 'test',
            meta: {
              driverAdapterError: {
                cause: { constraint: { index: 'DocumentUpdate_userId_fkey' } },
              },
            },
          })
        },
      },
    } as unknown as PrismaClient

    const store = new DocumentStore(stub)
    await expect(
      store.append('doc-1', [
        { update: new Uint8Array([1]), clientId: 'c1', userId: 'gone' },
        { update: new Uint8Array([2]), clientId: 'server', userId: null },
      ]),
    ).resolves.toBeUndefined()

    expect(calls).toEqual([['gone', null], [null, null]])
  })
})
