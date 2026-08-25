# Analyseur FIT — version Android (web app installable)

Version mobile de l'analyseur de sorties cyclisme : mêmes calculs, même
éditeur de montée interactif, mêmes graphiques que la version desktop —
portés pour tourner directement dans le navigateur de ton téléphone, sans
rien installer depuis le Play Store.

**100 % hors ligne une fois installée.** Tes fichiers `.fit` et tout ton
historique restent uniquement sur ton téléphone (stockage local du
navigateur). Rien n'est envoyé sur Internet, à aucun moment.

---

## ⚠️ Un déploiement est nécessaire avant de pouvoir l'installer

Contrairement à l'appli desktop (un simple dossier à double-cliquer), une
web app installable a une contrainte technique incontournable : **le
fonctionnement hors ligne et l'installation sur l'écran d'accueil
nécessitent que les fichiers soient servis en HTTPS.** Ouvrir `index.html`
directement depuis le stockage du téléphone (`file://`) ne suffit pas — le
navigateur bloque le mode hors ligne dans ce cas.

La bonne nouvelle : héberger ces fichiers statiques est gratuit et prend
environ 2 minutes, sans avoir besoin de gérer un serveur.

### Option recommandée — GitHub Pages (gratuit, permanent)

1. Crée un dépôt GitHub (public ou privé) et mets-y tout le contenu de ce
   dossier `fit_analyzer_web`.
2. Dans le dépôt : **Settings → Pages → Source : Deploy from a branch**,
   choisis la branche `main` et le dossier `/ (root)`.
3. GitHub te donne une adresse du type
   `https://tonpseudo.github.io/nom-du-depot/`. Ouvre-la sur ton téléphone.
