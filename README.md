# InnovCom

Plateforme de mise en relation entre agents commerciaux indépendants et ESN.

## Stack initiale

- `client/`: React + Vite + TypeScript
- `server/`: Node.js + Express + TypeScript
- Prisma configuré pour MySQL
- Architecture détaillée : [docs/architecture.md](docs/architecture.md)
- Schéma relationnel : [server/prisma/schema.prisma](server/prisma/schema.prisma)

## Démarrage

```powershell
npm install
npm run dev
```

Client: http://localhost:5173  
API: http://localhost:3000  
Health check: http://localhost:3000/api/health

## Workflow GitHub

Le workflow GitHub Actions `.github/workflows/ci.yml` s’exécute à chaque push sur `main`, à chaque pull request vers `main` et peut aussi être lancé manuellement. Il installe les dépendances depuis les trois fichiers lock, vérifie le lint client, génère et valide le client Prisma, puis construit le client et le serveur. La validation Prisma utilise une URL MySQL factice et ne se connecte pas à une base.

Pour protéger `main`, configurez dans GitHub une règle de branche qui exige le contrôle **Lint, Prisma validation and build** avant la fusion. Aucun déploiement automatique n’est configuré : il faut d’abord définir l’hébergeur et ses secrets de déploiement.

## Base de données

Copier `server/.env.example` vers `server/.env`, renseigner `DATABASE_URL`, puis lancer:

```powershell
npm run db:generate
npm run db:migrate
```

La migration nécessite un serveur MySQL 8 disponible.

Pour initialiser le compte administrateur avec `npm run db:seed --prefix server`, renseigner d’abord `ADMIN_PASSWORD` avec un mot de passe unique dans `server/.env`. Aucun mot de passe administrateur par défaut n’est fourni. En production, définir également `JWT_SECRET` avec une valeur aléatoire d’au moins 32 caractères; le secret de développement ne peut pas être utilisé en production.

## Connexion Google des agents

Créer un identifiant client OAuth de type application Web dans Google Cloud Console. Ajouter les origines de l’application aux origines JavaScript autorisées (par exemple `http://localhost:5174` en développement), puis renseigner le même identifiant client dans `server/.env` (`GOOGLE_CLIENT_ID`) et `client/.env` (`VITE_GOOGLE_CLIENT_ID`). Redémarrer les deux serveurs après configuration.

La connexion Google est réservée aux agents. Pour toute nouvelle inscription (avec mot de passe ou Google), un code à 6 chiffres est envoyé par email et doit être confirmé avant la création de la candidature. Les candidatures confirmées restent soumises à validation par un administrateur. Après acceptation, le candidat reçoit un email avec son identifiant et un lien à usage unique pour définir son mot de passe. Aucun mot de passe n’est envoyé en clair.

## Cartes et itinéraires Google Maps

Dans Google Cloud Console, activer **Maps Embed API** et créer une clé API restreinte à cette API et aux référents HTTP des portails (en développement : `http://localhost:5174/*`; ajouter aussi le domaine HTTPS de production). Ajouter `VITE_GOOGLE_MAPS_API_KEY=...` dans `client/.env`, puis redémarrer Vite. La clé Maps est publique dans le navigateur : ne pas la réutiliser pour les services serveur et toujours la restreindre.

Depuis la fiche prospect, l’agent démarre le suivi par un clic et autorise la géolocalisation. Google Maps recalcule alors l’itinéraire routier dans la page à mesure que la position évolue (au moins tous les 15 secondes ou après 30 mètres). Le suivi s’arrête lorsque l’agent le désactive ou quitte la page. La géolocalisation nécessite HTTPS en production (localhost est accepté en développement); la position courante est transmise à Google Maps pour afficher le trajet.

### Envoi des codes email

Configurer le serveur SMTP dans `server/.env`. `AGENT_APP_URL` doit pointer sur l’adresse du portail agent pour que le lien d’activation ouvre la bonne application (en développement : `http://localhost:5174`). Avec Gmail, activer la validation en deux étapes sur le compte expéditeur, créer un mot de passe d’application Google et le renseigner dans `SMTP_PASSWORD` (ne jamais utiliser le mot de passe normal du compte). Exemple : `SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=587`, `SMTP_SECURE=false`, `SMTP_USER` avec l’adresse expéditrice et `SMTP_FROM` avec le nom « Ty sy Nday Business ». Ne pas enregistrer le mot de passe d’application dans le dépôt. Redémarrer l’API après modification de la configuration.

Après mise à jour, appliquer la migration et régénérer le client Prisma depuis le dossier `server` :

```powershell
npm run db:migrate
npm run db:generate
```

### Alertes dans l’application

Les notifications sont uniquement internes à l’application : nouveaux produits, publications du forum, messages privés et décisions sur les candidatures. Elles sont conservées dans le compte et diffusées en temps réel lorsque l’application est ouverte et connectée. Le panneau affiche la photo de profil de l’auteur d’une action lorsque celui-ci est connu; les notifications système utilisent une icône de catégorie. La relation optionnelle `actor_id` de `notifications`, ajoutée par `20261106060000_notification_actor_profile`, conserve cette attribution sans affecter l’historique existant. L’agent a besoin d’une connexion Internet (par exemple, les données mobiles activées ou le Wi-Fi). Aucun SMS, message WhatsApp ni service externe n’est utilisé.

### Notifications système du navigateur

Les agents actifs peuvent activer les notifications système depuis leur profil. Elles utilisent Web Push et un service worker ; les alertes sont reçues même quand l’onglet est fermé si le navigateur et le système le permettent. L’autorisation du navigateur est demandée explicitement. Les liens depuis les notifications ouvrent l’alerte correspondante dans l’application ; le contenu des messages privés n’est pas montré dans la notification système.

En production, le site doit être servi en HTTPS. Générer les clés VAPID depuis le dossier `server` avec `npx web-push generate-vapid-keys`, puis renseigner `WEB_PUSH_PUBLIC_KEY` et `WEB_PUSH_PRIVATE_KEY` dans `server/.env`. Renseigner aussi `WEB_PUSH_SUBJECT` avec une adresse de contact `mailto:` valide, redémarrer l’API et appliquer les migrations/régénérer Prisma.

