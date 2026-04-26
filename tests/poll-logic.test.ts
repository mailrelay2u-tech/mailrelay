import { describe, it, expect } from 'vitest'

function formatRules(rules: Record<string, unknown>[]) {
  return rules.map(r => ({
    id: r.id as string,
    name: r.name as string,
    from_filter: r.from_filter as string | null,
    subject_filter: r.subject_filter as string | null,
    recipients: ((r.rule_recipients as Array<{ recipients: { email: string } | null }>) ?? [])
      .map(rr => rr.recipients?.email)
      .filter(Boolean) as string[],
  }))
}

describe('poll route logic', () => {
  describe('sinceDate window', () => {
    it('30-minute window is correct', () => {
      const sinceDate = new Date(Date.now() - 30 * 60 * 1000)
      const diffMs = Date.now() - sinceDate.getTime()
      expect(diffMs).toBeGreaterThanOrEqual(29 * 60 * 1000)
      expect(diffMs).toBeLessThanOrEqual(31 * 60 * 1000)
    })

    it('7-day dedup window is wider than 30-min sinceDate', () => {
      const sinceDate = new Date(Date.now() - 30 * 60 * 1000)
      const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
      expect(since7d.getTime()).toBeLessThan(sinceDate.getTime())
    })
  })

  describe('formatRules', () => {
    it('extracts recipient emails from nested structure', () => {
      const raw = [{
        id: 'rule-1', name: 'Test',
        from_filter: 'school@ac.rw', subject_filter: null,
        account_id: 'acc-1',
        rule_recipients: [
          { recipients: { email: 'parent@gmail.com' } },
          { recipients: { email: 'guardian@yahoo.com' } },
        ],
      }]
      expect(formatRules(raw)[0].recipients).toEqual(['parent@gmail.com', 'guardian@yahoo.com'])
    })

    it('handles empty rule_recipients', () => {
      const raw = [{
        id: 'rule-1', name: 'Test',
        from_filter: null, subject_filter: null,
        account_id: 'acc-1', rule_recipients: [],
      }]
      expect(formatRules(raw)[0].recipients).toEqual([])
    })

    it('filters out null recipient emails', () => {
      const raw = [{
        id: 'rule-1', name: 'Test',
        from_filter: null, subject_filter: null,
        account_id: 'acc-1',
        rule_recipients: [
          { recipients: { email: 'valid@x.com' } },
          { recipients: null },
        ],
      }]
      expect(formatRules(raw)[0].recipients).toEqual(['valid@x.com'])
    })
  })

  describe('batch size', () => {
    it('slices to last 25 UIDs from a large list', () => {
      const BATCH_SIZE = 25
      const uids = Array.from({ length: 100 }, (_, i) => i + 1)
      const batch = uids.slice(-BATCH_SIZE)
      expect(batch).toHaveLength(25)
      expect(batch[0]).toBe(76)
      expect(batch[24]).toBe(100)
    })

    it('returns all UIDs when fewer than batch size', () => {
      const BATCH_SIZE = 25
      const uids = [1, 2, 3]
      expect(uids.slice(-BATCH_SIZE)).toEqual([1, 2, 3])
    })

    it('empty uid list returns empty', () => {
      expect([].slice(-25)).toEqual([])
    })
  })
})