4. Chrome Android propose alors d'installer l'appli (bandeau en bas de
   l'écran), ou : menu ⋮ → **Ajouter à l'écran d'accueil**.

### Option alternative — Netlify Drop (encore plus rapide, sans compte)

1. Depuis un ordinateur, va sur **[app.netlify.com/drop](https://app.netlify.com/drop)**.
2. Glisse-dépose le dossier `fit_analyzer_web` entier sur la page.
3. Une adresse HTTPS est générée immédiatement. Ouvre-la sur ton téléphone.

*(Un site créé sans compte sur Netlify Drop reste en ligne mais n'est pas
lié à un compte — crée un compte gratuit si tu veux pouvoir le retrouver et
le mettre à jour facilement plus tard.)*

### Pour tester rapidement sans déployer (fonctionnalités limitées)

```bash
cd fit_analyzer_web
python3 -m http.server 8000
```

Puis, sur ton téléphone connecté au **même réseau Wi-Fi**, ouvre
`http://<adresse-IP-de-ton-ordinateur>:8000` dans Chrome. Ça fonctionne pour
essayer l'appli, mais le mode hors ligne et l'installation sur l'écran
d'accueil ne s'activeront probablement pas (contrainte HTTPS ci-dessus).

---

## Installer sur l'écran d'accueil (une fois hébergée en HTTPS)

1. Ouvre l'adresse HTTPS dans **Chrome** sur ton téléphone.
2. Un bandeau "Installer l'appli" apparaît automatiquement (ou : menu ⋮ →
   **Ajouter à l'écran d'accueil**).
3. Une icône apparaît sur ton écran d'accueil, comme une appli normale.
   Elle s'ouvre en plein écran, sans barre d'adresse.
4. À partir de là, plus besoin de connexion : tout fonctionne hors ligne.

---

## Modifier ton profil (poids, FTP...) et tous les réglages de calcul

**Absolument tout** ce qui était dans `config.py` côté desktop — profil
physiologique, zones cardiaques, seuils de détection des montées, filtrage
du temps mobile, modèle physique de puissance — vit dans **un seul fichier
séparé**, `config.local.js`, à la racine du projet. Volontairement **pas**
compilé dans `js/app.bundle.js`, pour pouvoir tout éditer sans jamais avoir
besoin de relancer `npm run build`.

**Sur GitHub :**
1. Ouvre le dépôt, clique sur `config.local.js`.
2. Clique sur l'icône crayon (✏️) en haut à droite du fichier.
3. Modifie les valeurs (poids, FTP, FCmax, seuil de pente des montées...),
   puis **Commit changes** en bas de page.
4. GitHub Pages redéploie automatiquement (1-2 minutes). Recharge l'appli sur
   ton téléphone : les nouvelles valeurs sont prises en compte immédiatement,
   sans réinstallation.

Testé sur les deux catégories de réglages : modifier `CURRENT_FTP_W` change
bien le `% FTP` affiché (123 % → 98 % avec FTP 240 → 300) ; modifier
`CLIMB_MIN_GRADE_PCT` change bien le nombre de montées détectées (4 → 3 en
relevant le seuil de 3 % à 4 %, excluant une montée à 3,6 %) — dans les deux
cas sans toucher au bundle JS (vérifié par hash MD5 identique avant/après).

**Important** : ne modifie **que** ce fichier pour ajuster tes réglages. Si
tu touches à autre chose (un fichier dans `src/`), il faut rebuilder
localement (`npm install && npm run build`) et repousser
`js/app.bundle.js` — sinon le changement ne sera pas pris en compte, seul
`config.local.js` est chargé "tel quel". Si tu supprimes ou commentes une
ligne, la valeur de secours intégrée à l'appli prend le relais
automatiquement (aucun risque de casser l'appli en effaçant une ligne).

---

## Suivi & progression (nouveau)

L'onglet **Progression** regroupe maintenant, du haut vers le bas :

- **Objectif** — nom, date, distance/D+ cibles. Compte à rebours en jours,
  comparé à ta plus longue sortie et ton plus gros D+ enregistrés, pour voir
  d'un coup d'œil le chemin restant.
- **Charge d'entraînement** — CTL (forme longue durée), ATL (fatigue court
  terme), TSB (fraîcheur = CTL − ATL), calculés à partir d'un TSS estimé
  (puissance modélisée × durée, pas de capteur réel). Une sortie dont
  l'intensité moyenne implicite dépasse ce qui est physiologiquement tenable
  sur sa durée est signalée "peu fiable" plutôt que d'afficher un chiffre
  trompeur — le plus souvent ça indique un FTP à ajuster dans
  `config.local.js`. Avec moins de 3 semaines d'historique, CTL/ATL/TSB
  partent de zéro et ne sont pas encore représentatifs — l'appli le signale.
- **Tableau de bord** — volume (sorties, distance, D+, temps, TSS) semaine
  par semaine ou mois par mois, 12 dernières périodes.
- **Montées répétées** — une montée regrimpée sur une autre sortie est
  reconnue automatiquement (point de départ à moins de 300 m + profil
  distance/dénivelé similaire à ±30 %) et suivie individuellement : VAM,
  dérive cardiaque, tendance. **Renommable** (bouton "✎ renommer" sous
  chaque montée répétée) — le nom est rattaché au point géographique de la
  montée, pas à un identifiant temporaire, donc il survit même quand de
  nouvelles sorties changent l'ordre de calcul des segments. Laisser le champ
  vide en renommant efface le nom personnalisé et revient au libellé
  automatique. **Les sorties importées avant l'ajout de cette fonction n'ont
  pas les coordonnées GPS nécessaires — réimporte-les pour qu'elles y
  apparaissent.**

---

## Ce que ça calcule

Identique à la version desktop : stats globales (distance, D+/D−, vitesse,
FC, puissance estimée, puissance normalisée, découplage aérobie, zones
cardiaques), détection automatique des montées avec VAM/dérive
cardiaque/puissance par montée, **éditeur de montée interactif** (glisse les
bornes au doigt directement sur le profil), suivi de progression, et
comparaison de sorties.

**Carte du tracé** (nouveau, seule partie qui a besoin d'Internet) — le tracé
GPS de la sortie s'affiche sur un fond OpenStreetMap, montées surlignées en
rouge, repères départ (A, vert) / arrivée (B, sombre). Les images de carte
(tuiles) sont chargées à la demande et jamais mises en cache : sans
connexion, la carte affiche un fond gris uni plutôt que de planter — tout le
reste de l'appli continue de fonctionner hors ligne normalement.

**Segment plat de référence** — repère automatiquement, sur chaque sortie,
la portion plate (pente ≤ 1,5 % par défaut) la plus longue d'au moins
5 minutes, plafonnée à 20 min pour rester comparable d'une sortie à
l'autre. **Écarte les portions plates mais irrégulières** (trafic urbain,
feux rouges) via un contrôle de régularité de vitesse (coefficient de
variation ≤ 15 % par défaut) — sans ça, un tronçon en ville hacherait la
vitesse moyenne tout en ayant une pente nulle, et fausserait la
comparaison. Affiche vitesse moyenne, FC moyenne, durée, longueur, le
kilomètre de la sortie où ça intervient et le D+ déjà grimpé à ce
moment-là — un indicateur de forme à effort comparable, indépendant du
relief et du trafic du jour. Comparaison inter-sorties dans l'onglet
**Progression** (tableau + graphique de tendance de vitesse). Absent si
aucune sortie ne comporte 5 minutes continues de plat suffisamment
régulier.

Le moteur de calcul est un **port fidèle** du code Python desktop — validé
en comparant les résultats des deux versions sur un vrai fichier `.fit` :
correspondance exacte sur toutes les métriques (distance, D+, puissance
normalisée, découplage aérobie, zones cardiaques, VAM par montée).

---

## Différences avec la version desktop

- **Stockage** : IndexedDB (base de données du navigateur) à la place de
  SQLite. Persiste tant que tu ne vides pas les données du site dans les
  réglages Android/Chrome.
- **Graphiques** : rendus en SVG natif au lieu d'images matplotlib — plus
  net sur les écrans haute densité, mais l'apparence diffère légèrement.
- **Import** : sélecteur de fichiers natif Android (fonctionne avec
  Google Drive, stockage du téléphone, ou toute appli exposant des
  fichiers), au lieu du dialogue desktop.
- **Pas de fichier `config.py`** : le profil physiologique (poids, FTP,
  FCmax...) vit dans `config.local.js` à la racine — voir section dédiée
  ci-dessus pour l'éditer directement sur GitHub sans rebuild.

---

## Structure du projet

```
fit_analyzer_web/
├── index.html                 point d'entrée
├── config.local.js             ⭐ TON PROFIL — éditable directement sur GitHub, sans rebuild
├── manifest.json               métadonnées PWA (icône, nom, couleurs)
├── service-worker.js           mise en cache hors ligne
├── css/style.css               identité visuelle (reprise du desktop)
├── icons/                      icônes d'appli (192/512, versions "maskable")
├── js/
│   ├── app.bundle.js           appli compilée (généré, voir "Rebuild")
│   └── fit-file-parser.bundle.js   bibliothèque de lecture .fit (générée)
├── src/                        code source (modules ES6, avant compilation)
│   ├── config.js                profil physiologique + constantes
│   ├── fitParser.js             lecture .fit -> structure de données
│   ├── analysis.js              stats globales + détection des montées
│   ├── db.js                    IndexedDB (sorties, montées, profil)
│   ├── localApi.js              logique applicative (équivalent api.py)
│   ├── charts.js                graphiques SVG (progression, VAM/FC)
│   ├── svgUtils.js              utilitaires SVG partagés
│   ├── profile.js               profil altimétrique interactif (éditeur)
│   ├── pwa.js                   service worker + invite d'installation
│   └── app.js                   interface (assemble tout ce qui précède)
└── package.json                 scripts de build (npm run build)
```

## Rebuild après modification du code source

```bash
cd fit_analyzer_web
npm install
npm run build      # régénère js/app.bundle.js et js/fit-file-parser.bundle.js
```

Puis redéploie (nouveau push GitHub, ou nouveau glisser-déposer Netlify).

---

## Vérifié, et ce qui ne l'est pas

**Testé réellement** (Chromium en émulation tactile Android, viewport et
user-agent Pixel 7, avec un vrai fichier `.fit`) : import, persistance après
fermeture/réouverture, service worker actif, glissement tactile des bornes
de montée avec recalcul en direct, navigation par barre basse fixe.

**Non testé** : le comportement sur un vrai appareil Android physique, sur
Chrome pour iOS/Safari (l'installation PWA y fonctionne différemment), et le
déploiement GitHub Pages/Netlify lui-même (décrit mais pas exécuté ici,
faute d'accès à un compte). Si l'installation ou le mode hors ligne ne se
déclenche pas après déploiement, vérifie dans Chrome (menu ⋮ → Informations
sur le site) que la connexion est bien reconnue comme sécurisée.
