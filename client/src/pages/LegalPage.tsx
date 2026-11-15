import './legal-pages.css'

type LegalDocument = 'privacy' | 'terms'
type LegalSection = { heading: string; paragraphs: string[]; bullets?: string[] }

const updatedAt = '15 novembre 2026'

const documents: Record<LegalDocument, { title: string; intro: string; sections: LegalSection[] }> = {
  privacy: {
    title: 'Politique de confidentialité',
    intro: 'Cette politique explique comment TY SY NDAY Business traite les données personnelles nécessaires au fonctionnement de la plateforme.',
    sections: [
      {
        heading: '1. Responsable du traitement et contact',
        paragraphs: [
          'Le responsable indiqué pour la plateforme est TY SY NDAY Business, Madagascar. Pour toute question ou demande relative à vos données, écrivez à contact@ty-sy-nday.com.',
          'Les prestataires techniques exacts et le pays d’hébergement ne sont pas précisés dans les informations disponibles à la date de cette politique. La plateforme utilise des services techniques pour l’hébergement, l’envoi d’e-mails et, si vous le choisissez, l’authentification Google. Contactez-nous pour obtenir les informations actualisées.',
        ],
      },
      {
        heading: '2. Données traitées',
        paragraphs: ['Selon les fonctionnalités que vous utilisez, la plateforme peut traiter :'],
        bullets: [
          'Vos nom, prénom, adresse e-mail, téléphone, ville, photo de profil et informations de candidature ou de compte.',
          'Les informations nécessaires aux activités d’agent, notamment rapports, prospects, coordonnées professionnelles, dossiers de collaboration et pièces justificatives que vous transmettez.',
          'Les données de commande Marketplace, l’adresse de livraison, le mode de remise, le mode de paiement et la référence de transaction communiquée pour vérification.',
          'Les montants de commissions, demandes de retrait et coordonnées de versement Mobile Money que vous choisissez d’enregistrer.',
          'Les publications, commentaires, réactions, messages et préférences de notification créés dans l’espace communautaire.',
          'Les données techniques nécessaires à l’authentification, à la sécurité et au suivi du fonctionnement du service.',
        ],
      },
      {
        heading: '3. Utilisation des données',
        paragraphs: ['Les données sont utilisées pour examiner les candidatures, créer et sécuriser les comptes, permettre les rapports et collaborations, gérer la Marketplace, vérifier les paiements, suivre les commissions et retraits, envoyer les messages de service et protéger la plateforme contre les abus.'],
      },
      {
        heading: '4. Données de prospects et de clients',
        paragraphs: ['Les agents peuvent saisir des coordonnées de prospects ou de clients dans le cadre de leurs missions. Ils doivent limiter ces informations à ce qui est nécessaire, s’assurer qu’ils sont autorisés à les communiquer et ne pas les réutiliser à des fins personnelles ou étrangères à la mission. TY SY NDAY Business traite ces informations pour le suivi des activités et des collaborations.'],
      },
      {
        heading: '5. Partage et prestataires',
        paragraphs: [
          'Les données peuvent être consultées par les administrateurs et collaborateurs autorisés lorsque cela est nécessaire à l’examen des candidatures, au suivi des activités, à la modération ou au traitement des paiements et retraits.',
          'Les contenus publiés dans les espaces communautaires peuvent être visibles par les autres utilisateurs concernés. Les messages privés sont destinés à leurs participants et peuvent être traités pour assurer la sécurité et le fonctionnement du service.',
          'Des prestataires techniques peuvent traiter les données pour l’hébergement, la base de données, l’envoi d’e-mails, les notifications ou l’authentification Google. La Marketplace ne débite pas le portefeuille de commissions : le paiement Mobile Money est réalisé directement par l’agent auprès de son opérateur; la plateforme reçoit la référence et en vérifie l’état.',
        ],
      },
      {
        heading: '6. Conservation',
        paragraphs: [
          'Les données de compte sont conservées pendant la durée d’existence du compte. Après sa fermeture ou une demande de suppression, elles sont supprimées ou archivées de manière limitée lorsqu’elles restent nécessaires à une obligation légale, au traitement d’un paiement, à la prévention d’une fraude ou à la gestion d’un litige.',
          'Les copies de sauvegarde et journaux techniques peuvent subsister pendant le temps nécessaire à la sécurité et au fonctionnement de l’infrastructure.',
        ],
      },
      {
        heading: '7. Vos demandes et vos droits',
        paragraphs: [
          'Vous pouvez demander l’accès à vos données, leur rectification ou leur suppression, et exercer les autres droits prévus par les règles applicables. Certaines données ne peuvent pas être supprimées tant qu’elles sont nécessaires à une obligation légale ou à un litige.',
          'Pour exercer vos droits ou fermer votre compte, écrivez à contact@ty-sy-nday.com depuis l’adresse associée au compte et décrivez votre demande. Une vérification d’identité peut être nécessaire.',
        ],
      },
      {
        heading: '8. Sécurité et modifications',
        paragraphs: [
          'Des mesures techniques et organisationnelles sont mises en œuvre pour limiter l’accès non autorisé et protéger les informations. Aucun service en ligne ne peut toutefois garantir une sécurité absolue.',
          'Cette politique peut évoluer avec les fonctionnalités ou les règles applicables. La date de mise à jour est indiquée en haut de page; les changements importants seront signalés dans la plateforme lorsque cela est nécessaire.',
        ],
      },
    ],
  },
  terms: {
    title: 'Conditions générales d’utilisation',
    intro: 'Les présentes conditions encadrent l’accès à TY SY NDAY Business et l’utilisation de ses espaces agent, collaboration, communauté et Marketplace.',
    sections: [
      {
        heading: '1. Acceptation et portée',
        paragraphs: [
          'En créant un compte ou en utilisant la plateforme, vous acceptez ces conditions générales d’utilisation et la politique de confidentialité. Si vous ne les acceptez pas, n’utilisez pas les services concernés.',
          'La plateforme est exploitée sous le nom TY SY NDAY Business à Madagascar. Elle s’adresse aux candidats agents, agents autorisés et personnels disposant d’un accès administrateur.',
        ],
      },
      {
        heading: '2. Candidature et compte',
        paragraphs: [
          'L’inscription agent constitue une demande d’accès et ne garantit pas l’acceptation. L’adresse e-mail doit être vérifiée et la candidature peut être examinée, acceptée ou refusée par l’administration.',
          'Vous devez fournir des informations exactes, garder vos identifiants confidentiels et signaler toute utilisation non autorisée. Un compte est personnel et ne doit pas être partagé ou utilisé pour usurper l’identité d’une autre personne.',
        ],
      },
      {
        heading: '3. Utilisation des services',
        paragraphs: ['Les outils de rapports, prospection, collaboration, messagerie et communauté doivent être utilisés uniquement dans le cadre autorisé par TY SY NDAY Business. Il est notamment interdit de :'],
        bullets: [
          'transmettre des informations fausses, trompeuses, illicites ou obtenues sans autorisation;',
          'contacter un prospect en dehors du cadre de la mission ou réutiliser ses données à des fins personnelles;',
          'publier des contenus illicites, menaçants, frauduleux, discriminatoires ou portant atteinte aux droits d’autrui;',
          'contourner les contrôles d’accès, perturber le service ou accéder aux données d’un autre utilisateur sans autorisation.',
        ],
      },
      {
        heading: '4. Contenus et données de tiers',
        paragraphs: [
          'Vous restez responsable des informations et fichiers que vous saisissez ou publiez et devez disposer des autorisations nécessaires. Les données de prospects et clients ne doivent être communiquées que dans la mesure utile à la mission.',
          'Vous autorisez TY SY NDAY Business à héberger et afficher vos contenus dans la mesure nécessaire au fonctionnement, à la sécurité et à la modération de la plateforme. Cette autorisation n’entraîne pas de transfert de propriété de vos contenus.',
        ],
      },
      {
        heading: '5. Collaborations et commissions',
        paragraphs: [
          'Les missions, rôles, critères de validation et montants applicables sont ceux communiqués pour l’opération concernée et, le cas échéant, ceux du contrat ou accord de collaboration signé. Une commission est enregistrée selon ces critères une fois les validations requises effectuées.',
          'Le portefeuille affiché dans la plateforme sert au suivi interne des commissions; il ne constitue pas un compte bancaire et n’est pas utilisé pour payer les achats Marketplace. Un agent peut demander le retrait d’un solde disponible. La demande est vérifiée et le paiement est effectué après approbation par l’administration, selon les moyens et coordonnées disponibles.',
        ],
      },
      {
        heading: '6. Commandes Marketplace et paiement',
        paragraphs: [
          'Les articles sont proposés selon leur disponibilité. Pour une livraison ou un envoi par colis, l’administration communique le montant des frais après la commande; le devis doit être envoyé dans les 24 heures. L’agent dispose ensuite de 24 heures pour payer le total indiqué.',
          'Le retrait sur place est sans frais et doit être payé dans les 24 heures suivant la commande. Le paiement se fait par Mobile Money lorsqu’un opérateur est configuré, ou en espèces uniquement lors d’un retrait sur place. L’agent transmet la référence de transaction Mobile Money et l’administration confirme le paiement après vérification.',
          'En l’absence de devis dans le délai prévu ou de paiement avant l’échéance, la commande peut être annulée et le stock réservé libéré. Les paiements Mobile Money sont effectués directement auprès de l’opérateur; ils ne sont pas prélevés sur le portefeuille de commissions.',
        ],
      },
      {
        heading: '7. Disponibilité, modération et suspension',
        paragraphs: [
          'La plateforme peut être temporairement indisponible pour maintenance ou en raison d’un incident technique. L’administration peut retirer un contenu, limiter une fonctionnalité ou suspendre un accès en cas de violation des présentes conditions, de risque pour la sécurité ou d’obligation légale.',
          'Vous pouvez demander la fermeture de votre compte en contactant contact@ty-sy-nday.com. Les obligations relatives aux opérations déjà engagées, paiements ou litiges peuvent continuer à s’appliquer après la fermeture.',
        ],
      },
      {
        heading: '8. Évolution des conditions et droit applicable',
        paragraphs: [
          'Ces conditions peuvent être mises à jour pour refléter l’évolution des services ou des règles applicables. La version en vigueur est celle affichée sur cette page, avec sa date de mise à jour.',
          'Les présentes conditions sont régies par le droit applicable à Madagascar, sous réserve des règles impératives applicables à l’utilisateur. Pour toute question, contactez contact@ty-sy-nday.com.',
        ],
      },
    ],
  },
}

