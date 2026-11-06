import nodemailer from 'nodemailer'
import type { CollaborationEmailType } from '@prisma/client'
import { env } from '../config/env.js'
import type { CollaborationEmailPayload } from '../modules/collaboration/collaboration.outbox.js'

export function isEmailDeliveryConfigured() {
  return Boolean(env.smtpHost && env.smtpUser && env.smtpPassword)
}

type WithdrawalEmail = {
  agentName: string
  amount: bigint
  operator: string
  phoneNumber: string
  status: 'APPROUVE' | 'PAYE'
  paymentReference: string | null
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character]!)
}

export async function sendWithdrawalStatusEmail(email: string, withdrawal: WithdrawalEmail) {
  const transporter = nodemailer.createTransport({
    host: env.smtpHost,
    port: env.smtpPort,
    secure: env.smtpSecure,
    auth: { user: env.smtpUser, pass: env.smtpPassword },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  })
  const operatorBrand: Record<string, { mark: string; background: string; foreground: string }> = {
    MVola: { mark: 'M', background: '#ffcf00', foreground: '#231f20' },
    'Orange Money': { mark: 'OM', background: '#ff7900', foreground: '#ffffff' },
    'Airtel Money': { mark: 'A', background: '#e31b3d', foreground: '#ffffff' },
  }
  const brand = operatorBrand[withdrawal.operator]
  if (!brand) throw new Error('Unsupported withdrawal payment operator.')

  const amount = `${new Intl.NumberFormat('fr-FR').format(Number(withdrawal.amount))} Ar`
  const agentName = withdrawal.agentName.trim() || 'Agent'
  const isPaid = withdrawal.status === 'PAYE'
  const subject = isPaid
    ? 'Votre retrait a été payé - Ty sy Nday'
    : 'Votre demande de retrait est approuvée - Ty sy Nday'
  const statusMessage = isPaid
    ? `Votre retrait de ${amount} via ${withdrawal.operator} a bien été payé.`
    : `Votre demande de retrait de ${amount} via ${withdrawal.operator} est approuvée et le versement est en cours de traitement. Nous vous confirmerons le paiement une fois celui-ci effectué.`
  const encouragement = isPaid
    ? 'Merci pour votre confiance. Continuez sur cette belle lancée : votre détermination et vos efforts vous rapprochent de vos objectifs.'
    : 'Bravo pour votre progression ! Chaque étape compte. Merci pour votre engagement et votre confiance; nous vous tiendrons informé de la suite.'
  const referenceLine = isPaid && withdrawal.paymentReference
    ? `\nRéférence de paiement : ${withdrawal.paymentReference}`
    : ''
  const escaped = {
    agentName: escapeHtml(agentName),
    amount: escapeHtml(amount),
    operator: escapeHtml(withdrawal.operator),
    phoneNumber: escapeHtml(withdrawal.phoneNumber),
    reference: escapeHtml(withdrawal.paymentReference ?? ''),
    statusMessage: escapeHtml(statusMessage),
    encouragement: escapeHtml(encouragement),
  }
  const paymentMark = `<span style="display:inline-block;width:38px;height:38px;line-height:38px;text-align:center;border-radius:10px;background:${brand.background};color:${brand.foreground};font-size:18px;font-weight:800;vertical-align:middle">${brand.mark}</span>`

  await transporter.sendMail({
    from: env.smtpFrom || `Ty sy Nday Business <${env.smtpUser}>`,
    to: email,
    subject,
    text: `Bonjour ${agentName},\n\n${statusMessage}\nOpérateur : ${withdrawal.operator}\nNuméro destinataire : ${withdrawal.phoneNumber}${referenceLine}\n\n${encouragement}\n\nL’équipe Ty sy Nday`,
    html: `<div style="font-family:Arial,sans-serif;max-width:580px;margin:auto;padding:28px;color:#241a3a"><div style="text-align:center;margin-bottom:24px">${paymentMark}<strong style="margin-left:10px;font-size:18px;vertical-align:middle;color:${brand.foreground === '#ffffff' ? brand.background : '#241a3a'}">${escaped.operator}</strong></div><h2 style="color:#5630a8">${isPaid ? 'Paiement de votre retrait confirmé' : 'Votre retrait est approuvé'}</h2><p>Bonjour ${escaped.agentName},</p><p>${escaped.statusMessage}</p><table style="border-collapse:collapse;width:100%;margin:20px 0"><tr><td style="padding:9px;border-bottom:1px solid #eee">Montant</td><td style="padding:9px;border-bottom:1px solid #eee"><strong>${escaped.amount}</strong></td></tr><tr><td style="padding:9px;border-bottom:1px solid #eee">Opérateur</td><td style="padding:9px;border-bottom:1px solid #eee">${paymentMark} <strong style="margin-left:6px">${escaped.operator}</strong></td></tr><tr><td style="padding:9px;border-bottom:1px solid #eee">Numéro destinataire</td><td style="padding:9px;border-bottom:1px solid #eee">${escaped.phoneNumber}</td></tr>${isPaid ? `<tr><td style="padding:9px;border-bottom:1px solid #eee">Référence</td><td style="padding:9px;border-bottom:1px solid #eee">${escaped.reference}</td></tr>` : ''}</table><p style="padding:16px;border-radius:10px;background:#f4efff;color:#5630a8;font-weight:600">${escaped.encouragement}</p><p style="margin-top:24px">L’équipe Ty sy Nday</p></div>`,
  })
}

