# -*- coding: utf-8 -*-
"""
item_canon.py
=============
Bible visuelle PARTAGEE entre :
  - generate_item_portraits.py  (genere les 12 portraits du picker)
  - generate_story_images.py    (genere les illustrations des histoires)

Chaque item a une description canonique tres precise (couleur, taille,
expression, traits distinctifs). Cette description est injectee dans
TOUS les prompts ou ce personnage / objet / lieu apparait, garantissant
une coherence visuelle entre :
  - L'image card du picker
  - Les 10 pages de la story qui le met en scene
  - Les autres stories ou il reapparait eventuellement

Si on veut faire evoluer le design d'un personnage : on modifie ICI, on
re-genere les portraits + les stories concernees, c'est tout.
"""

# ============================================================
# STYLE COMMUN POUR LES PORTRAITS CARD (picker)
# ============================================================
PORTRAIT_STYLE = (
    "Watercolor children's book illustration, soft Pixar-style, isolated "
    "single subject perfectly centered on aged ivory parchment background "
    "with subtle paper texture and faint warm vignette, soft warm lighting, "
    "clean card-style composition with breathing room around the subject, "
    "no scene, no text, no other elements visible, gentle painterly style, "
    "fairy-tale atmosphere, square 1:1 composition. "
)

PORTRAIT_NEGATIVE = (
    "low quality, blurry, watermark, text, letters, deformed, mutated, "
    "bad anatomy, extra limbs, distorted face, ugly, multiple subjects, "
    "scene, landscape, multiple characters, busy background, modern items, "
    "violence, scary, dark mood, photorealistic"
)

# ============================================================
# STYLE COMMUN POUR LES ILLUSTRATIONS D'HISTOIRES (16:9)
# ============================================================
STORY_STYLE = (
    "watercolor illustration, soft Pixar-style children's book illustration, "
    "fairy-tale atmosphere, gentle painterly lighting, dreamy magical mood, "
    "rich color palette but soft tones, no text in image, no watermark, "
    "16:9 widescreen composition. "
)


