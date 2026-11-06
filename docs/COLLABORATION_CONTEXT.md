# Contexte de la collaboration entre agents

Document de reprise établi depuis le README, les routes, les migrations et les tests actuellement présents dans le dépôt. Les 23 noms de migration ci-dessous sont ceux des dossiers du dépôt; leur présence ne prouve pas qu'ils sont appliqués à une base donnée.

## 1. Objectif

Organiser la collaboration sur un prospect entre :

- **A, fournisseur** : déclare le prospect et décide d'accorder ou non l'accès.
- **B, closeur** : demande l'accès, contacte le prospect après approbation, puis déclare le résultat et peut soumettre un rapport de clôture.
- **Admin** : examine les dossiers, confirme le résultat, signe le contrat, arbitre les litiges et gère les commissions.

Après signature du contrat, le système prévoit une commission configurée de **50 000 Ar** pour A et **100 000 Ar** pour B. Ces valeurs sont des valeurs de configuration, pas des montants à coder en dur.

## 2. État du projet

- **Étapes 1 à 8** : backend indiqué comme terminé.
- **Étape 9A** : interfaces fournisseur et confirmation publique terminées.
- **Étape 9B** : écrans closeur reliés aux routes existantes, en complément du **TEMPS 1 backend**. **Mes accès** appelle `GET /api/collaboration/closer/accesses`; les coordonnées ne sont demandées qu'au tap sur « Afficher les coordonnées », restent dans l'état mémoire de la page, affichent le filigrane serveur et sont effacées en masquant ou quittant l'écran. Les 429 de consultation ont un message dédié. Le rapport et la déclaration de perte sont accessibles depuis les dossiers; seules les actions permises par l'état serveur sont proposées et `CLOSING_REPORTED` est en lecture seule. Le formulaire transmet `null` uniquement pour un champ effacé, omet les champs inchangés et restaure le brouillon depuis le serveur.
- **Étape 9C, TEMPS 1 backend** : routes dashboard, dossiers prêts à signer, alertes, statut de vérification de chaîne et pagination de la file livrées et testées par HTTP sur `bases_test`. Autorisation admin/TOTP, expurgation, pagination, parité des compteurs et AuditLog sont couverts. La vérification nocturne ne peut écrire son résultat que sous le bail actif du scheduler.
- **Étape 9C, lot frontend 1–2** : tableau de compteurs, files paginées, fiche et décision admin livrés sur les routes existantes. L’écran des commissions utilise la route paginée avec `total`; TOTP frais, pièces en téléchargement `no-store`, récapitulatif explicite et adaptation 360 px sont couverts. Voir les limites ouvertes sur les dérogations ci-dessous.
- **Étape 9C, lot frontend 3–4** : flux de signature depuis la file prête à signer, paiement paginé des commissions et export CSV sont branchés aux routes existantes. Voir les comportements après succès/erreur et les limites de reçu dans la section 8.
- **Étape 9C, lot frontend 5–7** : arbitrage des litiges et commissions `ON_HOLD`, journal d’audit avec filtres/export et vérification de chaîne, scores/alertes et actions TOTP de suspension/réactivation branchés aux routes existantes. Voir les limites API avant production à la section 9.
- **Étape 9C, lot serveur préproduction** : filtre `DISPUTED` et champs de litige sur `/deals`, liste paginée/auditée de toutes les dérogations, motif exigé à la réactivation, pagination de `/trust` sans coordonnées et liste paginée des agents actifs pour la réattribution. Intégration testée sur `localhost/bases_test`; aucune migration.
- **Application locale à `cominnovt`** : `server/.env.local` désactive le scheduler et est configuré pour Mailpit uniquement (`127.0.0.1:1025`, expéditeur `example.invalid`); Mailpit n'est pas installé/disponible et son port ne répond pas. Ne pas redémarrer l'API avec un lanceur qui active le scheduler ou le SMTP réel sans vérifier sa configuration. Hôte DB `localhost`, `SELECT DATABASE()` retourne `cominnovt`; les 8 migrations collaboration initiales ont été déployées après présentation du statut et accord explicite. La migration `20261106040000_close_signed_prospects` a ensuite été appliquée après accord explicite; les 24 migrations sont à jour. La clé aléatoire AES-256 est stockée uniquement dans `server/.env.local`, sans affichage. Contrôle agrégé : l'unique rapport est chiffré (`v1:` pour adresse, téléphone et email); les 2 lignes legacy de `prospect_contacts` restent en clair, conformément au choix de les laisser inchangées. L'aperçu LEAD trouvait 1 candidat (rapport 1, `SOUMIS`); après validation, le backfill a créé le dossier 1, batch `e9ecc4bb-ff4e-420c-83c9-1e53f3ff1f7b`.
- **Comptes locaux de test** : admin ID 6 (`collab-admin-86a91957@example.invalid`), agents A/B/C IDs 7/8/9 (`collab-agent-a-86a91957@example.invalid`, `collab-agent-b-86a91957@example.invalid`, `collab-agent-c-86a91957@example.invalid`). Les mots de passe aléatoires sont dans le fichier local ignoré `.test-collaboration-accounts-86a91957.json`, jamais dans le code ou les journaux. TOTP de l'admin reste à enrôler depuis un terminal interactif avec le script local avant les actions admin.
- **À faire** : étape **10**. Aucun point serveur de la demande de préproduction ne reste ouvert.

