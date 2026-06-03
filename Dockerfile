# Dockerfile pour deploiement Cloud Run du backend Flask "Leon"
# Image legere Python 3.11 (compatible avec toutes nos deps)
FROM python:3.11-slim

WORKDIR /app

# Dependances systeme minimales (PIL pour qrcode, ssl)
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates libjpeg-dev zlib1g-dev \
    && rm -rf /var/lib/apt/lists/*

# Install Python deps (cache layer si pas modifie)
COPY server/requirements.txt /app/server/requirements.txt
RUN pip install --no-cache-dir -r /app/server/requirements.txt

# Copie le reste du projet (assets, code, calibration...)
COPY . /app/

# Cloud Run injecte PORT=8080 automatiquement
ENV PORT=8080
EXPOSE 8080

# Gunicorn (production-grade WSGI) au lieu du dev server Flask
# --workers 1 + --threads 8 = bon compromis pour I/O-bound (Gemini API, etc.)
# --timeout 0 = pas de timeout au niveau gunicorn (Cloud Run a son propre timeout 60min)
CMD exec gunicorn --bind :$PORT --workers 1 --threads 8 --timeout 0 server.app:app
