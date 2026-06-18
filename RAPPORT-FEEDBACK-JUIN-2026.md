# Rapport d'implémentation — Retours client (juin 2026)

**Plateforme :** Je chemine (Next.js 16 / MongoDB Atlas)
**Branche :** `feat/account-reactivation-rtbf-pro-fixes`
**Pull request :** #7 — 8 commits
**Statut global :** ✅ Implémenté, testé (tests unitaires + bout‑en‑bout sur instance réelle) et poussé.

---

## Résumé

| # | Fonctionnalité | Statut | Commit |
|---|----------------|:------:|--------|
| 1 | Réactivation / désactivation de compte (admin) | ✅ | `5ccf3dd` |
| 2 | Droit à l'oubli (demande de suppression + alertes admin) | ✅ | `5ccf3dd` |
| 3 | Interface pro : motif facultatif + historique des séances | ✅ | `5ccf3dd` |
| 4 | Facturation : aucun reçu officiel avant la confirmation du paiement | ✅ | `ba2193b` |
| 5 | Outil de facturation manuelle (admin, depuis l'horaire) | ✅ | `887576f` |
| 6 | Décaissement professionnels manuel (sans frais Stripe) | ✅ | `23d615d` |
| 7 | Messagerie interne (routage, sécurité, temps réel) | ✅ | `6c09697` |
| 8 | Page des ressources : liens réparés | ✅ | `7dec622` |
| 9 | Filtre « Problématique » sur la liste des patients | ✅ | `6154cbe` |
| 10 | Téléversement d'images du CMS réparé (Vercel) | ✅ | `b47e7d8` |

Chaque fonctionnalité est couverte par des **tests automatisés** (suite complète au vert) et a été **validée en exécutant l'application réelle** (connexion multi‑rôles, flux complets, captures d'écran).

---

## 1. Gestion des comptes — Réactivation / Désactivation

**Demande.** L'envoi d'un nouveau mot de passe depuis l'admin ne réactivait pas un compte désactivé. Ajouter un bouton « Réactiver le compte » qui force la réactivation immédiate.

