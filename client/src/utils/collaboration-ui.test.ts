import assert from 'node:assert/strict'
import test from 'node:test'
import { collaborationStatuses, formatAntananarivoDate, formatAr, formatCountdown } from './collaboration-ui.ts'

test('formats Ariary as French grouped amounts', () => {
  assert.equal(formatAr('50000'), '50 000 Ar')
  assert.equal(formatAr(0), '0 Ar')
})

test('formats dates in the Antananarivo timezone', () => {
  assert.equal(formatAntananarivoDate('not-a-date'), 'Date indisponible')
  assert.match(formatAntananarivoDate('2026-11-05T00:00:00.000Z'), /5 nov\. 2026/)
})

test('countdown is calculated from the server expiration timestamp', () => {
  const now = Date.parse('2026-11-05T00:00:00.000Z')
  assert.equal(formatCountdown(new Date(now + 5 * 60 * 60_000 + 12 * 60_000), now), 'Expire dans 5 h 12 min')
  assert.equal(formatCountdown(new Date(now + 20_000), now), 'Expire dans 1 min')
  assert.equal(formatCountdown(new Date(now - 1), now), 'Expirée')
})

test('every lifecycle status has a textual and semantic presentation', () => {
  assert.equal(collaborationStatuses.DECLARED.tone, 'neutral')
  assert.equal(collaborationStatuses.IN_PROGRESS.tone, 'info')
  assert.equal(collaborationStatuses.CLOSING_REPORTED.tone, 'warning')
  assert.equal(collaborationStatuses.CONTRACT_SIGNED.tone, 'success')
  assert.equal(collaborationStatuses.DISPUTED.tone, 'error')
  assert.ok(Object.values(collaborationStatuses).every(({ label, icon }) => label.length > 0 && icon.length > 0))
})
