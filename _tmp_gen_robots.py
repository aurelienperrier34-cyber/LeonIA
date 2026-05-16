# -*- coding: utf-8 -*-
import sys
from pathlib import Path
sys.path.insert(0, '.')
from agent import generer_voix, VOICE_ID_LEON

personas = ['Aria', 'Iris', 'Vega', 'Sirius', 'Lumi', 'Astra', 'Echo', 'Melo', 'Orion', 'Nova']

out = Path('assets/consignes')
out.mkdir(parents=True, exist_ok=True)

for name in personas:
    text = f"Bonjour ! Je suis {name}. Je vais te tenir compagnie. Clique sur un module pour me voir en action !"
    filename = f"c5s5_robot_{name.lower()}.mp3"
    print(f'[{name}] {text[:70]}...')
    generer_voix(text, VOICE_ID_LEON, filename, str(out))

print('OK 10/10')
