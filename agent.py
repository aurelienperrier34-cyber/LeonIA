import os
import json
import time
import requests
import traceback
from dotenv import load_dotenv

# Chargement des clés API depuis le fichier .env
load_dotenv()

ELEVENLABS_API_KEY = os.getenv("ELEVENLABS_API_KEY")
LEONARDO_API_KEY = os.getenv("LEONARDO_API_KEY")

VOICE_ID_LEON = os.getenv("VOICE_ID_LEON")
VOICE_ID_NARRATEUR = os.getenv("VOICE_ID_NARRATEUR")

LEONARDO_BASE_URL = "https://cloud.leonardo.ai/api/rest/v1"
LEONARDO_HEADERS = {
    "accept": "application/json",
    "content-type": "application/json",
    "authorization": f"Bearer {LEONARDO_API_KEY}"
}

def generer_voix(texte, voice_id, nom_fichier, dossier_cible):
    if not ELEVENLABS_API_KEY or not voice_id or not texte: return
    print(f"🎙️ Génération de la voix pour {nom_fichier}...")
    url = f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id}"
    headers = { "Accept": "audio/mpeg", "Content-Type": "application/json", "xi-api-key": ELEVENLABS_API_KEY }
    data = {
        "text": texte,
        # Modèle plus récent : meilleur rendu français, moins d'accents parasites
        "model_id": "eleven_turbo_v2_5",
        # Force la langue française pour empêcher la dérive d'accent (canadien etc.)
        "language_code": "fr",
        "voice_settings": {
            "stability": 0.8,         # plus haut = accent plus stable
            "similarity_boost": 0.75,
            "style": 0.0,             # neutre, pas d'expressivité forcée
            "use_speaker_boost": True
        }
    }
    response = requests.post(url, json=data, headers=headers)
    if response.status_code == 200:
        chemin = os.path.join(dossier_cible, nom_fichier)
        with open(chemin, 'wb') as f: f.write(response.content)
        print(f"✅ Voix sauvegardée dans {chemin}")
    else:
        print(f"❌ Erreur ElevenLabs: {response.text}")

def upload_reference_image(chemin_image):
    print(f"📤 Upload de l'image de référence '{chemin_image}'...")
    ext = chemin_image.split('.')[-1]
    res = requests.post(f"{LEONARDO_BASE_URL}/init-image", json={"extension": ext}, headers=LEONARDO_HEADERS)
    if res.status_code != 200:
        print("❌ Erreur demande upload:", res.text)
        return None
    upload_data = res.json()['uploadInitImage']
    init_image_id = upload_data['id']
    with open(chemin_image, 'rb') as f:
        upload_res = requests.post(upload_data['url'], data=json.loads(upload_data['fields']), files={'file': f})
        if upload_res.status_code == 204:
            print(f"✅ Image uploadée avec succès ! (ID: {init_image_id})")
            return init_image_id
    print("❌ Erreur lors de l'upload S3.")
    return None