export async function sendAgentRegistrationCode(email: string, firstName: string, code: string) {
  const transporter = nodemailer.createTransport({
    host: env.smtpHost,
    port: env.smtpPort,
    secure: env.smtpSecure,
    auth: { user: env.smtpUser, pass: env.smtpPassword },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  })

  await transporter.sendMail({
    from: env.smtpFrom || `Ty sy Nday Business <${env.smtpUser}>`,
    to: email,
    subject: 'Votre code de vérification - Ty sy Nday Business',
    text: `Bonjour ${firstName},\n\nVotre code de vérification est : ${code}\nIl expire dans 10 minutes. Si vous n’êtes pas à l’origine de cette demande, ignorez cet email.\n\nTy sy Nday Business`,
    html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;padding:28px;color:#241a3a"><p>Bonjour ${escapeHtml(firstName)},</p><p>Utilisez ce code pour confirmer votre adresse email et envoyer votre candidature agent :</p><p style="font-size:32px;font-weight:700;letter-spacing:8px;color:#5630a8">${code}</p><p>Ce code expire dans 10 minutes. Si vous n’êtes pas à l’origine de cette demande, ignorez cet email.</p><p>Ty sy Nday Business</p></div>`,
  })
}

export async function sendAgentApprovalEmail(email: string, fullName: string, activationUrl?: string) {
  const transporter = nodemailer.createTransport({
    host: env.smtpHost,
    port: env.smtpPort,
    secure: env.smtpSecure,
    auth: { user: env.smtpUser, pass: env.smtpPassword },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  })
  const greetingName = escapeHtml(fullName)
  const text = activationUrl
    ? `Bonjour ${fullName},\n\nBonne nouvelle : votre candidature pour rejoindre Ty sy Nday Business a été acceptée.\n\nIdentifiant de connexion : ${email}\nPour définir votre mot de passe et activer votre compte, ouvrez ce lien sécurisé (valable 24 heures) :\n${activationUrl}\n\nNe partagez pas ce lien. Si vous n’êtes pas à l’origine de cette demande, contactez l’administration.\n\nTy sy Nday Business`
    : `Bonjour ${fullName},\n\nBonne nouvelle : votre candidature pour rejoindre Ty sy Nday Business a été acceptée.\n\nIdentifiant de connexion : ${email}\nVotre compte est prêt. Connectez-vous avec votre méthode habituelle à l’adresse ${env.agentAppUrl}.\n\nTy sy Nday Business`
  const html = activationUrl
    ? `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;padding:28px;color:#241a3a"><h2>Votre candidature est acceptée</h2><p>Bonjour ${greetingName},</p><p>Bonne nouvelle : votre candidature pour rejoindre Ty sy Nday Business a été acceptée.</p><p><strong>Identifiant de connexion :</strong> ${escapeHtml(email)}</p><p>Pour définir votre mot de passe et activer votre compte, utilisez le bouton ci-dessous. Ce lien sécurisé expire dans 24 heures.</p><p><a href="${escapeHtml(activationUrl)}" style="display:inline-block;padding:14px 22px;border-radius:8px;background:#5630a8;color:#fff;text-decoration:none;font-weight:bold">Activer mon compte</a></p><p>Ne partagez pas ce lien. Si vous n’êtes pas à l’origine de cette demande, contactez l’administration.</p><p>Ty sy Nday Business</p></div>`
    : `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;padding:28px;color:#241a3a"><h2>Votre candidature est acceptée</h2><p>Bonjour ${greetingName},</p><p>Bonne nouvelle : votre candidature pour rejoindre Ty sy Nday Business a été acceptée.</p><p><strong>Identifiant de connexion :</strong> ${escapeHtml(email)}</p><p>Votre compte est prêt. Connectez-vous avec votre méthode habituelle : <a href="${escapeHtml(env.agentAppUrl)}">${escapeHtml(env.agentAppUrl)}</a>.</p><p>Ty sy Nday Business</p></div>`

  await transporter.sendMail({
    from: env.smtpFrom || `Ty sy Nday Business <${env.smtpUser}>`,
    to: email,
    subject: 'Votre candidature agent est acceptée - Ty sy Nday Business',
    text,
    html,
  })
}