## 3. Règles de travail et de sécurité

1. Le serveur est l'autorité pour les permissions, les transitions, les quotas et les décisions. Le masquage des données sensibles est appliqué par le backend.
2. Ne jamais placer les coordonnées dans `localStorage`, les journaux applicatifs ou une URL. Les coordonnées ne sont chargées qu'après une action explicite et un contrôle serveur.
3. Ne créer ni appliquer de migration sans l'accord explicite de l'utilisateur pour la base ciblée; si l'accord est conditionné à une étape préalable, s'arrêter à cette étape et présenter son résultat.
4. Ne jamais utiliser `migrate reset` ni `db push --force-reset`.
5. Avant chaque commande dépendant d'une base, vérifier l'hôte et le nom de base. Les tests d'intégration restent réservés à **`localhost/bases_test`**. Toute opération sur une autre base doit être explicitement autorisée et strictement limitée à son objet.
6. Présenter un plan court avant de coder. Demander confirmation avant de modifier un élément existant important.
7. Respecter les permissions à la fois par rôle et par objet, les protections TOTP des opérations administratives et les journaux d'audit.

## 4. Endpoints présents dans le code

Les routes authentifiées et publiques sont montées dans `server/src/app.ts`. Les chemins ci-dessous sont les chemins effectifs, avec leur méthode HTTP.

### Agent — `/api/collaboration`

| Méthode | Chemin | Usage |
|---|---|---|
| GET | `/prospects` | Prospects disponibles; les signés non concernés apparaissent en `CLOSED_SIGNED`, expurgés |
| POST | `/prospects/:dealId/hide` | Retirer de sa liste un prospect signé (idempotent, non-participant uniquement) |
| GET | `/closer/accesses` | Dossiers approuvés, actifs et signés du closeur connecté, sans coordonnées |
| GET | `/mine` | Détail/accès associé à l'agent selon les contrôles du serveur |
| GET | `/supplied` | Dossiers du fournisseur connecté, vue masquée |
| GET | `/:dealId` | Détail du dossier et coordonnées après autorisation et contrôle du quota |
| GET | `/access-requests/pending` | Demandes en attente des dossiers du fournisseur connecté |
| GET | `/:dealId/access-requests` | Demandes d'accès à un dossier et profil du demandeur |
| POST | `/:dealId/access-requests` | Demander l'accès à un prospect |
| PATCH | `/access-requests/:requestId` | Décision du fournisseur sur une demande |
| GET | `/:dealId/closing-report` | Rapport de clôture du closeur autorisé |
| PUT | `/:dealId/closing-report/draft` | Enregistrer un brouillon; `null` efface un champ, champ omis inchangé |
| POST | `/:dealId/closing-report/attachments` | Ajouter une pièce au brouillon |
| POST | `/:dealId/closing-report/submit` | Soumettre le rapport |
| POST | `/:dealId/closing-report/supplements` | Ajouter un complément tracé après soumission |
| POST | `/:dealId/lost` | Déclarer le prospect perdu avec un motif autorisé |
| POST | `/:dealId/disputes` | Contester un résultat |
| GET | `/:dealId/timeline` | Frise fournisseur ou closeur concerné, avec numéro de vente après signature |

