FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# O processo roda sem root: se alguém tomar a API, não ganha o container inteiro. O código
# fica de dono do root (o usuário não consegue alterá-lo); só a pasta dos anexos é dele.
RUN groupadd --system --gid 10001 sgcas \
    && useradd --system --uid 10001 --gid sgcas --no-create-home --shell /usr/sbin/nologin sgcas

COPY . .
RUN mkdir -p /app/armazenamento && chown sgcas:sgcas /app/armazenamento

USER sgcas

EXPOSE 8000

# `--worker-tmp-dir /dev/shm`: o gunicorn grava o sinal de vida dos workers em disco, e
# num container com sistema de arquivos somente leitura só /dev/shm e /tmp aceitam escrita.
CMD ["gunicorn", "sgcas.wsgi:application", "--bind", "0.0.0.0:8000", "--workers", "4", "--timeout", "120", "--worker-tmp-dir", "/dev/shm"]