def generer_image(prompt, nom_fichier, dossier_cible, ref_face_id=None, ref_outfit_id=None, lora_id=None):
    if not LEONARDO_API_KEY or not prompt: return None
    print(f"🎨 Génération de l'image fixe (Prompt: {prompt[:40]}...)")

    data = {
        "height": 768, "width": 1344, "prompt": prompt,
        "negative_prompt": "wearing headphones on head, wearing headphones on ears, orange cap, wrong clothes, mutated, ugly, bad anatomy",
        "modelId": lora_id if lora_id else "5c232a9e-9061-4777-980a-ddc8e65647c6",
        "num_images": 1
    }

    # Empile les références (max 4 controlnets sur Leonardo)
    controlnets = []
    if ref_face_id:
        controlnets.append({
            "initImageId": ref_face_id,
            "initImageType": "UPLOADED",
            "preprocessorId": 133,    # Character Reference (visage)
            "strengthType": "High"
        })
        print(f"🔄 Référence VISAGE (Character Ref - High) : {ref_face_id}")
    if ref_outfit_id:
        controlnets.append({
            "initImageId": ref_outfit_id,
            "initImageType": "UPLOADED",
            "preprocessorId": 67,     # Style Reference (vêtements/style global)
            "strengthType": "Mid"
        })
        print(f"🔄 Référence VÊTEMENTS (Style Ref - Mid) : {ref_outfit_id}")
    if controlnets:
        data["controlnets"] = controlnets

    if lora_id:
        print(f"🧠 Utilisation du Modèle Sur-Mesure : {lora_id} !")
    
    response = requests.post(f"{LEONARDO_BASE_URL}/generations", json=data, headers=LEONARDO_HEADERS)
    if response.status_code != 200:
        print(f"❌ Erreur Leonardo Initiation: {response.text}")
        return None
        
    gen_id = response.json()['sdGenerationJob']['generationId']
    print("⏳ Calcul de l'image...")
    while True:
        time.sleep(4)
        statut_res = requests.get(f"{LEONARDO_BASE_URL}/generations/{gen_id}", headers=LEONARDO_HEADERS)
        if statut_res.status_code == 200:
            generations = statut_res.json()['generations_by_pk']['generated_images']
            if len(generations) > 0:
                img_url = generations[0]['url']
                img_id = generations[0]['id']
                break
    
    img_data = requests.get(img_url).content
    chemin = os.path.join(dossier_cible, nom_fichier)
    with open(chemin, 'wb') as f: f.write(img_data)
    print(f"✅ Image sauvegardée dans {chemin}")
    return img_id

def generer_video(image_id, nom_fichier, dossier_cible):
    print(f"🎬 Création de la vidéo SVD Motion (ID: {image_id})...")
    data = { "imageId": image_id, "motionStrength": 4 }
    response = requests.post(f"{LEONARDO_BASE_URL}/generations-motion-svd", json=data, headers=LEONARDO_HEADERS)
    if response.status_code != 200:
        print(f"❌ Erreur Leonardo Motion: {response.text}")
        return
        
    gen_id = response.json()['motionSvdGenerationJob']['generationId']
    print("⏳ Calcul de la vidéo (cela prend environ 1-2 minutes)...")
    while True:
        time.sleep(10)
        statut_res = requests.get(f"{LEONARDO_BASE_URL}/generations/{gen_id}", headers=LEONARDO_HEADERS)
        if statut_res.status_code == 200:
            generations = statut_res.json()['generations_by_pk']['generated_images']
            if len(generations) > 0 and generations[0]['motionMP4URL']:
                video_url = generations[0]['motionMP4URL']
                break
    
    vid_data = requests.get(video_url).content
    chemin = os.path.join(dossier_cible, nom_fichier)
    with open(chemin, 'wb') as f: f.write(vid_data)
    print(f"✅ Vidéo sauvegardée dans {chemin} !")


