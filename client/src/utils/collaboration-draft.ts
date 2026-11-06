import type { CollaborationClosingDraft, CollaborationClosingReport } from '../api/client'

export type CollaborationDraftFormValues = {
  saleAmount: string
  saleDate: string
  details: string
}

export function collaborationDraftFormValues(
  report: Pick<CollaborationClosingReport, 'saleAmount' | 'saleDate' | 'details'> | null,
): CollaborationDraftFormValues {
  return {
    saleAmount: report?.saleAmount ?? '',
    saleDate: report?.saleDate?.slice(0, 10) ?? '',
    details: report?.details ?? '',
  }
}

export function buildCollaborationClosingDraft(
  values: CollaborationDraftFormValues,
  saved: CollaborationDraftFormValues,
): CollaborationClosingDraft {
  const draft: CollaborationClosingDraft = {}
  if (values.saleAmount !== saved.saleAmount) {
    if (!values.saleAmount.trim()) {
      if (saved.saleAmount) draft.saleAmount = null
    } else {
      const amount = Number(values.saleAmount)
      if (Number.isSafeInteger(amount) && amount > 0) draft.saleAmount = amount
    }
  }
  if (values.saleDate !== saved.saleDate) {
    if (values.saleDate) draft.saleDate = `${values.saleDate}T00:00:00.000Z`
    else if (saved.saleDate) draft.saleDate = null
  }
  const details = values.details.trim()
  const savedDetails = saved.details.trim()
  if (details !== savedDetails) draft.details = details || null
  return draft
}

export function applyCollaborationClosingDraft(
  saved: CollaborationDraftFormValues,
  draft: CollaborationClosingDraft,
): CollaborationDraftFormValues {
  return {
    saleAmount: draft.saleAmount === undefined
      ? saved.saleAmount
      : draft.saleAmount === null ? '' : String(draft.saleAmount),
    saleDate: draft.saleDate === undefined
      ? saved.saleDate
      : draft.saleDate === null ? '' : draft.saleDate.slice(0, 10),
    details: draft.details === undefined
      ? saved.details
      : draft.details === null ? '' : draft.details,
  }
}