# ============================================================
# CATALOGUE CANONIQUE DES 12 ITEMS
# ============================================================
# Chaque entree :
#   - label       : libelle court pour le picker UI (deja dans game.js)
#   - emoji       : fallback emoji si image absente
#   - name        : nom propre du personnage (utilisable dans les histoires)
#   - portrait    : prompt complet pour la card du picker (ajoute apres PORTRAIT_STYLE)
#   - canon       : description canonique compacte injectee dans les prompts
#                   d'histoires partout ou ce sujet apparait
# ============================================================
ITEM_CANON = {
    # ============== HEROS ==============
    "hero": {
        "astronaute": {
            "label": "Astronaute",
            "emoji": "🧑‍🚀",
            "name": "Lea",
            "portrait": (
                "Portrait of Lea, a brave 8-year-old astronaut girl: white space suit "
                "with red and blue patches on the shoulders, helmet decorated with "
                "small golden stars held under one arm, brown curly hair in two small "
                "buns, light freckles across cheeks, big bright curious smile, looking "
                "warmly at the viewer, full upper body shot."
            ),
            "canon": (
                "Lea: 8-year-old astronaut girl with brown curly hair in two small buns, "
                "freckles, white space suit with red and blue shoulder patches, helmet "
                "decorated with golden stars, friendly curious expression. "
            ),
        },
        "sorciere": {
            "label": "Sorciere",
            "emoji": "🧙‍♀️",
            "name": "Pimprenelle",
            "portrait": (
                "Portrait of Pimprenelle, a 9-year-old young witch girl: deep purple "
                "pointed hat with golden crescent moons, lavender robe with star "
                "patterns, red curly hair in a long side braid, gentle freckled face, "
                "kind smile, holding a slim wooden wand with a crystal tip, looking "
                "warmly at the viewer, full upper body shot."
            ),
            "canon": (
                "Pimprenelle: 9-year-old young witch girl with red curly hair in a long "
                "side braid, deep purple pointed hat with golden crescent moons, lavender "
                "robe with star patterns, freckles, holding a wooden wand with crystal tip, "
                "kind expression. "
            ),
        },
        "dragon": {
            "label": "Dragon",
            "emoji": "🐉",
            "name": "Brio",
            "portrait": (
                "Portrait of Brio, a tiny adorable baby dragon (size of a large cat): "
                "soft sky-blue pale scales (gentle pastel cyan), big curious sparkling "
                "blue eyes, small wings folded along the back, round friendly face with "
                "a gentle smile, tiny rounded horns, looking warmly at the viewer."
            ),
            "canon": (
                "Brio: tiny baby dragon the size of a large cat with soft sky-blue pale "
                "pastel scales, big curious sparkling blue eyes, small wings, round "
                "friendly face, tiny rounded horns, gentle expression. "
            ),
        },
    },

    # ============== LIEUX ==============
    "place": {
        "planete": {
            "label": "Planete",
            "emoji": "🪐",
            "name": "Vega-7",
            "portrait": (
                "A small magical planet Vega-7 floating in deep space: rich purple and "
                "teal surface with tiny glowing craters, two thin golden rings tilted "
                "around it, soft warm aura, twinkling stars in the background, centered "
                "card composition."
            ),
            "canon": (
                "Vega-7: a small magical planet with purple and teal surface, tiny "
                "glowing craters, two thin golden rings, soft warm aura, set in starry space. "
            ),
        },
        "chateau": {
            "label": "Chateau",
            "emoji": "🏰",
            "name": "Belmondrie",
            "portrait": (
                "Castle of Belmondrie: small fairy-tale stone castle with three tall "
                "pointed towers, blue conical roofs, ivy climbing the walls, some broken "
                "windows showing warm magical glow from within, gentle romantic medieval "
                "architecture, isolated on parchment."
            ),
            "canon": (
                "Belmondrie: fairy-tale stone castle with three tall pointed towers and "
                "blue conical roofs, ivy on crumbling walls, broken windows showing warm "
                "magical glow inside, romantic medieval architecture. "
            ),
        },
        "ocean": {
            "label": "Ocean",
            "emoji": "🌊",
            "name": "Mer d'Aural",
            "portrait": (
                "A magical luminous ocean wave: deep turquoise and aquamarine water "
                "curling gracefully, scattered with tiny bioluminescent sparkles, a "
                "single silver fish swimming in the curl, soft foam, surrounded by faint "
                "starlight, centered card composition."
            ),
            "canon": (
                "Mer d'Aural: a magical luminous deep turquoise and aquamarine ocean "
                "scattered with bioluminescent sparkles, gentle silver fish glints, soft "
                "foam, faint starlight reflecting on water. "
            ),
        },
    },

    # ============== OBJETS MAGIQUES ==============
    "item": {
        "baguette": {
            "label": "Baguette",
            "emoji": "🪄",
            "name": "Etoile",
            "portrait": (
                "Etoile: a slim magical wooden wand with a five-pointed golden star "
                "tip emitting bright silver sparkles, swirling decorative carvings along "
                "the warm honey-brown wood shaft, tied with a small red ribbon near the "
                "handle, glowing softly, centered horizontally on parchment."
            ),
            "canon": (
                "Etoile: slim magical wand of warm honey-brown wood with swirling carvings, "
                "five-pointed golden star tip emitting silver sparkles, small red ribbon "
                "near the handle. "
            ),
        },
        "skateboard": {
            "label": "Skateboard",
            "emoji": "🛹",
            "name": "Fusee",
            "portrait": (
                "Fusee: a colorful magical skateboard, deep blue deck painted with white "
                "stars and golden lightning bolts, neon-pink wheels glowing softly, slight "
                "holographic shimmer along the edges, presented diagonally for a dynamic "
                "card pose, isolated on parchment."
            ),
            "canon": (
                "Fusee: magical skateboard with deep blue deck, white stars and golden "
                "lightning bolt patterns, neon-pink glowing wheels, holographic shimmer "
                "along the edges. "
            ),
        },
        "guitare": {
            "label": "Guitare",
            "emoji": "🎸",
            "name": "Guitare des sept silences",
            "portrait": (
                "The Guitar of Seven Silences: a small acoustic guitar with a translucent "
                "pale crystal body, six shimmering strings that catch silver, violet and "
                "golden reflections, glowing softly from within, small wooden tuning pegs, "
                "presented from a three-quarter angle on parchment."
            ),
            "canon": (
                "The crystal guitar (Guitar of Seven Silences): small acoustic guitar with "
                "translucent pale crystal body, six shimmering strings catching silver, "
                "violet and golden reflections, glowing softly from within. "
            ),
        },
    },

    # ============== DEFIS (VILLAINS) ==============
    "villain": {
        "monstre": {
            "label": "Monstre",
            "emoji": "👾",
            "name": "Grobi",
            "portrait": (
                "Portrait of Grobi: a small cute purple fluffy monster, two short curved "
                "horns on top of the head, very big round yellow eyes with white "
                "highlights, friendly toothy smile (no fangs), fuzzy lavender-purple fur, "
                "small rounded body, sitting and waving one paw, not scary at all, "
                "endearing children's book style."
            ),
            "canon": (
                "Grobi: small cute purple fluffy monster, two short curved horns, very "
                "big round yellow eyes, friendly toothy smile (not scary), fuzzy "
                "lavender-purple fur, small rounded body. "
            ),
        },
        "robot": {
            "label": "Robot fou",
            "emoji": "🤖",
            "name": "Bipboup",
            "portrait": (
                "Portrait of Bipboup: a small playful tin-can robot, round silver body "
                "with visible rivets, two flexible antennas with glowing yellow light "
                "bulbs on top, two mechanical arms ending in friendly pincers, single "
                "round blue screen-eye displaying a mischievous smile, slightly tilted "
                "head, isolated on parchment."
            ),
            "canon": (
                "Bipboup: small playful tin-can robot with round silver riveted body, two "
                "flexible antennas with glowing yellow light bulbs, mechanical pincer arms, "
                "single round blue screen-eye showing a mischievous smile. "
            ),
        },
        "fantome": {
            "label": "Fantome",
            "emoji": "👻",
            "name": "Maitre Otho",
            "portrait": (
                "Portrait of Maitre Otho: a small friendly translucent ghost in the "
                "shape of an old craftsman, kind pale grey eyes, long wispy white beard, "
                "gentle smile, soft ethereal blue-white glow around the silhouette, "
                "wearing the faded outline of an old craftsman's apron, floating slightly, "
                "warm and benevolent presence."
            ),
            "canon": (
                "Maitre Otho: small friendly translucent ghost shaped like an old craftsman "
                "with kind pale grey eyes, long wispy white beard, gentle smile, ethereal "
                "blue-white glow, faded outline of an old craftsman's apron. "
            ),
        },
    },
}