Sur iPhone/iPad (iOS/iPadOS 16.4 ou ultérieur), l’application web doit être ajoutée à l’écran d’accueil et ouverte depuis son icône pour recevoir les notifications push. La prise en charge et l’affichage dépendent aussi des réglages de notification du navigateur et du système.

## Badge abonné et accès aux prospects

L’accès aux contacts prospects partagés est réservé aux agents disposant d’un badge abonné actif. L’admin configure le prix, la durée de validité et le bénéficiaire Mobile Money dans **Paramètres > Badge abonné**. Tant que ces réglages ne sont pas renseignés, les agents ne peuvent pas soumettre de paiement.

L’agent effectue le paiement manuellement, puis transmet la référence de transaction et un justificatif PDF/JPEG/PNG/WebP (5 Mo maximum). Depuis **Demandes badge**, un admin vérifie le justificatif et valide ou refuse la demande. La validation active l’accès pour la durée configurée; un renouvellement validé prolonge la période en cours. À l’expiration, l’API refuse l’accès aux contacts, même si l’agent garde une session ouverte. Les justificatifs restent privés et leur consultation nécessite une session administrateur.

Après validation, l’agent reçoit un email de confirmation avec le montant et la référence du paiement, la durée et les dates de validité du badge, ainsi qu’un remerciement de l’équipe Ty sy Nday. L’envoi utilise la configuration SMTP décrite dans « Envoi des codes email ».

Lorsqu’une demande est déposée, un email confirme sa réception et son statut en attente. En cas de refus, l’agent reçoit également le motif et les détails de sa demande. À chaque publication d’un nouveau prospect, les agents ayant un badge actif sont alertés par email; les coordonnées du prospect restent consultables dans leur espace sécurisé.

### Données personnelles des rapports

Les téléphones, emails et adresses des rapports sont chiffrés avec AES-256-GCM et leurs empreintes normalisées sont conservées pour les contrôles de doublons. Définir `COLLABORATION_ENCRYPTION_KEY` dans `server/.env` comme une clé aléatoire base64 de 32 octets; conserver une sauvegarde sécurisée de cette clé. Sa perte rend les coordonnées chiffrées irrécupérables. Ne jamais la committer ni la changer sans procédure de rotation.

Avant le déploiement, sauvegarder la base puis arrêter temporairement les écritures de rapports. Appliquer les migrations depuis `server`, générer Prisma et exécuter le backfill une seule fois (le script est idempotent). Redémarrer ensuite l’API mise à jour :

```powershell
npm run db:migrate
npm run db:generate
npm run db:encrypt-report-pii
```

Le backfill chiffre les valeurs existantes dans les colonnes rapport elles-mêmes et échoue en cas de modification concurrente; il ne supprime pas les coordonnées de la réponse API autorisée. Les prospects saisis directement par l’administration restent une entité distincte et ne sont pas couverts par cette migration.

### Collaboration sur les rapports LEAD

Chaque nouveau rapport de type `LEAD` crée dans la même transaction un dossier collaboratif et une copie chiffrée des coordonnées du prospect. Les autres agents actifs ne reçoivent qu’une fiche masquée; seul le fournisseur du prospect ou le closer sélectionné avec un accès encore valide peut consulter les coordonnées complètes. Les rapports `PROVIDED_CONTACT` et `FULL_CYCLE` ne créent pas de dossier collaboratif.

L’API expose les fiches masquées et les demandes sous `/api/collaboration`. Les demandes expirent après 24 heures par défaut, un rappel est envoyé après 12 heures, l’accès du closer expire après 14 jours, et un agent peut effectuer au plus trois demandes avec 24 heures entre deux tentatives. Ces valeurs sont configurables dans `settings` avec les clés `collaboration_request_window_hours`, `collaboration_request_reminder_hours`, `collaboration_access_days`, `collaboration_request_cooldown_hours` et `collaboration_max_access_attempts`. Le worker de rappels, d’expiration et d’envoi de courriels démarre avec l’API et traite les tâches toutes les minutes. La livraison email nécessite les paramètres SMTP habituels; les destinataires sont chiffrés dans la file d’attente et les échecs sont réessayés jusqu’à cinq fois.

La migration `20261104240000_collaboration_email_queue` complète les tables collaboratives avec la file d’emails. Appliquer les migrations et régénérer Prisma avant de déployer le code correspondant; ne pas lancer de migration ni de backfill sans sauvegarde et fenêtre de déploiement.

### Étape 6 — clôture, confirmation et signature

L’étape 6 est uniquement backend. Le closer actif, autorisé sur le prospect et disposant encore de son accès peut enregistrer un brouillon, ajouter des pièces puis soumettre une seule fois son rapport. Les pièces acceptées sont PDF/JPEG/PNG/WebP (10 Mio maximum), contrôlées par signature de fichier, stockées sous `private-uploads/collaboration` à la racine du projet, hors du répertoire statique et référencées par leur SHA-256. Les liens de téléchargement sont signés et expirent après cinq minutes. Une correction après soumission se fait par complément tracé. Le closer peut aussi déclarer une perte selon une liste fixe; le fournisseur peut contester avec motif obligatoire.

Par défaut, le client doit confirmer par email avant validation. Régler `CLIENT_CONFIRMATION_REQUIRED=true` (valeur par défaut), `CLIENT_APP_URL` sur l’URL du portail qui recevra la page de confirmation, et conserver `COLLABORATION_ENCRYPTION_KEY` configurée. L’email utilise SMTP; aucun SMS n’est intégré. Le code à usage unique est stocké sous forme HMAC, expire après 48 heures et est bloqué temporairement après cinq erreurs. Le lien utilise un jeton aléatoire opaque de 192 bits; seule son empreinte SHA-256 est stockée en base et le lien est chiffré dans la file email. Le scheduler marque les confirmations expirées `NO_RESPONSE`. Pour `PUT /api/collaboration/:dealId/closing-report/draft`, un champ omis reste inchangé et une valeur `null` efface explicitement `saleAmount`, `saleDate` ou `details`; un rapport soumis reste immuable.

