export type TrustScoreInput = {
  concludedDeals: number
  resolvedDeals: number
  lostDisputes: number
  averageReportDelayHours: number | null
  repeatedExpirations: number
  accountAgeDays: number
}

export type TrustScoreComponents = {
  completionRate: number
  completionPoints: number
  lostDisputes: number
  disputePoints: number
  averageReportDelayHours: number | null
  reportSpeedPoints: number
  repeatedExpirations: number
  expiryPoints: number
  accountAgeDays: number
  tenurePoints: number
}

function bounded(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function calculateTrustScore(input: TrustScoreInput): { score: number; components: TrustScoreComponents } {
  if ([input.concludedDeals, input.resolvedDeals, input.lostDisputes, input.repeatedExpirations, input.accountAgeDays]
    .some((value) => !Number.isSafeInteger(value) || value < 0)
    || input.concludedDeals > input.resolvedDeals
    || (input.averageReportDelayHours !== null
      && (!Number.isFinite(input.averageReportDelayHours) || input.averageReportDelayHours < 0))) {
    throw new Error('Trust score inputs must be non-negative and internally consistent.')
  }
  const completionRate = input.resolvedDeals === 0 ? 0 : input.concludedDeals / input.resolvedDeals
  const completionPoints = 40 * completionRate
  const disputePoints = 25 * bounded(1 - input.lostDisputes / 3, 0, 1)
  const reportSpeedPoints = input.averageReportDelayHours === null
    ? 10
    : 20 * bounded(1 - input.averageReportDelayHours / (14 * 24), 0, 1)
  const expiryPoints = 10 * bounded(1 - input.repeatedExpirations / 5, 0, 1)
  const tenurePoints = 5 * bounded(input.accountAgeDays / 365, 0, 1)
  const components: TrustScoreComponents = {
    completionRate,
    completionPoints,
    lostDisputes: input.lostDisputes,
    disputePoints,
    averageReportDelayHours: input.averageReportDelayHours,
    reportSpeedPoints,
    repeatedExpirations: input.repeatedExpirations,
    expiryPoints,
    accountAgeDays: input.accountAgeDays,
    tenurePoints,
  }
  return {
    score: Math.round(bounded(completionPoints + disputePoints + reportSpeedPoints + expiryPoints + tenurePoints, 0, 100)),
    components,
  }
}