### Confirmation client et pièces publiques

| Méthode | Chemin | Usage |
|---|---|---|
| GET | `/api/collaboration/public/confirmations/:publicToken` | Vérifier un lien de confirmation opaque |
| POST | `/api/collaboration/public/confirmations/:publicToken/respond` | Confirmer ou nier avec le code |
| GET | `/api/collaboration/public/files/:evidenceId` | Télécharger une pièce via URL signée à durée limitée |

### Commissions d'agent — `/api/collaboration/commissions`

| Méthode | Chemin | Usage |
|---|---|---|
| GET | `/me` | Commissions de l'agent authentifié |
| GET | `/me/summary` | Récapitulatif des commissions de l'agent |

### Administration collaboration — `/api/admin/collaboration`

Ces routes requièrent un rôle administrateur; les opérations sensibles exigent le TOTP selon le code.

| Méthode | Chemin | Usage |
|---|---|---|
| POST | `/2fa/enroll/start` | Commencer l'enrôlement TOTP |
| POST | `/2fa/enroll/verify` | Vérifier et activer l'enrôlement TOTP |
| GET | `/trust` | Scores paginés (total, score/date, nom et statut), sans email ni composants de calcul |
| GET | `/agents/active` | Agents actifs paginés (ID et nom), pour la réattribution |
| GET | `/dashboard` | Compteurs agrégés filtrables par agent et période |
| GET | `/alerts` | Alertes de contournement, extraction et expirations répétées, filtrables et paginées |
| GET | `/deals` | Liste administrative filtrable et paginée; `?status=DISPUTED` renvoie le motif tronqué à 200 caractères et la date du litige |
| GET | `/deals/overrides` | Tous les dossiers avec motif de dérogation, tous statuts, paginés et audités |
| GET | `/deals/ready-to-sign` | Ventes confirmées paginées avec indicateurs de prérequis |
| GET | `/deals/:dealId` | Détail administratif pour vérification |
| PATCH | `/deals/:dealId/hidden-agents/:agentId/restore` | Restaurer dans la liste un prospect masqué par un agent |
| PATCH | `/deals/:dealId/decision` | Décision administrative sur le dossier |
| POST | `/deals/:dealId/signature` | Enregistrer et signer le contrat |

### Administration des commissions — `/api/admin/collaboration`

Les routes administratives de commissions requièrent TOTP.

| Méthode | Chemin | Usage |
|---|---|---|
| GET | `/commissions` | Liste filtrable |
| GET | `/commissions/pending` | Commissions à payer |
| GET | `/commissions/export.csv` | Export CSV protégé |
| GET | `/commissions/reconciliation` | Vérifier les commissions attendues par vente signée |
| GET | `/commissions/events` | Événements de génération et erreurs |
| GET | `/commissions/email-failures` | Échecs d'envoi des reçus |
| POST | `/commissions/:commissionId/pay` | Enregistrer un paiement et sa preuve éventuelle |
| PATCH | `/commissions/:commissionId/decision` | Libérer, annuler ou réattribuer selon les règles |
| POST | `/commissions/:commissionId/adjustments` | Ajouter un ajustement tracé |
| POST | `/deals/:dealId/disputes` | Ouvrir un litige administratif |
| POST | `/deals/:dealId/dispute-resolution` | Résoudre un litige |
| GET | `/commissions/summary` | Totaux administratifs |
| GET | `/commissions/:commissionId` | Détail d'une commission |

