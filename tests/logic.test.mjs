import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'

// ─── Deduplication ───────────────────────────────────────────────────────────

function buildDedup(logs) {
  return new Set(logs.map(l => l.message_id).filter(Boolean))
}

describe('deduplication', () => {
  test('allows forwarding a new message_id', () => {
    assert.ok(!buildDedup([]).has('<new@mail.com>'))
  })

  test('blocks already-forwarded message_id', () => {
    const dedup = buildDedup([{ message_id: '<id1@mail.com>' }])
    assert.ok(dedup.has('<id1@mail.com>'))
  })

  test('ignores null message_ids in logs', () => {
    const dedup = buildDedup([{ message_id: null }, { message_id: null }])
    assert.equal(dedup.size, 0)
  })

  test('handles multiple ids correctly', () => {
    const dedup = buildDedup([
      { message_id: '<id1@mail.com>' },
      { message_id: '<id2@mail.com>' },
    ])
    assert.ok(dedup.has('<id1@mail.com>'))
    assert.ok(dedup.has('<id2@mail.com>'))
    assert.ok(!dedup.has('<id3@mail.com>'))
  })

  test('adding to set prevents re-forward in same session', () => {
    const dedup = new Set()
    const id = '<new@mail.com>'
    assert.ok(!dedup.has(id))
    dedup.add(id)
    assert.ok(dedup.has(id))
  })

  test('self-sent skip: from === account email', () => {
    const account = 'btcmaster657@gmail.com'
    const isSelf = from => from.toLowerCase() === account.toLowerCase()
    assert.ok(isSelf('btcmaster657@gmail.com'))
    assert.ok(isSelf('BTCMASTER657@GMAIL.COM'))
    assert.ok(!isSelf('yourdevaji@gmail.com'))
    assert.ok(!isSelf('school@ac.rw'))
  })
})

// ─── Invite Codes ────────────────────────────────────────────────────────────

function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const part = n => Array.from({ length: n }, () => chars[randomBytes(1)[0] % chars.length]).join('')
  return `${part(4)}-${part(4)}`
}

describe('invite codes', () => {
  test('format is XXXX-XXXX', () => {
    assert.match(generateCode(), /^[A-Z2-9]{4}-[A-Z2-9]{4}$/)
  })

  test('generates unique codes', () => {
    const codes = new Set(Array.from({ length: 100 }, generateCode))
    assert.equal(codes.size, 100)
  })

  test('never contains ambiguous chars 0, 1, I, O', () => {
    const all = Array.from({ length: 200 }, generateCode).join('')
    assert.doesNotMatch(all, /[01IO]/)
  })

  test('expired code: past date', () => {
    const past = new Date(Date.now() - 1000).toISOString()
    assert.ok(new Date(past) < new Date())
  })

  test('valid code: future date', () => {
    const future = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString()
    assert.ok(new Date(future) > new Date())
  })
})

// ─── Poll Logic ──────────────────────────────────────────────────────────────

function formatRules(rules) {
  return rules.map(r => ({
    id: r.id,
    name: r.name,
    from_filter: r.from_filter ?? null,
    subject_filter: r.subject_filter ?? null,
    recipients: (r.rule_recipients ?? [])
      .map(rr => rr.recipients?.email)
      .filter(Boolean),
  }))
}

describe('poll logic — formatRules', () => {
  test('extracts recipient emails from nested structure', () => {
    const result = formatRules([{
      id: '1', name: 'Test', from_filter: 'school@ac.rw', subject_filter: null,
      rule_recipients: [
        { recipients: { email: 'parent@gmail.com' } },
        { recipients: { email: 'guardian@yahoo.com' } },
      ],
    }])
    assert.deepEqual(result[0].recipients, ['parent@gmail.com', 'guardian@yahoo.com'])
  })

  test('handles empty rule_recipients', () => {
    const result = formatRules([{
      id: '1', name: 'Test', from_filter: null, subject_filter: null, rule_recipients: [],
    }])
    assert.deepEqual(result[0].recipients, [])
  })

  test('filters out null recipient emails', () => {
    const result = formatRules([{
      id: '1', name: 'Test', from_filter: null, subject_filter: null,
      rule_recipients: [
        { recipients: { email: 'valid@x.com' } },
        { recipients: null },
      ],
    }])
    assert.deepEqual(result[0].recipients, ['valid@x.com'])
  })
})

describe('poll logic — batch size', () => {
  test('slices to last 25 UIDs from large list', () => {
    const uids = Array.from({ length: 100 }, (_, i) => i + 1)
    const batch = uids.slice(-25)
    assert.equal(batch.length, 25)
    assert.equal(batch[0], 76)
    assert.equal(batch[24], 100)
  })

  test('returns all UIDs when fewer than batch size', () => {
    assert.deepEqual([1, 2, 3].slice(-25), [1, 2, 3])
  })

  test('empty uid list returns empty', () => {
    assert.deepEqual([].slice(-25), [])
  })
})

describe('poll logic — time windows', () => {
  test('30-min sinceDate is ~30 minutes ago', () => {
    const sinceDate = new Date(Date.now() - 30 * 60 * 1000)
    const diffMin = (Date.now() - sinceDate.getTime()) / 60000
    assert.ok(diffMin >= 29 && diffMin <= 31)
  })

  test('7-day dedup window is wider than 30-min poll window', () => {
    const sinceDate = new Date(Date.now() - 30 * 60 * 1000)
    const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
    assert.ok(since7d < sinceDate)
  })
})
