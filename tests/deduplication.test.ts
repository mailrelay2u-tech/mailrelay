import { describe, it, expect } from 'vitest'

// Dedup logic as used in poll-gmail route
function buildAlreadyForwarded(logs: { message_id: string | null }[]): Set<string> {
  return new Set(logs.map(l => l.message_id).filter(Boolean) as string[])
}

function shouldForward(messageId: string, alreadyForwarded: Set<string>): boolean {
  return !alreadyForwarded.has(messageId)
}

describe('deduplication', () => {
  it('allows forwarding a new message_id', () => {
    const dedup = buildAlreadyForwarded([])
    expect(shouldForward('<new@mail.gmail.com>', dedup)).toBe(true)
  })

  it('blocks forwarding an already-forwarded message_id', () => {
    const dedup = buildAlreadyForwarded([
      { message_id: '<CALgQAJk22b7@mail.gmail.com>' },
    ])
    expect(shouldForward('<CALgQAJk22b7@mail.gmail.com>', dedup)).toBe(false)
  })

  it('ignores null message_ids in logs', () => {
    const dedup = buildAlreadyForwarded([
      { message_id: null },
      { message_id: null },
    ])
    expect(dedup.size).toBe(0)
    expect(shouldForward('<anything@mail.com>', dedup)).toBe(true)
  })

  it('handles multiple already-forwarded ids', () => {
    const dedup = buildAlreadyForwarded([
      { message_id: '<id1@mail.com>' },
      { message_id: '<id2@mail.com>' },
      { message_id: '<id3@mail.com>' },
    ])
    expect(shouldForward('<id1@mail.com>', dedup)).toBe(false)
    expect(shouldForward('<id2@mail.com>', dedup)).toBe(false)
    expect(shouldForward('<id4@mail.com>', dedup)).toBe(true)
  })

  it('adds new message_id to set after forwarding', () => {
    const dedup = new Set<string>()
    const msgId = '<new@mail.gmail.com>'
    expect(shouldForward(msgId, dedup)).toBe(true)
    dedup.add(msgId)
    // Same message in same session — blocked
    expect(shouldForward(msgId, dedup)).toBe(false)
  })

  it('self-sent emails are skipped (from === account email)', () => {
    const accountEmail = 'btcmaster657@gmail.com'
    const fromSelf = (from: string) => from.toLowerCase() === accountEmail.toLowerCase()

    expect(fromSelf('btcmaster657@gmail.com')).toBe(true)   // skip
    expect(fromSelf('BTCMASTER657@GMAIL.COM')).toBe(true)   // skip (case-insensitive)
    expect(fromSelf('yourdevaji@gmail.com')).toBe(false)    // forward
    expect(fromSelf('school@ac.rw')).toBe(false)            // forward
  })
})