### Audit administratif — `/api/admin/collaboration/audit`

| Méthode | Chemin | Usage |
|---|---|---|
| GET | `/` | Consulter le journal avec filtres |
| GET | `/export.csv` | Exporter le journal |
| GET | `/verification` | Dernier résultat de vérification de chaîne (`UNKNOWN`, `STALE`, `VALID` ou `BROKEN`) |

### Interfaces administrateur — étape 9C, lot 5–7

- **Litiges** : la file utilise `GET /api/admin/collaboration/deals?status=DISPUTED`, inclut les dossiers sans commission et expose un motif limité à 200 caractères ainsi que la date du dernier passage à `DISPUTED`. Le motif complet reste dans la fiche. Les commissions `ON_HOLD` viennent de `GET /api/admin/collaboration/commissions?status=ON_HOLD&page=…&limit=100`; la résolution reste désactivée tant que toutes les pages ne sont pas chargées et qu’une commission du dossier est encore retenue. L’interface recharge l’état avant une décision et exige motif, récapitulatif et TOTP frais pour `RELEASE`, `CANCEL`, `REASSIGN` et la résolution du litige. `CANCEL` est signalée comme irréversible; `REASSIGN` récapitule l’agent actuel et le nouvel agent.
- **Audit** : `GET /api/admin/collaboration/audit` est paginé et filtre acteur, objet, action et période. Les filtres de dates couvrent la journée calendaire complète à Antananarivo. L’export `GET /api/admin/collaboration/audit/export.csv` est téléchargé en mémoire avec TOTP frais et avertissement. `GET /api/admin/collaboration/audit/verification` affiche `BROKEN` en rouge avec bannière; `STALE` et `UNKNOWN` sont orange; seul `VALID` est vert. Le statut apparaît sur le tableau de bord après vérification explicite.
- **Agents** : `GET /api/admin/collaboration/trust` est paginée avec total; la réponse contient nom, statut, score et date, sans email ni composants du score. `GET /api/admin/collaboration/alerts` filtre type, agent et période. `GET /api/admin/collaboration/agents/active` fournit la liste paginée des choix de réattribution. Les propositions ne sont jamais exécutées automatiquement. `PATCH /api/admin/agents/:id/status` exige maintenant un motif serveur pour suspendre et réactiver.
- **Routes manquantes / limites** : aucun endpoint demandé par le lot serveur préproduction ne manque. Les routes de lecture restent réservées aux administrateurs avec TOTP, rate limit et AuditLog. `/deals/overrides` est déclaré avant `/deals/:dealId`; il couvre tout statut dès lors que `clientConfirmationOverrideReason` n’est pas nul. Les réponses évitent coordonnées, hashes, montants de vente et contenu de pièces.
- **Validation frontend** : build TypeScript/Vite réussi; lint ciblé réussi; 5 tests utilitaires ciblés réussis (statuts chaîne, garde de résolution, bornes de dates Antananarivo et règles de fichiers). Le projet ne définit pas de runner UI/E2E; le contrôle visuel complet des vues protégées à 360 px reste à faire.
- **Validation backend de ce lot** : `DATABASE_URL` de `server/.env.test` vérifiée avant exécution (`localhost/bases_test`). Le test d’intégration admin ciblé passe (1/1); il couvre non-admin et admin sans TOTP, réponses expurgées, pagination sans doublon/omission et limite 50, parité avec les listes, états `UNKNOWN`/`STALE`/`VALID`/`BROKEN`, AuditLog, motif requis aux deux transitions et ciblage de l’agent actif. La suite serveur complète n’a pas été relancée dans ce lot.
- **Changements** : backend et frontend, aucun schéma ni fichier de migration modifié ou appliqué.

## 10. Clôture des prospects après signature