export async function sendBadgeSubscriptionApprovalEmail(
  email: string,
  fullName: string,
  payment: { amount: number; transactionRef: string; durationDays: number; startsAt: Date; expiresAt: Date },
) {
  const transporter = nodemailer.createTransport({
    host: env.smtpHost,
    port: env.smtpPort,
    secure: env.smtpSecure,
    auth: { user: env.smtpUser, pass: env.smtpPassword },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  })
  const dateOptions: Intl.DateTimeFormatOptions = { dateStyle: 'long', timeZone: 'Indian/Antananarivo' }
  const amount = `${new Intl.NumberFormat('fr-FR').format(payment.amount)} Ar`
  const startsAt = payment.startsAt.toLocaleDateString('fr-FR', dateOptions)
  const expiresAt = payment.expiresAt.toLocaleDateString('fr-FR', dateOptions)
  const text = `Bonjour ${fullName},\n\nNous vous confirmons l’activation de votre badge abonné Ty sy Nday.\n\nDétail du paiement validé :\n- Montant : ${amount}\n- Référence de transaction : ${payment.transactionRef}\n- Durée : ${payment.durationDays} jours\n- Badge actif du ${startsAt} au ${expiresAt}\n\nMerci pour votre confiance et votre engagement. Toute l’équipe de Ty sy Nday vous remercie et vous souhaite une excellente expérience sur la plateforme.\n\nL’équipe Ty sy Nday`
  const html = `<div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;padding:28px;color:#241a3a"><h2 style="color:#5630a8">Votre badge abonné est activé !</h2><p>Bonjour ${escapeHtml(fullName)},</p><p>Nous vous confirmons l’activation de votre badge abonné Ty sy Nday. Votre paiement a été vérifié et validé.</p><h3>Détail du paiement</h3><table style="border-collapse:collapse;width:100%"><tr><td style="padding:8px;border-bottom:1px solid #eee">Montant</td><td style="padding:8px;border-bottom:1px solid #eee"><strong>${escapeHtml(amount)}</strong></td></tr><tr><td style="padding:8px;border-bottom:1px solid #eee">Référence de transaction</td><td style="padding:8px;border-bottom:1px solid #eee">${escapeHtml(payment.transactionRef)}</td></tr><tr><td style="padding:8px;border-bottom:1px solid #eee">Durée</td><td style="padding:8px;border-bottom:1px solid #eee">${payment.durationDays} jours</td></tr><tr><td style="padding:8px;border-bottom:1px solid #eee">Période de validité</td><td style="padding:8px;border-bottom:1px solid #eee">Du ${escapeHtml(startsAt)} au ${escapeHtml(expiresAt)}</td></tr></table><p>Merci pour votre confiance et votre engagement. Toute l’équipe de Ty sy Nday vous remercie et vous souhaite une excellente expérience sur la plateforme.</p><p style="margin-top:24px">L’équipe Ty sy Nday</p></div>`

  await transporter.sendMail({
    from: env.smtpFrom || `Ty sy Nday Business <${env.smtpUser}>`,
    to: email,
    subject: 'Votre badge abonné Ty sy Nday est activé',
    text,
    html,
  })
}

