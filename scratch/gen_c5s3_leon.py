import os
import requests
from dotenv import load_dotenv

load_dotenv()
API_KEY = os.getenv("ELEVENLABS_API_KEY")
VOICE_ID = os.getenv("VOICE_ID_LEON")

text = "Mais attention ! L'IA peut se tromper... ou même inventer des choses fausses avec aplomb. Garde toujours ton esprit critique : vérifie ce que te dit l'IA. C'est toi le chef, pas la machine ! Dis-moi : cette photo est-elle réelle ou faite par l'IA ?"
output_path = "assets/chapitre_5/t3_leon.mp3"

url = f"https://api.elevenlabs.io/v1/text-to-speech/{VOICE_ID}"

headers = {
    "Accept": "audio/mpeg",
    "Content-Type": "application/json",
    "xi-api-key": API_KEY
}

data = {
    "text": text,
    "model_id": "eleven_multilingual_v2",
    "voice_settings": {
        "stability": 0.5,
        "similarity_boost": 0.75
    }
}

print(f"Generating audio for text: {text}")
response = requests.post(url, json=data, headers=headers)

if response.status_code == 200:
    with open(output_path, 'wb') as f:
        f.write(response.content)
    print(f"Audio saved to {output_path}")
else:
    print(f"Error: {response.status_code}")
    print(response.text)