- La transition vers `CONTRACT_SIGNED` ferme dans la même transaction toutes les demandes `PENDING` en `CLOSED_SIGNED`, efface leur `pendingKey`, annule les courriels collaboration en attente/en cours et crée exactement une notification informative par demandeur. Le worker ignore ensuite les tâches email annulées.
- Une nouvelle demande, l’acceptation d’une demande, les opérations de rapport de clôture et la déclaration « perdu » renvoient HTTP 409 avec `Prospect déjà signé` lorsque le dossier est signé. Les transitions `LOST` et `EXPIRED` restent redemandables; les agents ayant déjà demandé l’accès reçoivent une notification unique pour chaque transition de remise à disposition.
- `/api/collaboration/prospects` expose aux agents non concernés une entrée générique de statut `CLOSED_SIGNED`, sans coordonnées, montants, identifiants de fournisseur, demandes, ni numéro de vente. `POST /api/collaboration/prospects/:dealId/hide` masque le dossier pour l’agent authentifié; l’écriture est idempotente et ne peut pas cibler un autre agent. La restauration est réservée à l’admin avec TOTP via `/api/admin/collaboration/deals/:dealId/hidden-agents/:agentId/restore`.
- A (fournisseur) conserve sa frise. B (closeur attribué) conserve sa frise, le numéro de vente et l’accès à ses commissions; les écrans signés ne proposent plus d’action de clôture ni de consultation de coordonnées. Les cartes des prospects signés et leurs actions sont responsives à 360 px.
- Les tests unitaires couvrent la disponibilité après `LOST`/`EXPIRED` et l’absence d’actions de clôture sur un état signé. Les tests d’intégration couvrent les refus 409, l’expurgation JSON, le masquage idempotent/isolé par agent, la restauration admin TOTP et la fermeture atomique à la signature. Builds serveur/client, 13 tests unitaires et les suites d’intégration agent/admin ont réussi sur `localhost/bases_test`; les fichiers d’intégration doivent être lancés séquentiellement.
- **Migration `20261106040000_close_signed_prospects`** : le SQL a été présenté et approuvé, puis appliqué à `localhost/bases_test` et, après autorisation distincte, à `localhost/cominnovt`. Elle ajoute `CLOSED_SIGNED` à `collaboration_access_requests.status`, `CANCELLED` à `collaboration_email_jobs.status` et crée `collaboration_hidden_deals`. Elle n’a pas été appliquée en production.
- **Incident local du 2026-11-06** : la route `/api/collaboration/prospects` échouait car la table `collaboration_hidden_deals` manquait dans `cominnovt`. Après migration et redémarrage de l’API afin de recharger le client Prisma régénéré, le contrôle HTTP local répond 200. L’instance redémarrée utilise `localhost/cominnovt` avec scheduler et SMTP désactivés; les envois email ne fonctionneront pas dans cette instance.

## 5. Migrations présentes dans le dépôt (24)

1. `20260924083132_init`
2. `20261026123000_application_password_hash`
3. `20261026150000_community_replies_and_private_chat`
4. `20261101144608_tysynday`
5. `20261104113559_rapport_commission`
6. `20261104140500_agent_profile_image_url`
7. `20261104143000_agent_report_types_and_commissions`
8. `20261104144000_custom_service_reports`
9. `20261104160000_agent_registration_email_otp`
10. `20261104170000_external_agent_notifications`
11. `20261104180000_remove_external_agent_notifications`
12. `20261104183700_prospect_contacts`
13. `20261104190000_browser_push_notifications`
14. `20261104204000_agent_badge_subscriptions`
15. `20261104205000_subscription_duration_snapshot`
16. `20261104230000_collaboration_prospect_foundation`
17. `20261104234000_encrypt_report_contact_data`
18. `20261104240000_collaboration_email_queue`
19. `20261105000000_collaboration_closing_review`
20. `20261105000600_collaboration_commissions`
21. `20261106010000_collaboration_audit_trust`
22. `20261106020000_collaboration_schema_drift`
23. `20261106030000_collaboration_public_confirmation_token`
24. `20261106040000_close_signed_prospects`