export async function sendBadgeSubscriptionPendingEmail(
  email: string,
  fullName: string,
  payment: { amount: number; transactionRef: string; durationDays: number },
) {
  const transporter = nodemailer.createTransport({
    host: env.smtpHost,
    port: env.smtpPort,
    secure: env.smtpSecure,
    auth: { user: env.smtpUser, pass: env.smtpPassword },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  })
  const amount = `${new Intl.NumberFormat('fr-FR').format(payment.amount)} Ar`
  const text = `Bonjour ${fullName},\n\nNous avons bien reçu votre demande de badge abonné Ty sy Nday. Elle est en attente de vérification par notre équipe. Vous recevrez un nouvel email dès qu’une décision sera prise.\n\nDétail transmis :\n- Montant : ${amount}\n- Référence de transaction : ${payment.transactionRef}\n- Durée demandée : ${payment.durationDays} jours\n\nMerci pour votre confiance.\n\nL’équipe Ty sy Nday`
  const html = `<div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;padding:28px;color:#241a3a"><h2 style="color:#5630a8">Votre demande de badge a bien été reçue</h2><p>Bonjour ${escapeHtml(fullName)},</p><p>Nous avons bien reçu votre demande de badge abonné Ty sy Nday. Elle est en attente de vérification par notre équipe. Vous recevrez un nouvel email dès qu’une décision sera prise.</p><h3>Détail transmis</h3><p>Montant : <strong>${escapeHtml(amount)}</strong><br>Référence de transaction : <strong>${escapeHtml(payment.transactionRef)}</strong><br>Durée demandée : ${payment.durationDays} jours</p><p>Merci pour votre confiance.</p><p>L’équipe Ty sy Nday</p></div>`

  await transporter.sendMail({
    from: env.smtpFrom || `Ty sy Nday Business <${env.smtpUser}>`,
    to: email,
    subject: 'Demande de badge abonné reçue - Ty sy Nday',
    text,
    html,
  })
}

export async function sendBadgeSubscriptionRejectionEmail(
  email: string,
  fullName: string,
  payment: { amount: number; transactionRef: string; reason: string },
) {
  const transporter = nodemailer.createTransport({
    host: env.smtpHost,
    port: env.smtpPort,
    secure: env.smtpSecure,
    auth: { user: env.smtpUser, pass: env.smtpPassword },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  })
  const amount = `${new Intl.NumberFormat('fr-FR').format(payment.amount)} Ar`
  const text = `Bonjour ${fullName},\n\nAprès vérification, votre demande de badge abonné Ty sy Nday n’a pas pu être validée.\n\nMotif : ${payment.reason}\n\nDétail de votre demande :\n- Montant déclaré : ${amount}\n- Référence de transaction : ${payment.transactionRef}\n\nPour toute question ou pour transmettre un justificatif corrigé, veuillez contacter l’administration depuis la plateforme.\n\nL’équipe Ty sy Nday`
  const html = `<div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;padding:28px;color:#241a3a"><h2>Décision concernant votre demande de badge</h2><p>Bonjour ${escapeHtml(fullName)},</p><p>Après vérification, votre demande de badge abonné Ty sy Nday n’a pas pu être validée.</p><p><strong>Motif :</strong> ${escapeHtml(payment.reason)}</p><h3>Détail de votre demande</h3><p>Montant déclaré : <strong>${escapeHtml(amount)}</strong><br>Référence de transaction : <strong>${escapeHtml(payment.transactionRef)}</strong></p><p>Pour toute question ou pour transmettre un justificatif corrigé, veuillez contacter l’administration depuis la plateforme.</p><p>L’équipe Ty sy Nday</p></div>`

  await transporter.sendMail({
    from: env.smtpFrom || `Ty sy Nday Business <${env.smtpUser}>`,
    to: email,
    subject: 'Mise à jour de votre demande de badge - Ty sy Nday',
    text,
    html,
  })
}

