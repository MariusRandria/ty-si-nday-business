import assert from 'node:assert/strict'
import test from 'node:test'
import { chooseLeastLoadedStaffId } from './collaboration.assignments.js'

test('chooses the active staff member with the lowest current workload', () => {
  assert.equal(chooseLeastLoadedStaffId([3, 1, 2], new Map([[1, 4], [2, 1], [3, 2]])), 2)
})

test('breaks equal workload ties by staff ID', () => {
  assert.equal(chooseLeastLoadedStaffId([4, 9, 2], new Map([[4, 3], [9, 3], [2, 3]])), 2)
})

test('returns no assignee when the active team is empty', () => {
  assert.equal(chooseLeastLoadedStaffId([], new Map()), null)
})