export default function LegalPage({ document: documentType }: { document: LegalDocument }) {
  const content = documents[documentType]
  const otherDocument = documentType === 'privacy' ? 'terms' : 'privacy'
  const otherTitle = documents[otherDocument].title
  const otherPath = otherDocument === 'privacy' ? '/politique-de-confidentialite' : '/conditions-generales-utilisation'

  return (
    <main className="legal-page">
      <header className="legal-header">
        <a className="legal-back" href="/">Retour à la plateforme</a>
        <nav aria-label="Pages légales">
          <a href="/politique-de-confidentialite" aria-current={documentType === 'privacy' ? 'page' : undefined}>Confidentialité</a>
          <a href="/conditions-generales-utilisation" aria-current={documentType === 'terms' ? 'page' : undefined}>Conditions générales</a>
        </nav>
      </header>
      <article className="legal-document">
        <span className="legal-kicker">TY SY NDAY BUSINESS · MADAGASCAR</span>
        <h1>{content.title}</h1>
        <p className="legal-intro">{content.intro}</p>
        <p className="legal-date">Dernière mise à jour : {updatedAt}</p>
        {content.sections.map((section) => (
          <section className="legal-section" key={section.heading}>
            <h2>{section.heading}</h2>
            {section.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
            {section.bullets && <ul>{section.bullets.map((item) => <li key={item}>{item}</li>)}</ul>}
          </section>
        ))}
        <footer className="legal-footer">
          <span>Une question ?</span>
          <a href="mailto:contact@ty-sy-nday.com">contact@ty-sy-nday.com</a>
          <a href={otherPath}>Consulter aussi : {otherTitle}</a>
        </footer>
      </article>
    </main>
  )
}
