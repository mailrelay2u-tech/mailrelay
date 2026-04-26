import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

// Same logic as lib/gmail.ts rule matching
function matchesRule(rule, from, subject) {
  const fromMatch = !rule.from_filter ||
    from.toLowerCase().includes(rule.from_filter.toLowerCase())
  const subjectMatch = !rule.subject_filter ||
    subject.toLowerCase().includes(rule.subject_filter.toLowerCase())
  return fromMatch && subjectMatch && rule.recipients.length > 0
}

const base = { id: '1', name: 'Test', from_filter: null, subject_filter: null, recipients: ['r@x.com'] }

describe('rule matching — from_filter', () => {
  test('matches exact sender', () => {
    assert.ok(matchesRule({ ...base, from_filter: 'school@ac.rw' }, 'school@ac.rw', 'Hi'))
  })

  test('matches partial domain', () => {
    assert.ok(matchesRule({ ...base, from_filter: 'ac.rw' }, 'admin@ac.rw', 'Hi'))
  })

  test('is case-insensitive', () => {
    assert.ok(matchesRule({ ...base, from_filter: 'SCHOOL@AC.RW' }, 'school@ac.rw', 'Hi'))
  })

  test('does not match different sender', () => {
    assert.equal(matchesRule({ ...base, from_filter: 'school@ac.rw' }, 'other@gmail.com', 'Hi'), false)
  })

  test('null from_filter matches any sender', () => {
    assert.ok(matchesRule({ ...base, from_filter: null }, 'anyone@anywhere.com', 'Hi'))
  })
})

describe('rule matching — subject_filter', () => {
  test('matches subject containing keyword', () => {
    assert.ok(matchesRule({ ...base, subject_filter: 'result' }, 'x@x.com', 'Student Result Q2'))
  })

  test('is case-insensitive', () => {
    assert.ok(matchesRule({ ...base, subject_filter: 'RESULT' }, 'x@x.com', 'student result q2'))
  })

  test('does not match when keyword absent', () => {
    assert.equal(matchesRule({ ...base, subject_filter: 'result' }, 'x@x.com', 'Hello World'), false)
  })

  test('null subject_filter matches any subject', () => {
    assert.ok(matchesRule({ ...base, subject_filter: null }, 'x@x.com', 'Anything'))
  })
})

describe('rule matching — combined filters', () => {
  test('both filters must match', () => {
    const rule = { ...base, from_filter: 'school@ac.rw', subject_filter: 'result' }
    assert.ok(matchesRule(rule, 'school@ac.rw', 'Student Result'))
    assert.equal(matchesRule(rule, 'school@ac.rw', 'Newsletter'), false)
    assert.equal(matchesRule(rule, 'other@x.com', 'Student Result'), false)
  })
})

describe('rule matching — recipients guard', () => {
  test('no recipients = no forward', () => {
    assert.equal(matchesRule({ ...base, recipients: [] }, 'x@x.com', 'Hi'), false)
  })

  test('multiple recipients still matches', () => {
    assert.ok(matchesRule({ ...base, recipients: ['a@x.com', 'b@x.com'] }, 'x@x.com', 'Hi'))
  })
})