Les routes publiques de confirmation sont sous `/api/collaboration/public/confirmations/:publicToken`; elles répondent de façon identique aux jetons inconnus, expirés ou déjà utilisés et sont limitées par adresse IP. Le frontend porte le jeton opaque dans le lien, jamais le code de confirmation. Les routes agent sont sous `/api/collaboration`, et les routes de revue/signature sous `/api/admin/collaboration`. L’enrôlement TOTP admin utilise `POST /2fa/enroll/start` puis `POST /2fa/enroll/verify`; les autres routes d’administration exigent un code TOTP non réutilisé dans l’en-tête `x-admin-totp`. Le fournisseur ne reçoit sur sa frise que les statuts et dates. La signature vérifie aussi les empreintes des coordonnées et publie l’événement `contract.signed`; la génération des commissions reste à l’étape 7.

Le scheduler garde son verrou local par processus et prend en plus un bail partagé en base, renouvelé pendant le traitement. Cela protège les exécutions concurrentes entre instances après application de la migration. Pour le stockage de pièces en déploiement multi-instance, toutes les instances doivent partager le même stockage privé; le répertoire local convient uniquement si son volume est persistant et accessible par toutes les instances.

### Étape 7 — commissions de collaboration

À la signature, `contract.signed` conserve un instantané des paramètres de commission et le consommateur transactionnel crée une commission `SUPPLIER` et une commission `CLOSER`. Une commission disponible (`PENDING`) alimente immédiatement le solde du portefeuille de l’agent; une commission `ON_HOLD`, annulée ou déjà payée n’est pas ajoutée au solde disponible. La contrainte unique vente/rôle, le verrou sur l’événement et le verrou de vente rendent le rejeu idempotent et sérialisent les exécutions concurrentes. Les montants ne sont pas modifiables après création; les événements signés avant l’étape 7, s’il en existe qui restent en attente, utilisent la configuration actuelle au moment de leur traitement, car leur payload historique ne contient pas d’instantané.

Configurer les montants dans `server/.env` (les valeurs demandées sont les valeurs par défaut) :

```env
COMMISSION_PROVIDER_AMOUNT=50000
COMMISSION_CLOSER_AMOUNT=100000
COMMISSION_CURRENCY=Ar
```

Le backend refuse les montants ou délais non entiers, négatifs ou hors plage sûre. Les valeurs sont figées dans les lignes de commission; les ajustements ultérieurs sont des écritures signées avec motif, sans modifier la commission originale. La double validation au-dessus d’un seuil est reportée et n’est pas activée.

Le scheduler réessaie les erreurs de génération avec un délai exponentiel et envoie une alerte interne aux administrateurs à chaque échec. Les événements non consommés et erreurs sont consultables à `/api/admin/collaboration/commissions/events` (TOTP requis). Une commission d’agent suspendu est conservée et mise en `ON_HOLD`; une vente contestée retire également ses commissions `PENDING` du solde disponible et les place en attente. L’administration peut les libérer, annuler ou réattribuer avec un motif obligatoire. Les commissions `PAID` des anciens versements directs restent immuables; toute correction nécessite une écriture d’ajustement.

Les agents consultent uniquement leurs propres commissions avec `GET /api/collaboration/commissions/me` et leur récapitulatif périodique avec `GET /api/collaboration/commissions/me/summary`. Les montants `PENDING` en ariary et leurs ajustements sont inclus dans le solde disponible et l’historique du portefeuille. Une demande de retrait réserve son montant; le refus la libère. L’agent choisit le montant, l’opérateur et le numéro de réception, puis l’administration enregistre la référence uniquement après avoir effectué le retrait. À l’approbation, un email informe l’agent que le retrait est accepté et en cours de traitement; un second email confirme le paiement avec sa référence après le versement réel. Ces emails affichent la marque de l’opérateur et un message d’encouragement. Le retrait payé diminue alors le solde disponible. L’API vérifie le solde et sérialise les demandes concurrentes pour éviter les retraits supérieurs au montant disponible. L’administration utilise les endpoints sous `/api/admin/collaboration/commissions` pour filtrer, exporter un CSV et ajouter un ajustement; les décisions de litige exigent un compte admin actif, un TOTP non réutilisé et sont limitées en débit. L’ancien endpoint de paiement direct des commissions est refusé pour éviter un double versement.

Si une vente est contestée, ses commissions disponibles sont mises en attente et ne peuvent pas financer un nouveau retrait tant que l’administration n’a pas résolu le dossier. Les commissions déjà retirées ne sont pas récupérées automatiquement.

Si l’email du reçu reste en échec après cinq tentatives, une alerte est envoyée aux administrateurs et le détail est accessible à `GET /api/admin/collaboration/commissions/email-failures` (TOTP requis).

La réconciliation est disponible en lecture seule par `GET /api/admin/collaboration/commissions/reconciliation` et par le script `npm run db:reconcile-collaboration-commissions` depuis `server`. Le script retourne un code de sortie non nul si une vente signée n’a pas exactement les deux commissions attendues. Le test de concurrence crée lui-même un événement et des données synthétiques; il refuse les bases dont le nom ne contient pas `test`. Après son exécution, restaurer la sauvegarde de la base jetable : les fixtures et leurs audits append-only ne sont pas supprimés.

La migration additive `20261105000600_collaboration_commissions` avait été reportée lors de cette étape historique. Pour chaque évolution, vérifier la base cible avant migration et obtenir l’accord explicite après présentation du SQL.

### Étape 8 — audit chaîné, détection et confiance

La migration additive `20261106010000_collaboration_audit_trust` ajoute une séquence à l’audit collaboratif, les champs acteur/avant/après, les revendications de hashes prospect, les compteurs d’accès et l’historique des scores. Chaque nouvel audit est chaîné en SHA-256 sous verrou transactionnel. Les triggers MySQL refusent UPDATE et DELETE des lignes d’audit. Les entrées antérieures à l’étape 8 restent en version 1 et sont vérifiées avec leur ancien format de hash; elles ne peuvent pas prouver qu’aucune suppression historique n’a eu lieu avant la migration.