if __name__ == "__main__":
    try:
        print("="*50)
        print("🚀 RÉALISATEUR IA EXPLORERS (MODE BATCH)")
        print("="*50)
        
        num_chapitre = input("0️⃣  Numéro du chapitre (ex: 3) : ").strip()
        dossier_cible = f"assets/chapitre_{num_chapitre}" if num_chapitre else "assets"
        os.makedirs(dossier_cible, exist_ok=True)
        
        fichier_json = input("1️⃣  Nom du fichier JSON généré par Claude (ex: scenario_chap3.json) : ").strip()
        if not os.path.exists(fichier_json):
            raise FileNotFoundError(f"Le fichier '{fichier_json}' est introuvable. Vérifie qu'il est bien dans le dossier du projet.")
            
        with open(fichier_json, 'r', encoding='utf-8') as f:
            tableaux = json.load(f)
            
        if not isinstance(tableaux, list):
            raise ValueError("Le fichier JSON doit contenir une liste (array) de tableaux `[ {...}, {...} ]`.")
            
        print(f"📁 {len(tableaux)} tableaux trouvés dans le fichier !")
        
        ref_face = input("2️⃣  Image VISAGE de Léon (close-up, dans 'assets/') ? (Laisse vide si non) : ").strip()
        ref_outfit = input("3️⃣  Image VÊTEMENTS de Léon (full body, dans 'assets/') ? (Laisse vide si non) : ").strip()
        lora_id = input("4️⃣  As-tu l'ID de ton Modèle Entraîné (LoRA) ? Laisse vide si non : ").strip()

        # Préparation des images de référence
        ref_face_id = None
        ref_outfit_id = None
        if ref_face:
            chemin = os.path.join("assets", ref_face)
            if os.path.exists(chemin):
                ref_face_id = upload_reference_image(chemin)
            else:
                print(f"⚠️ Fichier visage {chemin} introuvable, génération sans Character Ref.")
        if ref_outfit:
            chemin = os.path.join("assets", ref_outfit)
            if os.path.exists(chemin):
                ref_outfit_id = upload_reference_image(chemin)
            else:
                print(f"⚠️ Fichier vêtements {chemin} introuvable, génération sans Style Ref.")
        
        # BATCH PROCESSING
        for item in tableaux:
            t_id = item.get("tableau", "X")
            print("\n" + "="*40)
            print(f"🎬 TRAITEMENT DU TABLEAU {t_id}")
            print("="*40)
            
            narrateur_texte = item.get("narrateur", "")
            leon_texte = item.get("leon", "")
            prompt_img = item.get("prompt_image", "")
            format_choisi = item.get("format", "image").strip().lower() # 'image' ou 'video'
            
            # Voix
            chemin_nar = os.path.join(dossier_cible, f"t{t_id}_narrateur.mp3")
            chemin_leon = os.path.join(dossier_cible, f"t{t_id}_leon.mp3")
            
            if narrateur_texte and VOICE_ID_NARRATEUR:
                if not os.path.exists(chemin_nar):
                    generer_voix(narrateur_texte, VOICE_ID_NARRATEUR, f"t{t_id}_narrateur.mp3", dossier_cible)
                else:
                    print(f"✅ Voix narrateur (t{t_id}) déjà existante, économie de crédits !")
                    
            if leon_texte and VOICE_ID_LEON:
                if not os.path.exists(chemin_leon):
                    generer_voix(leon_texte, VOICE_ID_LEON, f"t{t_id}_leon.mp3", dossier_cible)
                else:
                    print(f"✅ Voix Léon (t{t_id}) déjà existante, économie de crédits !")
                
            # Visuels
            if prompt_img:
                # On injecte de force la description parfaite de Léon pour aider le Character Reference
                master_leon_desc = "A friendly old wizard-inventor, (((white beard containing small flowers))), (((round orange glasses))), (((decorated blue cap))), (((orange sweater))), and a (((brown apron))). "
                prompt_complet = master_leon_desc + prompt_img
                
                img_nom = f"t{t_id}_bg.jpg"
                gen_img_id = generer_image(prompt_complet, img_nom, dossier_cible,
                                           ref_face_id=ref_face_id, ref_outfit_id=ref_outfit_id,
                                           lora_id=lora_id)
                
                if format_choisi == "video" and gen_img_id:
                    vid_nom = f"t{t_id}_bg.mp4"
                    generer_video(gen_img_id, vid_nom, dossier_cible)
                    
        print(f"\n🎉 MISSION ACCOMPLIE ! Tous tes fichiers sont proprement classés dans le dossier /{dossier_cible}/")
    except Exception as e:
        print(f"\n❌ UNE ERREUR S'EST PRODUITE : {e}")
        traceback.print_exc()
    
    input("\nAppuie sur Entrée pour fermer cette fenêtre...")
