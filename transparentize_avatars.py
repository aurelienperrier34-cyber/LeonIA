"""
transparentize_avatars.py
==========================
Rend les fonds blancs des PNG d'avatars NATIVEMENT transparents.

Strategie : flood-fill BFS depuis les 4 coins, tout pixel proche du blanc
(R,G,B > 230) connecte aux bords devient alpha=0.

Sauvegarde en place (les anciens fichiers sont .bak).
"""
import os
import shutil
from collections import deque
from PIL import Image
import numpy as np

AVATARS = [
    "assets/avatar_fille_1776108656117.png",
    "assets/avatar_garcon_1776108702967.png",
    "assets/avatar_renard_1776108778358.png",
    "assets/avatar_robot_1776108872947.png",
]

THRESHOLD = 230   # pixel "blanc" si R>=230 ET G>=230 ET B>=230
ROOT = os.path.dirname(os.path.abspath(__file__))


def transparentize(path):
    full = os.path.join(ROOT, path)
    if not os.path.exists(full):
        print(f"  ABSENT : {full}")
        return False

    bak = full + ".bak"
    if not os.path.exists(bak):
        shutil.copy2(full, bak)
        print(f"  backup -> {os.path.basename(bak)}")

    img = Image.open(full).convert("RGBA")
    arr = np.array(img)  # H x W x 4
    h, w, _ = arr.shape

    # Masque "candidat blanc"
    rgb = arr[:, :, :3]
    candidate = (rgb[:, :, 0] >= THRESHOLD) & (rgb[:, :, 1] >= THRESHOLD) & (rgb[:, :, 2] >= THRESHOLD)

    # Flood fill BFS depuis les 4 coins (et le perimetre par securite)
    visited = np.zeros((h, w), dtype=bool)
    q = deque()

    # Seed : tout le perimetre, si candidat
    for x in range(w):
        for y in (0, h - 1):
            if candidate[y, x] and not visited[y, x]:
                visited[y, x] = True
                q.append((y, x))
    for y in range(h):
        for x in (0, w - 1):
            if candidate[y, x] and not visited[y, x]:
                visited[y, x] = True
                q.append((y, x))

    while q:
        y, x = q.popleft()
        for dy, dx in ((-1, 0), (1, 0), (0, -1), (0, 1)):
            ny, nx = y + dy, x + dx
            if 0 <= ny < h and 0 <= nx < w and not visited[ny, nx] and candidate[ny, nx]:
                visited[ny, nx] = True
                q.append((ny, nx))

    # Met alpha=0 sur tous les pixels visites (= fond blanc connecte au bord)
    arr[visited, 3] = 0

    # Anti-aliasing doux : pixels proches mais non purement blancs au bord
    # du masque -> alpha proportionnel a la distance au blanc
    edge_mask = np.zeros((h, w), dtype=bool)
    # voisins du masque transparent qui sont eux-memes "presque blancs" (>200)
    near = (rgb[:, :, 0] >= 200) & (rgb[:, :, 1] >= 200) & (rgb[:, :, 2] >= 200)
    # dilatation 1px du masque visited
    dil = np.zeros((h, w), dtype=bool)
    dil[1:, :] |= visited[:-1, :]
    dil[:-1, :] |= visited[1:, :]
    dil[:, 1:] |= visited[:, :-1]
    dil[:, :-1] |= visited[:, 1:]
    edge = dil & ~visited & near
    # alpha edge = (255 - moyenne(R,G,B)) * 5, clip 0..255
    if edge.any():
        mean = rgb[edge].mean(axis=1)
        new_alpha = np.clip((255 - mean) * 8, 0, 255).astype(np.uint8)
        arr[edge, 3] = new_alpha

    out = Image.fromarray(arr, mode="RGBA")
    out.save(full, "PNG", optimize=True)

    n_transparent = int(visited.sum())
    pct = 100.0 * n_transparent / (h * w)
    print(f"  OK {os.path.basename(path)} : {n_transparent:,} px transparents ({pct:.1f}%)")
    return True


def main():
    print("Transparentisation des avatars (flood-fill depuis les bords)\n")
    n = 0
    for p in AVATARS:
        if transparentize(p):
            n += 1
    print(f"\nDone. {n} avatars traites.")


if __name__ == "__main__":
    main()