L’administration consulte et exporte l’audit avec TOTP sous `/api/admin/collaboration/audit` et `/api/admin/collaboration/audit/export.csv`. Le script `npm run db:verify-collaboration-audit-chain` vérifie la chaîne sans la modifier. Le scheduler répète cette vérification dans sa fenêtre nocturne et alerte l’administration en cas d’anomalie. Connexions, événements TOTP, décisions de dossier, paiements, emails et consultations de coordonnées sont journalisés; les coordonnées ne sont pas ajoutées aux événements de consultation.

La limite quotidienne par agent et les alertes d’extraction sont configurables dans `server/.env` :

```env
COLLABORATION_CONTACT_DAILY_LIMIT=50
CONTACT_VIEW_DEDUP_MINUTES=5
COLLABORATION_CONTACT_BURST_LIMIT=10
COLLABORATION_CONTACT_BURST_WINDOW_MINUTES=5
COLLABORATION_CONTACT_DENIED_ALERT_THRESHOLD=5
COLLABORATION_ACCESS_WITHOUT_REPORT_THRESHOLD=10
COLLABORATION_BYPASS_CHECK_DAYS=30
COLLABORATION_TRUST_SCORE_ALERT_THRESHOLD=40
COLLABORATION_TRUST_SCORE_SUSPENSION_PROPOSAL_THRESHOLD=20
```

Le filigrane de réponse expose l’identité du closer autorisé à l’interface; l’API ne suspend pas automatiquement un agent. Elle propose une vérification à l’administration, qui peut suspendre avec TOTP et motif. La détection compare les empreintes des contacts à la signature puis lors du contrôle périodique; une correspondance sans rapport de clôture passe le dossier en litige et alerte l’administration.

Le score est reproductible et versionné (formule 1, résultat arrondi sur 100) : taux de conclusion `conclus / résolus × 40` (conclus : `CONFIRMED`, `CONTRACT_SIGNED`, `COMMISSIONS_PAID`; résolus : ces états plus `LOST`, `REJECTED`, `EXPIRED`); litiges perdus `max(0, 1 − nombre/3) × 25`; délai moyen du rapport `max(0, 1 − heures/336) × 20` (10 points neutres en l’absence de rapport); expirations répétées `max(0, 1 − nombre/5) × 10`; ancienneté `min(jours/365, 1) × 5`. L’historique quotidien est conservé. Le dernier score du demandeur est exposé au fournisseur dans la liste des demandes d’accès, sans détails de calcul sensibles.

#### Procédure proposée — migrations 7 et 8 sur une base de test

Rien n’a été appliqué à la base. La migration 7 (`20261105000600_collaboration_commissions`) et la migration 8 (`20261106010000_collaboration_audit_trust`) doivent être appliquées dans cet ordre. Prisma `migrate deploy` applique toutes les migrations en attente; pour valider chaque étape séparément, utiliser deux versions de déploiement successives, la première contenant les migrations jusqu’à 7, puis la seconde contenant 8. Ne pas déplacer/masquer manuellement un fichier de migration pour forcer l’ordre.

1. Confirmer explicitement le nom de la base cible et que la connexion pointe exclusivement vers la base de test. Vérifier l’identité avec `SELECT DATABASE();`; interrompre si elle ne correspond pas à la base isolée attendue.
2. Créer une sauvegarde complète, vérifier son intégrité et la restaurer dans une base de test jetable. Avant toute écriture, prévisualiser les ventes signées, les commissions existantes et la présence d’un instantané de configuration dans leur événement `contract.signed`. Aucun nombre de ventes n’a pu être confirmé dans cette session, car la connexion disponible ne correspondait pas à la base de test annoncée.
3. Examiner les ventes historiques sans modifier la base. Pour une vente sans instantané de montants, ne pas appliquer automatiquement les valeurs actuelles : faire valider par l’administration les montants historiques à figer, puis préparer un backfill distinct, idempotent, traçable et prévisualisable.
4. Sur une copie restaurable, appliquer la migration 7 avec `npx prisma migrate deploy` depuis la version dédiée à l’étape 7; vérifier le statut Prisma, le schéma et la réconciliation. Restaurer la sauvegarde après les essais destructifs.
5. Appliquer ensuite la migration 8 depuis la version qui l’inclut. Vérifier les triggers append-only, la tête et la chaîne d’audit, puis exécuter les tests unitaires. Sur une base jetable restaurée, lancer `npx tsx --test src/modules/collaboration/collaboration.commissions.integration.test.ts`; le test crée ses propres fixtures concurrentes et vérifie aussi le refus d’UPDATE/DELETE.
6. En cas d’échec DDL, ne pas relancer à l’aveugle et ne pas tenter un rollback SQL artisanal : MySQL valide implicitement plusieurs DDL. Conserver les logs, inspecter l’état de `_prisma_migrations` et restaurer la sauvegarde vérifiée dans une nouvelle base jetable. N’appliquer en production qu’après validation explicite et procédure de déploiement approuvée.

Avant `migrate deploy`, résoudre aussi le répertoire de migration vide `20261106000000_collaboration_commissions` présent dans l’arborescence : il ne contient pas de `migration.sql` et n’est pas une migration à exécuter. Ne pas le supprimer sans confirmer son origine et l’état de la branche/de l’historique Prisma.

La migration `20261106020000_collaboration_schema_drift` aligne les colonnes `from_status` et `to_status` de l’historique collaboratif sur les 14 valeurs de `CollaborationDealStatus` et retire l’index redondant `(deal_id, reported_at)` des rapports de clôture. L’unicité de `deal_id` reste assurée par `collaboration_closing_reports_deal_id_key` et supporte la clé étrangère. La migration ne modifie pas `subscription_requests.reviewed_by`. Le test d’intégration de commissions vérifie maintenant l’écriture de chaque statut du cycle de vie dans l’historique.

#### Migration et backfill LEAD : procédure contrôlée

Ne pas appliquer cette procédure directement en production sans fenêtre de maintenance et accord explicite. La migration de l’étape 6 n’a pas de rollback SQL automatique.