## 6. Tests présents dans le code (14 fichiers)

Les tests de collaboration sont dans `server/src/modules/collaboration/`. Le répertoire contient 14 fichiers de tests; certains tests d'intégration sont conditionnels à `DATABASE_URL`.

| Fichier | Couverture principale |
|---|---|
| `admin-totp.test.ts` | Validation TOTP et rejet de la réutilisation d'un code |
| `client-confirmation.guard.test.ts` | Hachage HMAC, expiration, tentatives et blocage temporaire |
| `client-confirmation.public-token.test.ts` | Entropie du jeton public, comparaison et validation des entrées |
| `collaboration.agent-views.integration.test.ts` | Cloisonnement fournisseur/closeur, réponses masquées, score, cooldown, quota concurrent, déduplication, brouillon et confirmation publique |
| `collaboration.admin.routes.integration.test.ts` | Accès admin/TOTP, expurgation, pagination, parité dashboard/listes, états de chaîne et AuditLog |
| `collaboration.audit-chain.test.ts` | Chaînage, compatibilité historique, détection de modification/suppression et fuseau local |
| `collaboration.audit-verification.test.ts` | États et ancienneté du résultat de vérification de chaîne |
| `collaboration.commissions.integration.test.ts` | Génération et paiement concurrents; base de test seulement |
| `collaboration.commissions.policy.test.ts` | Montants figés, prérequis, unicité, transitions et litiges |
| `collaboration.files.test.ts` | Hash SHA-256, durée des liens signés et format des codes |
| `collaboration.policy.test.ts` | Permissions par rôle/objet, accès, transitions, confirmation et signature |
| `collaboration.timeline.test.ts` | Champs de frise et visibilité du numéro de vente après signature |
| `collaboration.trust-score.test.ts` | Formule du score, pénalités et validation des entrées |
| `report-pii.test.ts` | Chiffrement, intégrité, empreintes et sérialisation masquée |

Les deux fichiers d'intégration utilisent des données persistantes et des entrées d'audit append-only. Vérifier la cible `DATABASE_URL` avant de les lancer; utiliser exclusivement `localhost/bases_test` et ne pas compter sur la suppression des audits de test. Lancer les deux fichiers séquentiellement : leur exécution parallèle peut faire varier les totaux de pagination des agents pendant les assertions.

Le frontend contient des tests utilitaires pour le brouillon, l'affichage/formatage de collaboration, le tri prioritaire et les règles fichier/date des actions admin (`client/src/utils/admin-collaboration-queue.test.ts`, `client/src/utils/admin-collaboration-workflows.test.ts`). Le projet frontend ne définit pas de runner de tests UI composant/E2E.

## 7. Décisions et points ouverts après le raccordement 9B

- L'ouverture de **Mes accès** ne fait qu'un GET de liste masquée; elle ne déclenche jamais `GET /api/collaboration/:dealId` et ne consomme donc pas le quota de coordonnées. La route de liste a été vérifiée dans le test d'intégration dédié qui compare les compteurs avant/après.
- Le GET de détail est explicitement déclenché par l'utilisateur. Aucun téléphone/email/adresse n'est mis dans une URL, un stockage persistant ou un journal frontend; quitter l'écran ou masquer les coordonnées détruit l'état de cette page.
- `supplierTrustScore` et `nextRequestAt` restent affichés dans **Prospects disponibles** depuis la réponse serveur. Les demandes d'accès restent soumises à la décision serveur.
- Aucun endpoint, schéma ou fichier de migration n'a été ajouté ou modifié pour ce raccordement frontend.
- Les migrations recensées ci-dessus sont les migrations présentes dans le dépôt, pas une preuve de l'état d'une base.

## 8. Étape 9C — TEMPS 1 backend et lots frontend 1–4