**Réalisé.**
- Boutons **« Réactiver le compte »** / **« Désactiver le compte »** sur la fiche patient et la fiche professionnel (carte « Accès au compte »).
- La réactivation force `statut : "active"` et efface l'horodatage `deactivatedAt` ; le bouton n'apparaît que pour un compte réellement désactivé.
- Garde de transition côté serveur (on ne peut réactiver qu'un compte inactif, et inversement).

**Fichiers clés.** `src/app/api/admin/users/[id]/account-activation/route.ts`, fiches patient/pro.

**Vérification.** Désactivation → `inactive` + `deactivatedAt` ; réactivation admin → `active` + flag effacé ; le compte **peut se reconnecter** ensuite. Confirmé en direct.

---

## 2. Droit à l'oubli et suppression définitive

**Demande.** Mention légale (contacter support@jechemine.ca), préciser la conservation des factures / données financières, et alerter l'administrateur dès qu'un utilisateur demande une désactivation ou une suppression.

**Réalisé.**
- Section **« Suppression définitive du compte »** dans les paramètres (client et pro) : mention de **support@jechemine.ca** + avis de conservation des factures et données financières.
- Bouton **« Demander la suppression définitive »** (idempotent — une seule alerte par utilisateur).
- Alerte admin sur **deux canaux** : courriel **et** boîte de réception interne (`ExternalMessage`), pour la suppression **et** la désactivation.

**Fichiers clés.** `src/app/api/users/me/request-deletion/route.ts`, `src/lib/account-action-alerts.ts`, `src/lib/notifications.ts` (`sendAdminAccountActionAlert`).

**Vérification.** Demande de suppression → entrée dans la boîte admin + **courriels d'alerte livrés** ; 2ᵉ demande → idempotente (`alreadyRequested`). Confirmé en direct.

---

## 3. Interface professionnel — Rendez‑vous & séances

**Demande.** Rendre le « Motif du rendez‑vous » strictement facultatif et corriger l'affichage de l'« Historique des séances ».

**Réalisé.**
- Le motif est **facultatif** (UI + API `professional/appointments`) : son absence ne bloque plus l'enregistrement de la rencontre.
- Historique des séances corrigé : type de séance **localisé** (Vidéo / En personne / Téléphone) et libellés de statut de paiement complétés, avec valeurs de repli sûres.

**Fichiers clés.** `src/components/appointments/ProfessionalBookAppointmentModal.tsx`, `src/components/dashboard/ClientDetailsModal.tsx`.

---

## 4. Facturation — Aucun reçu avant la confirmation du paiement (règle d'or)

**Demande.** Aucun reçu officiel ne doit être envoyé ni affiché avant la confirmation réelle du paiement.

**Réalisé.**
- L'émission du reçu est **strictement conditionnée** à `payment.status === "paid"` et déplacée vers les points de confirmation : carte enregistrée prélevée à H+0, **webhook Stripe** `payment_intent.succeeded`, et **« marquer comme payé »** Interac.
- Tant que le paiement n'est pas confirmé, le client reçoit une **demande de paiement épurée** (courriel + SMS) portant un **numéro de facture unique** (`JC‑AAAA‑NNNNNN`).
- Émission idempotente ; reçu PDF + entrée comptable créés uniquement au paiement.

**Fichiers clés.** `src/lib/session-post-closure.ts` (`issueFiscalReceipt`), `src/lib/payment-settlement.ts`, `src/app/api/payments/webhook/route.ts`, `src/models/Counter.ts`, `src/lib/invoice-number.ts`.

**Vérification.** Reçu visible côté client **uniquement** après paiement ; numéro de facture généré ; reçu envoyé au moment de la confirmation. Confirmé en direct (facture `JC‑2026‑000001`).

---

## 5. Outil de facturation manuelle (admin, intégré à l'horaire)

**Demande.** Depuis le calendrier d'un professionnel, générer une facture/reçu manuel via un formulaire pré‑rempli et deux actions d'envoi.

**Réalisé.**
- **Point d'entrée :** clic sur une plage horaire ou un rendez‑vous → menu d'action **« Générer une facture/reçu manuel »** (vues jour/semaine/mois).
- **Formulaire contextuel :** date/heure, client (verrouillé si lié à un RDV), professionnel, nature du service (réutilise les motifs de « terminer la rencontre »), montant.
- **Deux actions de sortie :**
  - **« Envoyer une demande de paiement »** → facture en attente + courriel/SMS avec boutons Carte/Interac.
  - **« Enregistrer comme payé et envoyer le reçu »** (mode secours) → marque payé et émet le reçu officiel immédiatement.

**Fichiers clés.** `src/components/billing/ManualInvoiceModal.tsx`, `src/app/api/admin/manual-invoice/route.ts`.

**Vérification.** Action « payé » → rendez‑vous facturable créé, numéro de facture, **reçu payé visible au client**, **crédit au grand livre du pro**, envoi du reçu déclenché. Confirmé en direct.

---

## 6. Décaissement des professionnels — manuel, sans frais Stripe

**Demande.** Gérer les paiements aux pros manuellement (éviter les frais Stripe) ; choix Interac / dépôt direct ; suivi admin du solde dû avec bouton « Marquer comme payé au professionnel ».

**Réalisé.**
- Onglet **« Facturation »** du pro : choix du **mode de versement** — **Virement Interac** (courriel de dépôt) ou **Dépôt direct** (téléversement sécurisé d'un spécimen de chèque PDF/PNG/JPG).
- Texte modifié : retrait de « déposés dans les 2 à 3 jours ouvrables » → **« Les dépôts directs sont traités de façon confidentielle par l'administration selon votre entente. »**
- Côté admin (fiche pro → Grand Livre) : **solde dû** + mode de versement (et lien vers le spécimen), bouton **« Marquer comme payé au professionnel »** qui archive le versement comme écriture de débit.

**Fichiers clés.** `src/components/billing/PayoutMethodSection.tsx`, `src/app/api/upload/payout-cheque/route.ts`, `src/app/api/admin/accounting/professionals/[id]/payout/route.ts`.

**Vérification.** Versement par défaut = solde dû ; débit créé, **solde remis à zéro** ; nouveau versement refusé si rien n'est dû. Confirmé en direct.

---

## 7. Messagerie interne

**Demande.** Réparer la messagerie : les messages client n'apparaissaient pas côté pro, et inversement ; flux à tester, sécuriser et rendre 100 % fonctionnel.

**Réalisé.**
- Vérification du routage et des permissions (un fil porte les deux participants ; recherche limitée au participant). **Tests de sécurité ajoutés** (composition refusée vers un destinataire non autorisé → 403 ; non‑participant → 404).
- Cause réelle du « n'apparaît pas » sur une boîte par ailleurs correcte : absence de rafraîchissement. **Ajout d'un polling** (boîte + fil ouvert toutes les 10 s) → les messages arrivent quasi en temps réel sans rechargement.
- Lecture robuste des compteurs de non‑lus.

**Fichiers clés.** `src/components/inbox/InboxView.tsx`, `src/app/api/messages/route.ts`, tests `messaging-security.spec.ts`.

**Vérification.** Aller‑retour **client → pro → client** complet réalisé en direct : le message apparaît dans la boîte du pro, la réponse apparaît côté client.

---

## 8. Page des ressources — liens réparés

**Demande.** Depuis « En savoir plus » (accueil) → page de présentation ; deux boutons menaient à une page blanche. Les rattacher à la véritable page ressources dynamique (gérée depuis l'admin).

**Réalisé.**
- La page de présentation est **/book** (contient la section dynamique des ressources, `id="resources"`, gérée depuis l'admin).
- Le bouton **« Parcourir les ressources »** pointait vers `/resources` (route inexistante → **404 / page blanche**) → corrigé vers **`/book#resources`**.
- Le bouton **« Explorer les ressources »** pointait déjà correctement ; les deux défilent désormais vers la section des ressources.

**Fichiers clés.** `src/components/sections/client/ClientCTASection.tsx`.

**Vérification.** `/resources` = 404 confirmé ; en direct, les deux boutons résolvent vers `/book#resources` et **font défiler la section ressources à l'écran**.

---

## 9. Filtre « Problématique » sur la liste des patients

**Demande.** Ajouter un filtre de recherche par problématique sur la page admin des patients.

**Réalisé.**
- L'API expose désormais la **vraie problématique** de chaque patient (motif de son rendez‑vous le plus récent — auparavant figée à « General ») et renvoie la liste distincte des motifs pour le menu déroulant.
- Nouveau paramètre `problematique` filtrant **côté serveur** (fonctionne au‑delà de la pagination).
- Menu déroulant **« Toutes les problématiques »** à côté des filtres statut / dossier.

**Fichiers clés.** `src/app/api/admin/patients/route.ts`, page admin des patients.

**Vérification.** En direct : 14 problématiques réelles listées ; filtrer par « Adoption internationale » → 1 résultat.

---

## 10. Téléversement d'images du CMS — réparé (« Upload failed »)

**Demande.** Dans l'éditeur de contenu admin (Nouveautés, Problématiques…), le bouton **« Téléverser une image »** affichait **« Upload failed »**.

**Cause.** L'endpoint écrivait le fichier sur le disque (`public/uploads/…`). Sur Vercel, le système de fichiers est **en lecture seule** → l'écriture échouait (`EROFS`) → erreur 500. Même en cas de succès, le fichier n'aurait pas été servi ni conservé après un redéploiement.

**Réalisé.**
- Les images du CMS sont désormais stockées dans **MongoDB** (`StoredFile`, nouveau type `content-image`) au lieu du disque → fonctionne en serverless et persiste entre les déploiements.
- L'éditeur reçoit une URL `/api/files/[id]`. Cette route sert les **images de contenu publiquement** (elles apparaissent sur des pages publiques), tandis que les autres fichiers (documents patients, chèques) **restent protégés par authentification**.

**Fichiers clés.** `src/app/api/admin/uploads/route.ts`, `src/app/api/files/[id]/route.ts`, `src/models/StoredFile.ts`.

**Vérification.** En direct : téléversement → **200** + URL `/api/files/…` ; image récupérable **sans session** (`image/png`, cache public) ; les fichiers privés restent protégés.

---

## Démarche de vérification

- **Tests automatisés :** `tsc` et `eslint` au vert ; suite complète **au vert** (specs ajoutées pour chaque nouvel endpoint).
- **Exécution réelle :** application lancée sur la base MongoDB réelle ; connexion en **admin / professionnel / client** ; flux d'écriture complets exercés sur des comptes de test (`@test.local`) — facture manuelle → reçu + crédit, versement → débit, demande de suppression → boîte admin + courriel, désactivation → réactivation → reconnexion, aller‑retour de messagerie, téléversement d'image.
- **Captures d'écran** de tous les nouveaux éléments d'interface.
- **Nettoyage :** toutes les données de test créées pendant la validation ont été supprimées.

---

## Points d'attention / actions requises

1. **Identifiant admin faible sur la base réelle :** `admin@admin.com` / `admin123` (super‑admin complet) existe en base — **à changer / supprimer avant la mise en production**.
2. **Boîte courriel / SMTP :** les courriels (reçus, alertes admin, demandes de paiement) nécessitent que le transport SMTP soit configuré et opérationnel (`MAIL_FROM` = support@jechemine.ca + alias d'envoi). Aucun changement de code requis.
3. **SMS de demande de paiement :** nécessite les variables `TWILIO_*` en production (envoi best‑effort — n'échoue jamais la clôture si non configuré).
4. **Webhook Stripe :** doit être abonné à `payment_intent.succeeded` pour l'émission automatique du reçu à la confirmation.
5. **Tableau des patients :** un léger décalage en‑têtes / cellules **préexistant** (indépendant des tâches ci‑dessus) a été laissé tel quel — à corriger séparément si souhaité.

---

## Livraison

- Branche **`feat/account-reactivation-rtbf-pro-fixes`** poussée — **PR #7** (8 commits).
- Les serveurs de développement utilisés pour la validation ont été arrêtés.