1. Sauvegarder la base complète avec l’outil d’exploitation approuvé, vérifier l’intégrité de la sauvegarde et restaurer une copie dans une base de test isolée. Ne jamais tester sur la base de production.
2. Sur cette copie, arrêter les écritures applicatives, appliquer les migrations en attente, régénérer Prisma, puis exécuter le chiffrement des coordonnées de rapports. Vérifier les comptes de rapports et dossiers collaboratifs, le parcours d’un dossier de test, la chaîne d’audit, le stockage privé et le verrou du scheduler avant de rouvrir les écritures.
3. En production, vérifier une nouvelle sauvegarde/restauration, arrêter les écritures, configurer et sauvegarder en lieu sûr les clés de chiffrement, puis appliquer les migrations avec `npx prisma migrate deploy` depuis `server`. Générer le client Prisma et déployer le backend compatible. Ne pas utiliser `prisma migrate dev` en production.
4. Exécuter `npm run db:encrypt-report-pii` pour chiffrer les coordonnées historiques. Le script de backfill ne doit être lancé qu’après cette étape et après vérification des rapports ciblés.
5. Prévisualiser les candidats sans écriture (c’est aussi le mode par défaut) : `npm run db:backfill-collaboration-leads`. Choisir explicitement les seuls rapports `LEAD` admissibles — statuts `SOUMIS`, `EN_VERIFICATION` ou `A_COMPLETER` — et confirmer les identifiants avant application. Le script ne reprend pas implicitement les brouillons, rapports refusés ou finalisés.
6. Générer un UUID de lot et appliquer uniquement les identifiants choisis : `npm run db:backfill-collaboration-leads -- --mode=apply --batch-id=<UUID> --report-ids=12,34`. Le lot est enregistré dans les dossiers créés; conserver cet UUID dans le journal d’exploitation. Chaque dossier est créé dans sa propre transaction, ce qui permet de reprendre d’autres identifiants après un arrêt.
7. Le backfill est idempotent pour un même lot : une relance ignore les rapports déjà liés à ce lot et peut terminer ceux qui restent. Pour annuler, uniquement si les dossiers du lot n’ont encore aucune activité, lancer `npm run db:backfill-collaboration-leads -- --mode=rollback --batch-id=<UUID>`. Le script refuse le rollback dès qu’un dossier a changé d’état ou possède une demande, un rapport, une pièce, un email, un événement ou une entrée d’audit. Pour revenir sur une migration, restaurer la sauvegarde vérifiée selon la procédure de reprise de l’exploitation; ne pas supprimer manuellement les tables.

La migration et le backfill n’ont pas été appliqués à une base pendant cette étape.

Après récupération des changements, appliquer la migration et générer Prisma depuis la racine du projet :

```powershell
npm run db:migrate
npm run db:generate
```

## Communauté et messagerie

Le forum permet aux agents actifs de publier avec une photo facultative (JPEG, PNG ou WebP, 5 Mo maximum), de réagir et de répondre aux commentaires. Les agents peuvent modifier ou supprimer leurs publications et commentaires, ainsi que les masquer à tous les autres agents puis les réafficher. Le masquage par l’auteur est distinct du masquage de modération; il repose sur les colonnes `author_hidden` ajoutées aux tables `posts` et `comments` par la migration `20261106050000_author_community_content_controls`. Les photos de publication sont enregistrées dans `server/uploads/community-images` et le champ `image_url` déjà présent sur `posts` est utilisé. La messagerie privée utilise Socket.IO pour diffuser les messages en temps réel et conserve l’historique dans MySQL. Les réponses, conversations et messages sont ajoutés par la migration `20261026150000_community_replies_and_private_chat`. Les agents peuvent archiver une conversation pour eux seuls, la restaurer depuis l’onglet « Archivées » ou la supprimer uniquement de leur propre liste. L’auteur peut aussi supprimer un message individuel pour les deux participants depuis le menu de ce message. La migration `20261107195000_private_chat_archive_delete` ajoute les horodatages de masquage personnel.

Avant de démarrer l’API après une nouvelle mise à jour, appliquer les migrations et régénérer le client Prisma:

```powershell
npm run db:migrate
npm run db:generate
```

### Interfaces de collaboration — étape 9A

L’espace agent propose **Mes commissions**, qui consomme uniquement les vues authentifiées `/api/collaboration/commissions/me` et `/api/collaboration/commissions/me/summary`; le serveur filtre les lignes sur l’agent connecté. Les commissions créditées au portefeuille, en décision, payées par l’ancien processus ou annulées sont présentées avec libellé et indicateur, et les dates sont affichées dans le fuseau `Indian/Antananarivo`.

Les routes fournisseur de l’étape 9A sont `GET /api/collaboration/supplied` (dossiers propres, nom masqué, sans enregistrer une consultation de coordonnées) et `GET /api/collaboration/access-requests/pending` (demandes pending non expirées de ses dossiers). Elles filtrent côté serveur par `supplierId` de l’agent authentifié. La route par dossier `GET /api/collaboration/:dealId/access-requests` ajoute `requester.successfulSales`, nombre de dossiers distincts en `CONTRACT_SIGNED` ou `COMMISSIONS_PAID`. Ce décompte est volontairement plus strict que le score de confiance actuel, qui compte également `CONFIRMED`; la formule du score n’est pas modifiée.

La frise fournisseur `GET /api/collaboration/:dealId/timeline` n’expose `saleNumber` qu’après `CONTRACT_SIGNED` (ou `COMMISSIONS_PAID`). Les vues excluent les coordonnées et les détails de clôture. Les tests d’intégration de ces routes sont réservés à `localhost/bases_test`.

La page publique `/confirmation-client/:publicToken` utilise les endpoints `GET /api/collaboration/public/confirmations/:publicToken` et `POST /api/collaboration/public/confirmations/:publicToken/respond`. Le jeton est aléatoire et non devinable; le code saisi reste en mémoire, n’est pas conservé dans le stockage local ni placé dans l’URL. La page est marquée `noindex, nofollow` et n’initialise pas la session agent. La migration `20261106030000_collaboration_public_confirmation_token` a été appliquée et vérifiée uniquement sur `localhost/bases_test`; elle n’a pas été appliquée en production.

