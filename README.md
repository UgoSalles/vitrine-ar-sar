# Vitrine AR/SAR

Appli web (PWA) pour suivre sa collection de cartes Pokémon **Illustration rare (AR)** et **Illustration spéciale rare (SAR)**.

- **Toutes les cartes** : les 1025+ Pokémon par n° de Pokédex (noms FR), nombre de cartes AR/SAR, ouverture → cartes, extension, cote Cardmarket, case à cocher.
- **Ma collection** : tes cartes rangées par n° de Pokédex, valeur totale.
- **Cartes incluses** : AR et SAR (Écarlate & Violet → Méga-Évolution, automatique), plus les anciennes « Pokémon dans un décor » : illustrations alternatives V/VMAX/GX (Soleil & Lune, Épée & Bouclier — badge ALT, liste fixe `data/legacy-alt.json`) et Galeries de Dresseurs / Galaroise (badge GAL, `data/legacy-gallery.json`, images en anglais car absentes de la base FR).
- **Promos illustrées** (badge PRM, `data/legacy-promo.json`) : promos Écarlate & Violet / Méga-Évolution en pleine illustration (Pokémon Center, 30ᵉ anniversaire…), triées à l'œil.
- **Mises en scène** (badge SCÈNE, `data/legacy-scenes.json`) : cartes pleine illustration où le Pokémon n'est pas seul — duos GX / Tag Team (Soleil & Lune), Pikachu/Amphinobi/Mewtwo/Zacian/Morpeko V-UNION, et les ex avec leur dresseur en arrière-plan (Zoroark-ex de N, Mewtwo-ex de la Team Rocket…).
- **Carte manquante ?** Dans la fiche d'un Pokémon, bouton « ＋ Il manque une carte ? » : liste toutes les cartes de ce Pokémon dans la base ; celle qu'on choisit est ajoutée à sa liste (badge PERSO, stockée sur l'appareil).
- **Nouvelles extensions** : le catalogue est relu à chaque ouverture depuis TCGdex ; les nouvelles cartes apparaissent toutes seules au bon Pokémon.
- **Prix** : cote Cardmarket (tendance, €), rechargée à chaque ouverture (Cardmarket met à jour ~1×/jour).
- Chaque personne a sa collection **sur son propre téléphone** (bouton ⋯ → exporter / importer pour la sauvegarder).

## Tester en local
    python3 -m http.server 5173     # puis http://localhost:5173

## Mettre en ligne (nécessaire pour l'installer sur un téléphone, HTTPS obligatoire)
Dossier 100 % statique, aucun build : Netlify (glisser-déposer le dossier), Cloudflare Pages ou GitHub Pages.
Ensuite : ouvrir le lien sur le téléphone → *Partager → Sur l'écran d'accueil* (iPhone) / *Installer l'appli* (Android).

`node scripts/make-icons.mjs` régénère les icônes.