def get_canon_for_combo(hero, place, item, villain, only_roles=None):
    """
    Renvoie la description canonique concatenee des elements de l'histoire.
    A injecter au DEBUT de chaque prompt de page d'illustration pour que
    le generateur d'images regenere systematiquement les memes personnages.

    only_roles : liste optionnelle de roles a inclure (ex: ['hero', 'item'])
                 Si None, inclut les 4. Permet de filtrer page par page pour
                 eviter que Gemini ajoute des perso non desires.
    """
    parts = []
    role_to_val = {"hero": hero, "place": place, "item": item, "villain": villain}
    for role, val in role_to_val.items():
        if only_roles is not None and role not in only_roles:
            continue
        if val and val in ITEM_CANON.get(role, {}):
            parts.append(ITEM_CANON[role][val]["canon"])
    if not parts:
        return ""
    return "CHARACTER REFERENCE (must match exactly): " + " ".join(parts) + " "


def get_exclusion_instruction(hero, place, item, villain, included_roles):
    """
    Construit une instruction explicite pour exclure les personnages NON
    presents sur cette page (evite que Gemini les invente).
    """
    excluded = []
    role_to_val = {"hero": hero, "place": place, "item": item, "villain": villain}
    for role, val in role_to_val.items():
        if role in included_roles:
            continue
        if val and val in ITEM_CANON.get(role, {}):
            name = ITEM_CANON[role][val].get("name", val)
            excluded.append(f"{name} ({role})")
    if not excluded:
        return ""
    return ("IMPORTANT: This specific scene must NOT include the following "
            "characters/objects: " + ", ".join(excluded) + ". "
            "Only show what is explicitly described in the scene prompt below. ")