export async function sendNewProspectEmail(email: string, fullName: string, companyName: string) {
  const transporter = nodemailer.createTransport({
    host: env.smtpHost,
    port: env.smtpPort,
    secure: env.smtpSecure,
    auth: { user: env.smtpUser, pass: env.smtpPassword },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  })
  const text = `Bonjour ${fullName},\n\nUn nouveau prospect vient d’être publié par l’équipe Ty sy Nday : ${companyName}.\n\nConnectez-vous à votre espace agent pour consulter les informations disponibles : ${env.agentAppUrl}\n\nL’équipe Ty sy Nday`
  const html = `<div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;padding:28px;color:#241a3a"><h2 style="color:#5630a8">Un nouveau prospect est disponible</h2><p>Bonjour ${escapeHtml(fullName)},</p><p>L’équipe Ty sy Nday vient de publier un nouveau prospect : <strong>${escapeHtml(companyName)}</strong>.</p><p>Connectez-vous à votre espace agent pour consulter les informations disponibles.</p><p><a href="${escapeHtml(env.agentAppUrl)}" style="display:inline-block;padding:12px 20px;border-radius:8px;background:#5630a8;color:#fff;text-decoration:none;font-weight:bold">Accéder à mon espace</a></p><p>L’équipe Ty sy Nday</p></div>`

  await transporter.sendMail({
    from: env.smtpFrom || `Ty sy Nday Business <${env.smtpUser}>`,
    to: email,
    subject: 'Un nouveau prospect est disponible - Ty sy Nday',
    text,
    html,
  })
}

