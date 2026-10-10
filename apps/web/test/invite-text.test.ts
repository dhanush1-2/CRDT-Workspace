import { describe, it, expect } from 'vitest'
import { describeInvite } from '../src/lib/invite-text.js'

const base = { inviterName: 'Ada', documentTitle: 'Launch plan', workspaceName: 'Acme' }

describe('describeInvite', () => {
  it('names the inviter, the role as a verb, the document and its workspace', () => {
    expect(describeInvite({ ...base, role: 'editor' })).toBe('Ada invited you to edit Launch plan in Acme.')
  })

  it('says view and own for the other two roles', () => {
    expect(describeInvite({ ...base, role: 'viewer' })).toBe('Ada invited you to view Launch plan in Acme.')
    expect(describeInvite({ ...base, role: 'owner' })).toBe('Ada invited you to own Launch plan in Acme.')
  })

  it('names the workspace once when the invitation names no document', () => {
    expect(describeInvite({ ...base, documentTitle: null, role: 'editor' })).toBe(
      'Ada invited you to edit Acme.',
    )
  })

  it('says Someone when the inviter has since deleted their account', () => {
    expect(describeInvite({ ...base, inviterName: null, role: 'viewer' })).toBe(
      'Someone invited you to view Launch plan in Acme.',
    )
  })
})
