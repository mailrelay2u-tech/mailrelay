import { describe, it, expect } from 'vitest'

interface Rule {
  id: string
  name: string
  from_filter: string | null
  subject_filter: string | null
  recipients: string[]
}

// Pure rule matching logic extracted for testing
function matchesRule(rule: Rule, from: string, subject: string): boolean {
  const fromMatch = !rule.from_filter ||
    from.toLowerCase().includes(rule.from_filter.toLowerCase())
  const subjectMatch = !rule.subject_filter ||
    subject.toLowerCase().includes(rule.subject_filter.toLowerCase())
  return fromMatch && subjectMatch && rule.recipients.length > 0
}

const baseRule: Rule = {
  id: '1',
  name: 'Test Rule',
  from_filter: null,
  subject_filter: null,
  recipients: ['recipient@example.com'],
}

describe('rule matching', () => {
  describe('from_filter', () => {
    it('matches exact sender email', () => {
      const rule = { ...baseRule, from_filter: 'school@ac.rw' }
      expect(matchesRule(rule, 'school@ac.rw', 'Results')).toBe(true)
    })

    it('matches partial sender domain', () => {
      const rule = { ...baseRule, from_filter: 'ac.rw' }
      expect(matchesRule(rule, 'admin@ac.rw', 'Hello')).toBe(true)
    })

    it('is case-insensitive', () => {
      const rule = { ...baseRule, from_filter: 'SCHOOL@AC.RW' }
      expect(matchesRule(rule, 'school@ac.rw', 'Results')).toBe(true)
    })

    it('does not match different sender', () => {
      const rule = { ...baseRule, from_filter: 'school@ac.rw' }
      expect(matchesRule(rule, 'other@gmail.com', 'Results')).toBe(false)
    })

    it('null from_filter matches any sender', () => {
      const rule = { ...baseRule, from_filter: null }
      expect(matchesRule(rule, 'anyone@anywhere.com', 'Hello')).toBe(true)
    })
  })

  describe('subject_filter', () => {
    it('matches subject containing keyword', () => {
      const rule = { ...baseRule, subject_filter: 'result' }
      expect(matchesRule(rule, 'anyone@x.com', 'Student Result Q2')).toBe(true)
    })

    it('is case-insensitive', () => {
      const rule = { ...baseRule, subject_filter: 'RESULT' }
      expect(matchesRule(rule, 'anyone@x.com', 'student result q2')).toBe(true)
    })

    it('does not match when keyword absent', () => {
      const rule = { ...baseRule, subject_filter: 'result' }
      expect(matchesRule(rule, 'anyone@x.com', 'Hello World')).toBe(false)
    })

    it('null subject_filter matches any subject', () => {
      const rule = { ...baseRule, subject_filter: null }
      expect(matchesRule(rule, 'anyone@x.com', 'Anything at all')).toBe(true)
    })
  })

  describe('combined filters', () => {
    it('both filters must match', () => {
      const rule = { ...baseRule, from_filter: 'school@ac.rw', subject_filter: 'result' }
      expect(matchesRule(rule, 'school@ac.rw', 'Student Result')).toBe(true)
      expect(matchesRule(rule, 'school@ac.rw', 'Newsletter')).toBe(false)
      expect(matchesRule(rule, 'other@x.com', 'Student Result')).toBe(false)
    })
  })

  describe('recipients guard', () => {
    it('does not match if no recipients assigned', () => {
      const rule = { ...baseRule, recipients: [] }
      expect(matchesRule(rule, 'anyone@x.com', 'Hello')).toBe(false)
    })

    it('matches with multiple recipients', () => {
      const rule = { ...baseRule, recipients: ['a@x.com', 'b@x.com'] }
      expect(matchesRule(rule, 'anyone@x.com', 'Hello')).toBe(true)
    })
  })
})
