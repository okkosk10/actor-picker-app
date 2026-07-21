'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

const cases = require('./intentPlannerCases.cjs')

test('intent planner regression cases stay populated', () => {
  assert.ok(Array.isArray(cases), 'cases must be an array')
  assert.ok(cases.length >= 40, 'expected at least 40 regression cases')

  for (const entry of cases) {
    assert.equal(typeof entry.input, 'string')
    assert.ok(entry.input.trim().length > 0)
    assert.ok(entry.expected && typeof entry.expected === 'object')
    assert.ok('toolName' in entry.expected || 'needsClarification' in entry.expected)
  }
})
