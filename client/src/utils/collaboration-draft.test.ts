import assert from 'node:assert/strict'
import test from 'node:test'
import {
  applyCollaborationClosingDraft,
  buildCollaborationClosingDraft,
  collaborationDraftFormValues,
} from './collaboration-draft.ts'

test('closing draft values can be entered, intentionally cleared, saved, and reloaded', () => {
  const empty = collaborationDraftFormValues(null)
  const entered = {
    saleAmount: '125000',
    saleDate: '2026-11-05',
    details: 'Vente conclue avec le prospect.',
  }
  const enteredDraft = buildCollaborationClosingDraft(entered, empty)
  assert.deepEqual(enteredDraft, {
    saleAmount: 125000,
    saleDate: '2026-11-05T00:00:00.000Z',
    details: 'Vente conclue avec le prospect.',
  })

  const saved = applyCollaborationClosingDraft(empty, enteredDraft)
  const reloaded = collaborationDraftFormValues({
    saleAmount: saved.saleAmount,
    saleDate: saved.saleDate ? `${saved.saleDate}T00:00:00.000Z` : null,
    details: saved.details || null,
  })
  assert.deepEqual(reloaded, entered)

  const cleared = { saleAmount: '', saleDate: '', details: '' }
  const clearDraft = buildCollaborationClosingDraft(cleared, reloaded)
  assert.deepEqual(clearDraft, { saleAmount: null, saleDate: null, details: null })
  const clearedSaved = applyCollaborationClosingDraft(reloaded, clearDraft)
  const clearedReload = collaborationDraftFormValues({
    saleAmount: clearedSaved.saleAmount || null,
    saleDate: clearedSaved.saleDate ? `${clearedSaved.saleDate}T00:00:00.000Z` : null,
    details: clearedSaved.details || null,
  })
  assert.deepEqual(clearedReload, cleared)
  assert.deepEqual(buildCollaborationClosingDraft(clearedReload, clearedReload), {})
})

test('untouched draft fields are omitted instead of being cleared', () => {
  const saved = {
    saleAmount: '125000',
    saleDate: '2026-11-05',
    details: 'Rapport existant',
  }
  assert.deepEqual(buildCollaborationClosingDraft({
    ...saved,
    details: 'Modification du rapport',
  }, saved), { details: 'Modification du rapport' })
})
