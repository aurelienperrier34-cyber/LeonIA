"""
Mini-serveur HTTP pour IA EXPLORERS.

En plus de servir les fichiers statiques (comme `python -m http.server`),
il accepte un endpoint POST `/api/save-calibration` qui ecrit le JSON
recu dans `calibration.json` a la racine du projet.

Utilisation :
    python lancer_jeu.py            # demarre sur le port 8765
    python lancer_jeu.py 8080       # demarre sur le port 8080

Le navigateur peut alors faire :
    fetch('/api/save-calibration', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hero4Pos: {...}, ... })
    })
et le fichier `calibration.json` est mis a jour cote serveur.
"""

from http.server import HTTPServer, SimpleHTTPRequestHandler
import json
import os
import sys

PROJECT_DIR = os.path.dirname(os.path.abspath(__file__))
CALIBRATION_FILE = os.path.join(PROJECT_DIR, 'calibration.json')


class IAHandler(SimpleHTTPRequestHandler):
    def do_POST(self):
        if self.path == '/api/save-calibration':
            try:
                length = int(self.headers.get('Content-Length', 0))
                raw = self.rfile.read(length).decode('utf-8') if length else '{}'
                payload = json.loads(raw)

                # On merge avec le JSON existant pour ne pas ecraser
                # les autres cles si l'appelant n'envoie qu'un sous-ensemble.
                existing = {}
                if os.path.exists(CALIBRATION_FILE):
                    try:
                        with open(CALIBRATION_FILE, 'r', encoding='utf-8') as f:
                            existing = json.load(f)
                    except Exception:
                        existing = {}
                merged = {**existing, **payload}

                with open(CALIBRATION_FILE, 'w', encoding='utf-8') as f:
                    json.dump(merged, f, indent=2, ensure_ascii=False)

                self._send_json(200, {'ok': True, 'saved': list(payload.keys())})
                print(f"[calibration] saved keys: {list(payload.keys())}")
            except Exception as e:
                self._send_json(500, {'ok': False, 'error': str(e)})
        else:
            self.send_response(404)
            self.end_headers()

    def _send_json(self, code, data):
        body = json.dumps(data).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(body)

    # Logs un peu moins bavards pour les requetes routinieres
    def log_message(self, fmt, *args):
        sys.stdout.write("[%s] %s - %s\n" % (self.log_date_time_string(), self.address_string(), fmt % args))


def main():
    port = 8765
    if len(sys.argv) > 1:
        try:
            port = int(sys.argv[1])
        except ValueError:
            pass
    os.chdir(PROJECT_DIR)
    print(f"IA EXPLORERS server -> http://localhost:{port}/index.html")
    print(f"Calibration save: POST /api/save-calibration -> {CALIBRATION_FILE}")
    print("Ctrl+C pour arreter.")
    try:
        HTTPServer(('localhost', port), IAHandler).serve_forever()
    except OSError as e:
        # Cas typique : un autre serveur Python tourne deja sur le meme port
        # (oubli de fermer la console precedente).
        print()
        print("===== ERREUR : impossible d'ouvrir le port", port, "=====")
        print("Detail :", e)
        print()
        print("Cause probable : un ancien serveur tourne encore sur ce port.")
        print("Solution :")
        print("  1) Ferme TOUTES les fenetres noires 'python' / 'lancer_jeu' encore ouvertes.")
        print("  2) Ou ouvre le Gestionnaire des taches (Ctrl+Shift+Echap) et termine les")
        print("     processus python.exe restants.")
        print("  3) Puis relance lancer_jeu.bat.")
        print()
        input("Appuie sur Entree pour fermer cette fenetre...")
        sys.exit(1)


if __name__ == '__main__':
    try:
        main()
    except KeyboardInterrupt:
        print("\nArret du serveur.")
    except Exception as e:
        # Toute autre erreur : on l'affiche clairement avant que la fenetre se ferme
        import traceback
        print()
        print("===== ERREUR INATTENDUE =====")
        traceback.print_exc()
        print()
        input("Appuie sur Entree pour fermer cette fenetre...")
        sys.exit(1)
