import type { CollaborationEmailType, Prisma } from '@prisma/client'
import { encryptPii } from './report-pii.js'

export type CollaborationEmailPayload = {
  audience: 'supplier' | 'requester'
  recipientName: string
  prospectName: string
  requesterName?: string
  deadline?: string
  link: string
} | {
  audience: 'client'
  code: string
  confirmationUrl: string
} | {
  audience: 'commission'
  recipientName: string
  saleNumber: string
  role: 'SUPPLIER' | 'CLOSER'
  amount: string
  currency: string
  paymentMode: 'MVOLA' | 'ORANGE_MONEY' | 'AIRTEL_MONEY' | 'BANK_TRANSFER' | 'CASH'
  paymentReference: string
  paidAt: string
}

type StoredCollaborationEmailPayload = Exclude<CollaborationEmailPayload, { audience: 'client' }> | {
  audience: 'client'
  codeCiphertext: string
  confirmationUrlCiphertext: string
}

type EnqueueCollaborationEmailPayload = Exclude<StoredCollaborationEmailPayload, { audience: 'client' }> | {
  audience: 'client'
  codeCiphertext: string
  confirmationUrl: string
}

type EnqueueCollaborationEmailInput = {
  dealId: number
  type: CollaborationEmailType
  recipient: string
  idempotencyKey: string
  payload: EnqueueCollaborationEmailPayload
}

export async function enqueueCollaborationEmail(
  transaction: Prisma.TransactionClient,
  input: EnqueueCollaborationEmailInput,
) {
  const payload: Prisma.InputJsonObject = input.payload.audience === 'client'
    ? {
      audience: 'client',
      codeCiphertext: input.payload.codeCiphertext,
      confirmationUrlCiphertext: encryptPii(input.payload.confirmationUrl),
    }
    : input.payload.audience === 'commission'
      ? {
        audience: 'commission',
        recipientName: input.payload.recipientName,
        saleNumber: input.payload.saleNumber,
        role: input.payload.role,
        amount: input.payload.amount,
        currency: input.payload.currency,
        paymentMode: input.payload.paymentMode,
        paymentReference: input.payload.paymentReference,
        paidAt: input.payload.paidAt,
      }
      : {
      audience: input.payload.audience,
      recipientName: input.payload.recipientName,
      prospectName: input.payload.prospectName,
      link: input.payload.link,
      ...(input.payload.requesterName === undefined ? {} : { requesterName: input.payload.requesterName }),
      ...(input.payload.deadline === undefined ? {} : { deadline: input.payload.deadline }),
    }
  return transaction.collaborationEmailJob.create({
    data: {
      dealId: input.dealId,
      type: input.type,
      recipientCiphertext: encryptPii(input.recipient),
      idempotencyKey: input.idempotencyKey,
      payload,
    },
  })
}
