# Analyseur FIT — version Android (web app installable)

Version mobile de l'analyseur de sorties cyclisme : mêmes calculs, même
éditeur de montée interactif, mêmes graphiques que la version desktop —
portés pour tourner directement dans le navigateur de ton téléphone, sans
rien installer depuis le Play Store.

**100 % hors ligne une fois installée.** Tes fichiers `.fit` et tout ton
historique restent uniquement sur ton téléphone (stockage local du
navigateur). Rien n'est envoyé sur Internet, à aucun moment.

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

---