L’accueil fournisseur affiche les prospects avec nom masqué, état, date et nombre de demandes en attente. La boîte de demandes utilise `GET /api/collaboration/access-requests/pending`; accepter/refuser appelle `PATCH /api/collaboration/access-requests/:requestId` et la liste se met à jour sans rechargement. Le compte à rebours est calculé depuis `expiresAt`; une demande expirée ne peut plus être traitée dans l’interface. La frise utilise `GET /api/collaboration/:dealId/timeline`, sans consulter les coordonnées, et n’affiche le numéro de vente qu’après signature. Ces écrans sont accessibles depuis la navigation desktop et mobile, avec un badge des demandes en attente. Les erreurs 401/403/409/429 ont un message adapté et les écrans proposent une reprise après erreur réseau.

### Interfaces du closeur — étape 9B, écrans non bloqués

La navigation agent comprend **Prospects disponibles**, branché sur `GET /api/collaboration/prospects` et `POST /api/collaboration/:dealId/access-requests`. Le nom du prospect reste masqué; le message de demande est facultatif et limité à 500 caractères côté interface et API. Un verrou en mémoire empêche les doubles clics. La réponse prospects inclut le dernier score fournisseur avec sa date de calcul et `myRequest.nextRequestAt` calculé par le serveur; le POST reste l’autorité pour accepter ou refuser une demande.

La navigation inclut **Mes accès** et utilise `GET /api/collaboration/closer/accesses`, qui ne renvoie que les dossiers actifs approuvés du closeur connecté, sous forme masquée et sans compter de consultation. L’ouverture de la liste n’appelle que cette route. Le détail `GET /api/collaboration/:dealId` est appelé exclusivement après le tap explicite « Afficher les coordonnées » : le serveur vérifie l’accès et le quota avant de charger les coordonnées, renvoie `Cache-Control: no-store`, journalise chaque affichage et déduplique la charge du quota pendant une fenêtre fixe de cinq minutes. Le filigrane renvoyé par le serveur est affiché avec les coordonnées. Celles-ci sont conservées uniquement dans l’état mémoire de l’écran et supprimées en le quittant ou en les masquant; elles ne figurent ni dans `localStorage`, ni dans les journaux, ni dans une URL. Un dépassement de quota (429) affiche un message explicite.

Depuis **Mes accès**, le closeur ouvre le rapport ou déclare une perte selon le statut renvoyé par l’API. `CLOSING_REPORTED` et les autres états hors `IN_PROGRESS` sont en lecture seule; le bouton de déclaration de perte n’est proposé que pour `IN_PROGRESS`. Le rapport utilise `GET /api/collaboration/:dealId/closing-report`, `PUT /draft`, `POST /attachments` et `POST /submit`. Les brouillons sont autosauvegardés côté serveur et restaurés après rechargement; effacer volontairement un champ envoie `null`, les autres champs inchangés sont omis. Les pièces privées sont limitées dans le navigateur à PDF/JPEG/PNG/WebP de 10 Mo maximum. La soumission utilise une clé UUID idempotente et verrouille l’écran après confirmation serveur. La déclaration de perte utilise `POST /api/collaboration/:dealId/lost` et uniquement les motifs énumérés par l’API. **Mes commissions** réutilise la page existante et ses routes propres à l’agent.

L’affichage des coordonnées reste interdit aux dossiers sans accès actif; une nouvelle consultation dépassant le quota reçoit une erreur 429. Les écrans de rapport et de déclaration de perte sont accessibles depuis les dossiers de **Mes accès**.

### Interfaces administrateur — étape 9C, lot 1–2

La navigation admin comprend **Vérification des ventes**. La file utilise uniquement `GET /api/admin/collaboration/deals`, puis ouvre un dossier avec `GET /api/admin/collaboration/deals/:dealId`. Les deux appels et `PATCH /api/admin/collaboration/deals/:dealId/decision` transmettent un code TOTP frais dans `x-admin-totp`; le code est effacé de l’état du formulaire dès l’envoi et n’est jamais conservé ni ajouté à l’URL. Le détail réunit le rapport, les pièces jointes via leurs liens signés, la confirmation client, l’historique des statuts et les scores des agents.

Le tableau « À traiter maintenant » charge `GET /api/admin/collaboration/dashboard`; chacun de ses huit compteurs ouvre la file paginée correspondante. Les ventes à vérifier utilisent `/deals`, les signatures `/deals/ready-to-sign`, les alertes `/alerts`, et l’historique des commissions créditées `/commissions?status=PENDING&page=…&limit=50` avec son total (pas la route plafonnée `/commissions/pending`). Les paiements et références sont enregistrés dans la file **Retraits**, après demande de l’agent. Les pages sont limitées à 50 éléments.

Les litiges sont triés en priorité et mis en évidence dans la liste `/deals`. La route ne fournit pas les motifs et exclut les dossiers déjà confirmés; par conséquent, l’interface ne peut pas constituer une file exhaustive de dérogations ni afficher leur motif avant ouverture d’une fiche. Un filtre/une réponse serveur dédié reste à ajouter ultérieurement, sans changement backend dans ce lot.

Confirmer ou rejeter demande un récapitulatif explicite affiché avant l’activation de la confirmation finale et du nouveau code TOTP. Le rejet et une dérogation à la confirmation client nécessitent un motif; la dérogation et son motif restent visibles dans la fiche. Chaque lecture et décision utilise un code frais transmis dans `x-admin-totp`, effacé avant la requête et jamais stocké. Les pièces utilisent `fetch` avec `cache: no-store` et un téléchargement temporaire par URL objet, plutôt qu’un lien signé conservé dans le DOM. Les erreurs 401/403/409/429 sont présentées avec un message humain, les requêtes sont verrouillées contre les doubles envois et la mise en page s’adapte aux écrans de 360 px.

Le lot frontend 1–2 n’a ajouté aucun endpoint, schéma ou fichier de migration.

### Interfaces administrateur — étape 9C, lot 3–4

