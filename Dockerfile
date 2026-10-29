FROM python:3.12-slim

# git: required to install the pinned supertonic-py SDK from GitHub
# libsndfile1: required by soundfile (Supertonic audio output)
RUN apt-get update \
    && apt-get install -y --no-install-recommends git ca-certificates libsndfile1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /srv/app

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    SUPERTONIC_MODEL_DIR=/models/supertonic

COPY app/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY app/ ./

EXPOSE 7860

# Download Supertonic 3 assets (pinned HF revision) on first boot, then serve.
CMD ["sh", "-c", "python download_assets.py && uvicorn main:app --host 0.0.0.0 --port 7860"]