- **Navigation** : entrée `Vérification des ventes` dans la navigation admin.
- **Dashboard** : `GET /api/admin/collaboration/dashboard` fournit les huit compteurs. Chaque compteur ouvre une file ciblée.
- **File de vérification** : `GET /api/admin/collaboration/deals` filtre les statuts `CLOSING_REPORTED`, `CONFIRMED_BY_CLIENT`, `CLIENT_CONFIRMED`, `NO_RESPONSE` et `DISPUTED`; pagination maximale 50, total exact et ordre serveur stable `updatedAt, id`. Le frontend met en évidence et trie les litiges au sein de la page chargée.
- **Prêt à signer** : `GET /api/admin/collaboration/deals/ready-to-sign` renvoie les dossiers `CONFIRMED` paginés et leurs prérequis.
- **Alertes** : `GET /api/admin/collaboration/alerts` filtre par agent, période et type (`BYPASS`, `EXTRACTION`, `REPEATED_EXPIRATIONS`); résultat paginé et expurgé de coordonnées, empreintes et montants.
- **Commissions** : le compteur ouvre `GET /api/admin/collaboration/commissions?status=PENDING&page=…&limit=50`, qui fournit un total paginé. L'interface n'utilise pas `/commissions/pending`, plafonnée à 500 sans total.
- **Vérification de chaîne** : `GET /api/admin/collaboration/audit/verification` renvoie `UNKNOWN` sans résultat valide, `STALE` au-delà de 36 heures, sinon `VALID` ou `BROKEN`. Le scheduler écrit un résumé minimal uniquement lorsque son bail est actif.
- **Fiche** : `GET /api/admin/collaboration/deals/:dealId`, protégée par rôle admin et TOTP. L'interface affiche le rapport, les pièces, l'état de confirmation client, l'historique et les scores des deux agents. Les pièces utilisent `fetch` avec `cache: no-store`; les URL objet temporaires sont révoquées après téléchargement.
- **Décision** : `PATCH /api/admin/collaboration/deals/:dealId/decision`, protégée par rôle admin et TOTP. Le récapitulatif explicite est affiché avant l'activation de la confirmation finale. Le rejet et la dérogation client sont motivés; le motif d'une dérogation enregistrée reste affiché.
- **Signature** : la file paginée `/deals/ready-to-sign` affiche `canSign` et `blockers`. `POST /api/admin/collaboration/deals/:dealId/signature` exige référence, date, fichier PDF/JPEG/PNG/WebP (10 Mio maximum) et TOTP frais. Le récapitulatif précède la signature; le numéro de vente est pris directement dans sa réponse et affiché sans nouvel appel. Après clic explicite « Voir le hash », un TOTP frais permet de charger le détail `/deals/:dealId` et l’empreinte du fichier. Succès désactive toute nouvelle soumission dans la page. En erreur réseau, aucun renvoi automatique : l’interface demande de recharger la file avec un nouveau TOTP. HTTP 409 est présenté comme déjà signé, sauf correspondance de contact signalée explicitement par l’API.
- **Paiement commissions** : `/commissions?status=PENDING&page=…&limit=50` fournit les pages avec total et tri d’ancienneté. `POST /commissions/:commissionId/pay` reçoit le mode, la référence obligatoire, la date et une preuve facultative (PDF/JPEG/PNG/WebP, 10 Mio maximum). Le récapitulatif agent/rôle/montant/mode/référence précède le TOTP frais et le paiement. Le code est effacé avant l’appel et un verrou empêche les doubles requêtes. En cas d’erreur réseau, pas de nouvel envoi automatique; l’interface demande de recharger la liste. Un 409 est montré comme référence déjà utilisée, paiement déjà effectué ou commission mise en attente.
- **Reçu et export CSV** : le paiement déclenche la mise en file du reçu e-mail existant; l’interface affiche une confirmation/récapitulatif de paiement local. Aucun endpoint de téléchargement de reçu PDF individuel n’existe. L’export utilise `GET /api/admin/collaboration/commissions/export.csv` avec TOTP frais et avertissement « données financières »; Blob/URL objet sont en mémoire et l’URL est révoquée après le téléchargement, sans stockage applicatif persistant.
- **TOTP** : un code frais est requis pour chaque requête protégée (le serveur empêche la réutilisation). Le formulaire l'efface avant l'appel et l'envoie dans `x-admin-totp`, jamais dans l'URL, le stockage persistant ou un journal frontend. Après un refus, les champs métier sont conservés et un nouveau code est demandé.
- **État des routes** : les cinq besoins du TEMPS 1 et les ajouts du lot préproduction sont implémentés. Les lectures sont soumises au rôle admin, TOTP, rate limit et AuditLog. `/deals` utilise les filtres partagés avec le dashboard, un total exact et une pagination stable; `status=DISPUTED` ajoute le motif tronqué et la date de litige.
- **Dérogations** : `GET /api/admin/collaboration/deals/overrides` est déclaré avant `/deals/:dealId`, inclut tous les statuts avec `clientConfirmationOverrideReason` non nul et renvoie motif, date, admin, fournisseurs et closeurs sans coordonnées/hash/montants/contenu de pièces. La liste est paginée, filtrable par agent/période, et auditée.
- **Motif de statut agent** : l’écran Agents envoie `status` et `reason` dans le corps de `PATCH /api/admin/agents/:id/status` aussi bien pour `ACTIF` que `SUSPENDU`; il exige un motif d’au moins 10 caractères, un récapitulatif et un TOTP. Le serveur refuse le motif absent ou trop court pour les deux transitions; le contrôle admin et TOTP reste côté serveur.
- **Pagination de confiance et réattribution** : l’écran Agents appelle `/api/admin/collaboration/trust?page=…&limit=50`, affiche `pagination.total` et les pages, et utilise les lignes paginées; `/api/admin/collaboration/agents/active` renvoie les noms et identifiants des seuls agents actifs, avec pagination. Chaque lecture est auditée.
- **Tests/validation backend** : suite complète des tests de collaboration (unitaires et intégration), 14 fichiers exécutés en série sur `localhost/bases_test` après chargement explicite et vérification de `server/.env.test` : **52 tests réussis, 0 échec, 0 ignoré**. Les tests HTTP couvrent non-admin et admin sans TOTP, expurgation, pagination sans doublon/omission et limite à 50, parité dashboard/listes, états `UNKNOWN`/`STALE`/`VALID`/`BROKEN`, AuditLog et refus des changements de statut sans motif.
- **Tests/validation frontend lot 1–2** : build TypeScript/Vite réussi; lint ciblé réussi; 8 tests utilitaires ciblés réussis. CSS responsive à 360 px; vérification visuelle composant/E2E non exécutée, car aucun runner UI n'est défini.
- **Tests/validation frontend lot 3–4** : build TypeScript/Vite réussi; lint ciblé réussi; **10 tests utilitaires ciblés réussis**, incluant validation des formats/taille de fichier et interprétation de date Indian/Antananarivo. Aucun runner de tests UI composant/E2E n’est configuré.
- **Données de test** : les tests d'intégration créent des utilisateurs et dossiers synthétiques persistants dans `bases_test`; les traces d'audit append-only sont conservées. Ne pas lancer ces tests contre une autre base.
- **Migrations et vérifications locales** : les 8 migrations collaboration ont été appliquées à `cominnovt` après accord; `prisma migrate status` est à jour. Réconciliation des commissions : **0 dossier signé avec anomalie**. Chaîne d'audit : **VALID**, séquence `0` avant l'enrôlement TOTP de l'admin.
- **Chiffrement/backfill local** : le rapport 1 a été chiffré puis converti en dossier de collaboration; conserver `server/.env.local` comme secret local indispensable au déchiffrement. Les 2 lignes `prospect_contacts` n'ont pas été modifiées et restent à traiter séparément si nécessaire.
- **À faire** : étape 10. Aucun besoin du lot serveur préproduction ne reste ouvert.