La file « À signer » utilise `GET /api/admin/collaboration/deals/ready-to-sign` et affiche `canSign` avec les `blockers` renvoyés par le serveur. La signature utilise `POST /api/admin/collaboration/deals/:dealId/signature`; le récapitulatif explicite précède l’envoi, qui exige une référence, une date, un fichier PDF/JPEG/PNG/WebP (10 Mio maximum) et un TOTP frais. Le numéro de vente vient directement de la réponse de signature. Le hash SHA-256 est chargé uniquement après clic « Voir le hash » et un nouveau TOTP, via la fiche existante. La réussite désactive localement toute nouvelle signature; en cas d’erreur réseau, aucune requête n’est relancée automatiquement et l’interface demande de recharger l’état.

La file des commissions `GET /api/admin/collaboration/commissions?status=PENDING&page=…&limit=50` est une consultation des montants déjà crédités dans les portefeuilles. Aucun paiement ni référence ne sont saisis dans cette file. Les références sont enregistrées dans la file **Retraits** uniquement après le versement réel à l’agent.

L’export utilise `GET /api/admin/collaboration/commissions/export.csv` avec un TOTP frais, avertit que les données sont financières et télécharge via un Blob/URL objet révoqué après usage; l’application ne conserve pas le fichier dans `localStorage` ou son cache. Aucun endpoint de téléchargement de reçu PDF individuel n’existe actuellement; le backend met déjà en file le reçu e-mail lors du paiement. Toutes les saisies TOTP sont `autocomplete="off"` et effacées avant la requête.

Le lot frontend 3–4 ne modifie aucun endpoint, le backend ou une migration.

### TEMPS 1 backend admin — étape 9C

- `GET /api/admin/collaboration/dashboard` fournit les compteurs filtrés par agent et période.
- `GET /api/admin/collaboration/deals/ready-to-sign` fournit les dossiers `CONFIRMED` paginés avec leurs prérequis.
- `GET /api/admin/collaboration/alerts` filtre les alertes de contournement, d’extraction et d’expirations répétées par type, agent et période; les données retournées excluent les coordonnées, leurs empreintes et les montants.
- `GET /api/admin/collaboration/audit/verification` expose le dernier état `VALID`, `BROKEN`, `UNKNOWN` ou `STALE` (résultat vieux de plus de 36 heures). Seul le scheduler détenant le bail actif peut enregistrer un nouveau résultat.
- `GET /api/admin/collaboration/deals` accepte `page` et `limit` (maximum 50), conserve les filtres agent/période communs au dashboard et utilise le tri stable `updatedAt`, puis `id`.

Les routes de lecture admin exigent un rôle administrateur, un code TOTP frais, un rate limit et une entrée AuditLog. Les tests d’intégration sur `bases_test` couvrent le refus non-admin/sans TOTP, l’expurgation des réponses, la pagination, la parité des compteurs, les états de chaîne et l’audit; aucun accès à la base n’est requis pour les changements frontend ci-dessus. Aucun endpoint, schéma ou fichier de migration n’a été ajouté ou modifié dans le lot 1–2.

### Interfaces administrateur — étape 9C, lot 5–7

La file des litiges parcourt les pages de `/api/admin/collaboration/deals` et affiche les dossiers `DISPUTED`, y compris ceux sans commission. Les commissions en attente d’arbitrage sont lues via `/api/admin/collaboration/commissions?status=ON_HOLD&page=…&limit=100`; l’interface affiche leur nombre par dossier après chargement de toutes les pages et désactive la résolution si des commissions restent retenues. Avant chaque décision, l’état est rechargé avec TOTP. `RELEASE`, `CANCEL`, `REASSIGN` et la résolution du litige demandent un motif et un récapitulatif; `CANCEL` est explicitement irréversible et `REASSIGN` présente l’agent actuel et le nouvel ID. Le serveur reste l’autorité finale et ses erreurs 409 sont affichées.

Le journal d’audit utilise `/api/admin/collaboration/audit` paginé, avec filtres acteur, objet, action et période. Les périodes incluent la journée complète au fuseau Indian/Antananarivo. L’export CSV passe par `/api/admin/collaboration/audit/export.csv`, exige un TOTP frais et avertit de la sensibilité du journal; le fichier reste en mémoire. La vérification `/api/admin/collaboration/audit/verification` est visible sur le tableau de bord et dans l’écran d’audit : `BROKEN` est rouge avec alerte, `STALE`/`UNKNOWN` sont orange et seul `VALID` est vert.

La liste de confiance `/api/admin/collaboration/trust` est paginée avec `total`, score et date de calcul, sans email ni composants du score; l’écran Agents utilise ce total et ces pages. Les alertes utilisent `/api/admin/collaboration/alerts`, filtrables par type, agent et dates. La liste paginée `/api/admin/collaboration/agents/active` fournit les identifiants et noms disponibles pour la réattribution. Les propositions de suspension ne sont jamais exécutées automatiquement. L’interface envoie un motif dans le corps de `PATCH /api/admin/agents/:id/status` pour les transitions vers `ACTIF` et `SUSPENDU`; le serveur l’exige aussi pour les deux transitions.

### Lot serveur préproduction — étape 9C

- `GET /api/admin/collaboration/deals?status=DISPUTED` fournit une liste paginée incluant les dossiers sans commission, avec motif de litige tronqué à 200 caractères et date du passage à `DISPUTED`. Le motif complet est réservé à la fiche du dossier.
- `GET /api/admin/collaboration/deals/overrides` est déclaré avant `/deals/:dealId`. Il liste tous les dossiers, quel que soit leur statut, dont `clientConfirmationOverrideReason` n’est pas nul. Chaque ligne inclut le motif, la date, l’administrateur et les noms/identifiants des agents; la liste est paginée et auditée.
- `/api/admin/collaboration/trust` renvoie scores et dates de calcul avec pagination et total. `/api/admin/collaboration/agents/active` fournit la liste paginée des agents actifs pour la réattribution.
- Ces lectures exigent un administrateur et un TOTP valide, sont limitées en débit et ajoutent une entrée AuditLog. Les réponses excluent coordonnées, hashes, montants de vente et contenu de pièces; la confiance n’expose pas les emails.
- `GET /api/admin/collaboration/deals`, `/deals/overrides`, `/trust` et `/agents/active` acceptent `page` et `limit` (maximum 50). Les pages utilisent un tri stable.
- Suite complète des tests de collaboration (unitaires et intégration), 14 fichiers exécutés en série : **52 réussis, 0 échec, 0 ignoré** sur `localhost/bases_test`, après vérification de `DATABASE_URL` dans `server/.env.test`. Elle couvre autorisation admin/TOTP, expurgation, pagination et limite, parité avec les compteurs, AuditLog, états de chaîne et motif obligatoire pour suspendre/réactiver. Aucun test n’a été lancé contre une autre base.