export async function sendCollaborationEmail(
  email: string,
  type: CollaborationEmailType,
  payload: CollaborationEmailPayload,
) {
  const transporter = nodemailer.createTransport({
    host: env.smtpHost,
    port: env.smtpPort,
    secure: env.smtpSecure,
    auth: { user: env.smtpUser, pass: env.smtpPassword },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  })
  if (type === 'CLIENT_CONFIRMATION_CODE') {
    if (payload.audience !== 'client') throw new Error('Client confirmation email payload is invalid.')
    await transporter.sendMail({
      from: env.smtpFrom || `Ty sy Nday Business <${env.smtpUser}>`,
      to: email,
      subject: 'Confirmation de votre transaction - Ty sy Nday',
      text: `Bonjour,\n\nVeuillez confirmer ou contester la réalisation de votre transaction avec Ty sy Nday. Saisissez ce code à usage unique sur la page de confirmation : ${payload.confirmationUrl}\n\nCode : ${payload.code}\n\nLe code expire dans 48 heures. Si vous n’êtes pas concerné, ignorez ce message et contactez l’administration.\n\nL’équipe Ty sy Nday`,
      html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;padding:28px;color:#241a3a"><h2>Confirmation d’une transaction</h2><p>Bonjour,</p><p>Veuillez confirmer ou contester la réalisation de votre transaction avec Ty sy Nday. Utilisez le code ci-dessous sur la page de confirmation :</p><p style="font-size:30px;font-weight:700;letter-spacing:6px;color:#5630a8">${escapeHtml(payload.code)}</p><p><a href="${escapeHtml(payload.confirmationUrl)}">Ouvrir la page de confirmation</a></p><p>Ce code à usage unique expire dans 48 heures. Ce message ne contient aucune donnée personnelle des agents ni aucun montant.</p><p>L’équipe Ty sy Nday</p></div>`,
    })
    return
  }
  if (type === 'COMMISSION_PAID') {
    if (payload.audience !== 'commission') throw new Error('Commission payment email payload is invalid.')
    const roleLabel = payload.role === 'SUPPLIER' ? 'fournisseur' : 'closer'
    const modeLabel: Record<typeof payload.paymentMode, string> = {
      MVOLA: 'MVola',
      ORANGE_MONEY: 'Orange Money',
      AIRTEL_MONEY: 'Airtel Money',
      BANK_TRANSFER: 'Virement',
      CASH: 'Espèces',
    }
    const paidAt = new Date(payload.paidAt).toLocaleString('fr-FR', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'Indian/Antananarivo',
    })
    const escaped = {
      name: escapeHtml(payload.recipientName),
      saleNumber: escapeHtml(payload.saleNumber),
      amount: escapeHtml(payload.amount),
      currency: escapeHtml(payload.currency),
      mode: escapeHtml(modeLabel[payload.paymentMode]),
      reference: escapeHtml(payload.paymentReference),
      paidAt: escapeHtml(paidAt),
      role: escapeHtml(roleLabel),
    }
    await transporter.sendMail({
      from: env.smtpFrom || `Ty sy Nday Business <${env.smtpUser}>`,
      to: email,
      subject: `Reçu de paiement de commission - ${payload.saleNumber}`,
      text: `Bonjour ${payload.recipientName},\n\nVotre commission de ${roleLabel} a été payée.\nVente : ${payload.saleNumber}\nMontant : ${payload.amount} ${payload.currency}\nMode : ${modeLabel[payload.paymentMode]}\nRéférence : ${payload.paymentReference}\nDate : ${paidAt}\n\nL’équipe Ty sy Nday`,
      html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;padding:28px;color:#241a3a"><h2>Reçu de paiement de commission</h2><p>Bonjour ${escaped.name},</p><p>Votre commission de ${escaped.role} a été payée.</p><table><tr><td>Vente</td><td>${escaped.saleNumber}</td></tr><tr><td>Montant</td><td>${escaped.amount} ${escaped.currency}</td></tr><tr><td>Mode</td><td>${escaped.mode}</td></tr><tr><td>Référence</td><td>${escaped.reference}</td></tr><tr><td>Date</td><td>${escaped.paidAt}</td></tr></table><p>L’équipe Ty sy Nday</p></div>`,
    })
    return
  }
  if (payload.audience === 'client' || payload.audience === 'commission') {
    throw new Error('Client or commission email payload cannot be used for a collaboration access notification.')
  }
  const deadline = payload.deadline
    ? new Date(payload.deadline).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Indian/Antananarivo' })
    : undefined
  const copy: Record<Exclude<CollaborationEmailType, 'CLIENT_CONFIRMATION_CODE' | 'COMMISSION_PAID'>, { subject: string; text: string; html: string }> = {
    ACCESS_REQUESTED: {
      subject: 'Demande de collaboration sur un prospect',
      text: `Bonjour ${payload.recipientName},\n\n${payload.requesterName ?? 'Un agent'} demande l’accès au prospect ${payload.prospectName}.${deadline ? ` Merci de répondre avant le ${deadline}.` : ''}\n\nConsultez votre espace agent : ${payload.link}\n\nL’équipe Ty sy Nday`,
      html: `<p>Bonjour ${escapeHtml(payload.recipientName)},</p><p><strong>${escapeHtml(payload.requesterName ?? 'Un agent')}</strong> demande l’accès au prospect <strong>${escapeHtml(payload.prospectName)}</strong>.</p>${deadline ? `<p>Merci de répondre avant le ${escapeHtml(deadline)}.</p>` : ''}<p><a href="${escapeHtml(payload.link)}">Consulter mon espace agent</a></p><p>L’équipe Ty sy Nday</p>`,
    },
    ACCESS_REQUEST_REMINDER: {
      subject: 'Rappel : demande de collaboration en attente',
      text: `Bonjour ${payload.recipientName},\n\nLa demande d’accès au prospect ${payload.prospectName} est toujours en attente.${deadline ? ` Elle expire le ${deadline}.` : ''}\n\nConsultez votre espace agent : ${payload.link}\n\nL’équipe Ty sy Nday`,
      html: `<p>Bonjour ${escapeHtml(payload.recipientName)},</p><p>La demande d’accès au prospect <strong>${escapeHtml(payload.prospectName)}</strong> est toujours en attente.${deadline ? ` Elle expire le ${escapeHtml(deadline)}.` : ''}</p><p><a href="${escapeHtml(payload.link)}">Consulter mon espace agent</a></p><p>L’équipe Ty sy Nday</p>`,
    },
    ACCESS_REQUEST_EXPIRED: {
      subject: 'Demande de collaboration expirée',
      text: `Bonjour ${payload.recipientName},\n\nLa demande de collaboration concernant le prospect ${payload.prospectName} a expiré sans décision.\n\nConsultez votre espace agent : ${payload.link}\n\nL’équipe Ty sy Nday`,
      html: `<p>Bonjour ${escapeHtml(payload.recipientName)},</p><p>La demande de collaboration concernant le prospect <strong>${escapeHtml(payload.prospectName)}</strong> a expiré sans décision.</p><p><a href="${escapeHtml(payload.link)}">Consulter mon espace agent</a></p><p>L’équipe Ty sy Nday</p>`,
    },
    ACCESS_REQUEST_REJECTED: {
      subject: 'Votre demande de collaboration a été refusée',
      text: `Bonjour ${payload.recipientName},\n\nVotre demande d’accès au prospect ${payload.prospectName} n’a pas été acceptée.\n\nConsultez votre espace agent : ${payload.link}\n\nL’équipe Ty sy Nday`,
      html: `<p>Bonjour ${escapeHtml(payload.recipientName)},</p><p>Votre demande d’accès au prospect <strong>${escapeHtml(payload.prospectName)}</strong> n’a pas été acceptée.</p><p><a href="${escapeHtml(payload.link)}">Consulter mon espace agent</a></p><p>L’équipe Ty sy Nday</p>`,
    },
    ACCESS_REQUEST_NOT_SELECTED: {
      subject: 'Mise à jour de votre demande de collaboration',
      text: `Bonjour ${payload.recipientName},\n\nUn autre agent a été sélectionné pour collaborer sur le prospect ${payload.prospectName}.\n\nConsultez votre espace agent : ${payload.link}\n\nL’équipe Ty sy Nday`,
      html: `<p>Bonjour ${escapeHtml(payload.recipientName)},</p><p>Un autre agent a été sélectionné pour collaborer sur le prospect <strong>${escapeHtml(payload.prospectName)}</strong>.</p><p><a href="${escapeHtml(payload.link)}">Consulter mon espace agent</a></p><p>L’équipe Ty sy Nday</p>`,
    },
    ACCESS_GRANTED: {
      subject: 'Votre accès au prospect est activé',
      text: `Bonjour ${payload.recipientName},\n\nVotre demande d’accès au prospect ${payload.prospectName} a été acceptée.${deadline ? ` Votre accès est valide jusqu’au ${deadline}.` : ''}\n\nConsultez votre espace agent : ${payload.link}\n\nL’équipe Ty sy Nday`,
      html: `<p>Bonjour ${escapeHtml(payload.recipientName)},</p><p>Votre demande d’accès au prospect <strong>${escapeHtml(payload.prospectName)}</strong> a été acceptée.${deadline ? ` Votre accès est valide jusqu’au ${escapeHtml(deadline)}.` : ''}</p><p><a href="${escapeHtml(payload.link)}">Consulter mon espace agent</a></p><p>L’équipe Ty sy Nday</p>`,
    },
    ACCESS_EXPIRED: {
      subject: payload.audience === 'supplier' ? 'Fin d’accès d’un closer à votre prospect' : 'Votre accès au prospect a expiré',
      text: payload.audience === 'supplier'
        ? `Bonjour ${payload.recipientName},\n\nLa période d’accès de ${payload.requesterName ?? 'l’agent sélectionné'} au prospect ${payload.prospectName} est terminée.\n\nConsultez votre espace agent : ${payload.link}\n\nL’équipe Ty sy Nday`
        : `Bonjour ${payload.recipientName},\n\nVotre période d’accès au prospect ${payload.prospectName} est terminée.\n\nConsultez votre espace agent : ${payload.link}\n\nL’équipe Ty sy Nday`,
      html: payload.audience === 'supplier'
        ? `<p>Bonjour ${escapeHtml(payload.recipientName)},</p><p>La période d’accès de <strong>${escapeHtml(payload.requesterName ?? 'l’agent sélectionné')}</strong> au prospect <strong>${escapeHtml(payload.prospectName)}</strong> est terminée.</p><p><a href="${escapeHtml(payload.link)}">Consulter mon espace agent</a></p><p>L’équipe Ty sy Nday</p>`
        : `<p>Bonjour ${escapeHtml(payload.recipientName)},</p><p>Votre période d’accès au prospect <strong>${escapeHtml(payload.prospectName)}</strong> est terminée.</p><p><a href="${escapeHtml(payload.link)}">Consulter mon espace agent</a></p><p>L’équipe Ty sy Nday</p>`,
    },
  }
  const message = copy[type]
  await transporter.sendMail({
    from: env.smtpFrom || `Ty sy Nday Business <${env.smtpUser}>`,
    to: email,
    subject: message.subject,
    text: message.text,
    html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;padding:28px;color:#241a3a">${message.html}</div>`,
  })
}