Validation frontend de ce lot : build TypeScript/Vite réussi, lint ciblé réussi et 5 tests utilitaires ciblés réussis. Aucun runner de test UI/E2E n’est configuré; le contrôle visuel des vues protégées à 360 px reste à faire. Aucune migration n’a été créée ou appliquée.

### Fixtures de collaboration (développement local uniquement)

Le script `server/scripts/create-collaboration-test-fixtures.ts` crée des comptes et prospects fictifs uniquement si `server/.env.test` cible `localhost/bases_test` et contient une clé `COLLABORATION_ENCRYPTION_KEY` valide. Lancer depuis PowerShell :

```powershell
Set-Location server
npx tsx scripts/create-collaboration-test-fixtures.ts
```

Il crée un administrateur actif, trois agents actifs (A, B, C) et un prospect LEAD chiffré par agent. Les mots de passe aléatoires ne sont jamais affichés; ils sont conservés dans `server/.test-collaboration-accounts-<runId>.json`, ignoré par Git. Garder ce fichier local et le supprimer après les essais. Aucun email n'est envoyé lors de la création directe des fixtures.

#### Activer le TOTP de l'administrateur de test

Il n'y a pas d'écran d'enrôlement TOTP dans l'interface actuelle. Pour l'admin de test `194`, exécuter le script interactif depuis un terminal local :

```powershell
Set-Location server
npx tsx scripts/enroll-test-admin-totp.ts
```

Le script exige `server/.env.test` sur `localhost/bases_test` et le fichier local de credentials du compte test. Il vérifie d'abord le mot de passe admin, affiche l'URI `otpauth` une seule fois dans le terminal, puis attend un code de l'application d'authentification. Le TOTP n'est enregistré comme activé qu'après validation du code; l'URI et le secret ne sont jamais écrits dans un fichier ni dans les logs. Une fois activé, chaque action admin nécessite un nouveau code dans `x-admin-totp`.

Les autres routes d'administration exigent ensuite un code frais dans l'en-tête `x-admin-totp`.

#### Capturer les emails en test

Ne pas utiliser les identifiants SMTP de production pour ces essais. Démarrer Mailpit localement :

```powershell
docker run --rm -p 1025:1025 -p 8025:8025 axllent/mailpit
```

Dans `server/.env.test` (fichier local ignoré), configurer `SMTP_HOST=127.0.0.1`, `SMTP_PORT=1025`, `SMTP_SECURE=false`, `SMTP_USER=test`, `SMTP_PASSWORD=test` et `SMTP_FROM="Ty sy Nday Test <no-reply@example.invalid>"`. Le serveur d'API doit être lancé avec ces variables de test dans son environnement; il ne charge pas automatiquement `.env.test` en mode dev. La boîte capturée est visible sur `http://127.0.0.1:8025`. Le helper SMTP exige un hôte, un utilisateur et un mot de passe non vides même si Mailpit n'authentifie pas les connexions.

Pour la base locale `cominnovt`, lancez l'API depuis la racine du dépôt avec `.\server\scripts\start-local-collaboration.ps1`. Ce lanceur utilise `server/.env`, refuse toute destination autre que `localhost/cominnovt`, exige la clé de chiffrement existante et utilise les identifiants Google et SMTP configurés dans ce fichier. Il active le scheduler de collaboration : celui-ci traite les contrats signés, réessaie les emails en file et applique les expirations prévues. Vérifiez que cette API est l'unique instance destinée à traiter cette base avant son démarrage.

Pour traiter explicitement les événements `contract.signed` en attente et créditer les commissions disponibles au portefeuille local sans attendre le cycle du scheduler, lancez depuis la racine du dépôt `npm --prefix server run db:process-pending-collaboration-commissions`. La commande est limitée à `localhost/cominnovt`, n'effectue aucun retrait ni versement et ne démarre pas le scheduler.

### Prospects signés dans la collaboration

Lorsqu’un contrat est signé, la transaction de signature ferme les demandes d’accès encore `PENDING` en `CLOSED_SIGNED`, annule les courriels collaboration programmés et enregistre une notification d’information par demandeur. Toute nouvelle demande d’accès, acceptation, action de rapport de clôture ou déclaration de perte sur un dossier signé est refusée par le serveur avec HTTP 409 (« Prospect déjà signé »). Les dossiers `LOST` et `EXPIRED` redeviennent disponibles aux demandes; les agents déjà concernés en sont informés.

Les agents non concernés voient uniquement une entrée générique `CLOSED_SIGNED`, sans coordonnées, montant ni numéro de vente. Ils peuvent la retirer de leur liste avec `POST /api/collaboration/prospects/:dealId/hide`; cette opération est idempotente et ne masque le dossier que pour l’agent connecté. Seul un administrateur authentifié avec TOTP peut le restaurer via `/api/admin/collaboration/deals/:dealId/hidden-agents/:agentId/restore`. Le fournisseur et le closeur attribué conservent la frise, le numéro de vente et leurs commissions; le closeur ne peut plus modifier la clôture ni consulter les coordonnées depuis la vue signée.

La migration Prisma `20261106040000_close_signed_prospects` (deux valeurs d’enum et la table `collaboration_hidden_deals`) a été appliquée à `localhost/bases_test` et, après autorisation distincte, à `localhost/cominnovt`; elle n’a pas été appliquée en production. Les 24 migrations sont à jour sur ces bases locales. Builds serveur/client, 13 tests unitaires et tests d’intégration agent/admin ont réussi sur `bases_test`; vérifier `DATABASE_URL` avant chaque exécution et lancer les deux suites d’intégration séquentiellement. Leurs fixtures et audits append-only restent dans cette base. Après migration, redémarrer l’API pour recharger le client Prisma; l’instance locale vérifiée a été relancée avec scheduler et SMTP désactivés, donc les envois email y sont désactivés.
