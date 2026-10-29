"""
Configuracao do backend do SGCAS.

O banco e o mesmo que o backend anterior usa: nao ha migracao de dados, e os
modelos sao escritos sobre as tabelas existentes com `db_table`. Por isso o
Django nao gerencia o esquema — `managed = False` nos modelos de dominio.
"""
import base64
from pathlib import Path
from urllib.parse import urlparse

import environ

BASE_DIR = Path(__file__).resolve().parent.parent

env = environ.Env(
    DEBUG=(bool, False),
    ALLOWED_HOSTS=(list, ['localhost', '127.0.0.1']),
    CORS_ORIGIN=(str, 'http://localhost:3000'),
)

# Em projeto independente, o .env vive na raiz da API.
environ.Env.read_env(BASE_DIR / '.env')

DEBUG = env('DEBUG')
ALLOWED_HOSTS = env('ALLOWED_HOSTS')

SECRET_KEY = env('DJANGO_SECRET_KEY', default='inseguro-apenas-para-desenvolvimento')

# Em producao a chave nao pode ser a de exemplo, nem a do `.env.example`, nem curta.
#
# Falhar no boot e melhor do que subir: com uma chave conhecida, qualquer pessoa que
# leia o repositorio consegue forjar uma sessao assinada. Um `.env` copiado do modelo
# sem trocar a chave subiria sem aviso, entao os valores de exemplo tambem sao barrados.
_CHAVES_DE_EXEMPLO = {'inseguro-apenas-para-desenvolvimento', 'CHAVE_SECRETA_AQUI'}
_TAMANHO_MINIMO_DA_CHAVE = 32
if not DEBUG and (SECRET_KEY in _CHAVES_DE_EXEMPLO or len(SECRET_KEY) < _TAMANHO_MINIMO_DA_CHAVE):
    raise RuntimeError(
        'DJANGO_SECRET_KEY precisa ser definida em produção, com pelo menos '
        f'{_TAMANHO_MINIMO_DA_CHAVE} caracteres e diferente da chave de exemplo. '
        'Gere uma com: python -c "import secrets; print(secrets.token_urlsafe(64))"'
    )

INSTALLED_APPS = [
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',

    'rest_framework',

    'apps.institucional',
    'apps.contas',
    'apps.cidadaos',
    'apps.atendimentos',
    'apps.relatorios',
    'apps.auditoria',
]

MIDDLEWARE = [
    # Antes de tudo, inclusive da validação de host e do redirecionamento HTTPS:
    # o healthcheck do container fala em HTTP puro com o Host do curl.
    'apps.comum.saude.Saude',
    # Fora do cache do navegador tudo o que a API devolve (ver o proprio modulo).
    'apps.comum.sem_cache.SemCacheNaApi',
    'django.middleware.security.SecurityMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
    'apps.contas.throttle.ThrottleAuth',
    # Depois da autenticacao: precisa de `request.user` resolvido para saber
    # quem agiu.
    'apps.auditoria.middleware.TrilhaDeAuditoria',
]

ROOT_URLCONF = 'sgcas.urls'

TEMPLATES = [
    {
        'BACKEND': 'django.template.backends.django.DjangoTemplates',
        'DIRS': [],
        'APP_DIRS': True,
        'OPTIONS': {
            'context_processors': [
                'django.template.context_processors.request',
                'django.contrib.auth.context_processors.auth',
                'django.contrib.messages.context_processors.messages',
            ],
        },
    },
]

WSGI_APPLICATION = 'sgcas.wsgi.application'

# O DATABASE_URL do .env aponta para o mesmo Postgres do backend atual — e e o
# mesmo valor lido pelo Prisma, que aceita parametros que o psycopg recusa como
# opcao de conexao (`schema`, `connection_limit`). Removidos aqui para que os
# dois backends possam conviver com uma unica variavel de ambiente durante a
# transicao, em vez de duas que podem divergir em silencio.
_PARAMS_DO_PRISMA = {'schema', 'connection_limit', 'pool_timeout', 'connect_timeout', 'pgbouncer'}

def _banco_do_ambiente() -> dict:
    config = env.db('DATABASE_URL')
    opcoes = config.get('OPTIONS') or {}
    config['OPTIONS'] = {k: v for k, v in opcoes.items() if k not in _PARAMS_DO_PRISMA}
    return config

DATABASES = {'default': _banco_do_ambiente()}

# A senha do `.env.example` (e a que o Compose usava por padrao) e publica. Em producao um
# banco com ela entrega todos os cadastros a quem alcancar a porta do Postgres, entao o boot
# recusa, como faz com a chave secreta de exemplo.
_SENHAS_DE_EXEMPLO_DO_BANCO = {'change-me'}
if not DEBUG and (DATABASES['default'].get('PASSWORD') or '').lower() in _SENHAS_DE_EXEMPLO_DO_BANCO:
    raise RuntimeError(
        'A senha do banco em DATABASE_URL (e em POSTGRES_PASSWORD) é a de exemplo. Defina uma '
        'própria em produção. Gere com: python -c "import secrets; print(secrets.token_urlsafe(24))"'
    )

AUTH_PASSWORD_VALIDATORS = []

LANGUAGE_CODE = 'pt-br'
TIME_ZONE = 'America/Manaus'
USE_I18N = True
USE_TZ = True

# Quantos proxies reversos (nginx ou similar, na frente do Next) acrescentam ao
# X-Forwarded-For. O proxy de rewrites do Next NÃO acrescenta: repassa o que veio.
# Em desenvolvimento não há proxy reverso, e acreditar no cabeçalho deixaria
# qualquer um escolher o próprio IP. Em produção ele é obrigatório (sem ele o
# X-Forwarded-Proto não chega e o redirecionamento HTTPS entra em laço), então
# 1 é o padrão. Ver apps/comum/rede.py.
TRUSTED_PROXIES = env.int('TRUSTED_PROXIES', default=0 if DEBUG else 1)

# ─── Segurança em produção ───
#
# Tudo condicionado a DEBUG: em desenvolvimento o servidor é HTTP, e exigir
# cookie seguro impediria qualquer sessão de funcionar localmente.
if not DEBUG:
    SECURE_SSL_REDIRECT = True
    SECURE_HSTS_SECONDS = 60 * 60 * 24 * 365
    SECURE_HSTS_INCLUDE_SUBDOMAINS = True
    SECURE_HSTS_PRELOAD = True
    SESSION_COOKIE_SECURE = True
    CSRF_COOKIE_SECURE = True
    SECURE_PROXY_SSL_HEADER = ('HTTP_X_FORWARDED_PROTO', 'https')

SESSION_COOKIE_HTTPONLY = True
SESSION_COOKIE_SAMESITE = 'Lax'
CSRF_COOKIE_HTTPONLY = False
CSRF_COOKIE_SAMESITE = 'Lax'
SECURE_CONTENT_TYPE_NOSNIFF = True
SECURE_REFERRER_POLICY = 'no-referrer'
X_FRAME_OPTIONS = 'DENY'

SESSION_COOKIE_AGE = 28800  # 8 horas sem uso
SESSION_EXPIRE_AT_BROWSER_CLOSE = False
SESSION_SAVE_EVERY_REQUEST = True
# O limite acima renova a cada requisicao. Este e o teto: quem entrou ha mais que isso
# entra de novo, usando o sistema o tempo todo ou nao (ver apps.contas.autenticacao).
SESSION_MAX_LIFETIME = env.int('SESSION_MAX_LIFETIME', default=12 * 3600)

STATIC_URL = 'static/'
DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'

# O cache `limites` guarda os contadores do ThrottleAuth numa tabela do Postgres,
# compartilhada por todos os workers do gunicorn (a tabela e criada pela migration
# contas.0002). O `default` segue em memoria: serve ao throttle geral do DRF, onde
# um limite por processo e aceitavel.
CACHES = {
    'default': {'BACKEND': 'django.core.cache.backends.locmem.LocMemCache'},
    'limites': {
        'BACKEND': 'django.core.cache.backends.db.DatabaseCache',
        'LOCATION': 'cache_limites',
        'OPTIONS': {'MAX_ENTRIES': 10000},
    },
}

REST_FRAMEWORK = {
    'DEFAULT_AUTHENTICATION_CLASSES': ['apps.contas.autenticacao.SessaoDoTefeCidadao'],
    'DEFAULT_PERMISSION_CLASSES': ['rest_framework.permissions.IsAuthenticated'],
    'DEFAULT_RENDERER_CLASSES': ['rest_framework.renderers.JSONRenderer'],
    'DEFAULT_THROTTLE_CLASSES': [
        'rest_framework.throttling.AnonRateThrottle',
        'rest_framework.throttling.UserRateThrottle',
    ],
    'DEFAULT_THROTTLE_RATES': {
        'anon': '60/minute',
        'user': '120/minute',
    },
    # Sem isto o throttle anônimo usaria o X-Forwarded-For inteiro como chave.
    'NUM_PROXIES': TRUSTED_PROXIES,
}

LOGGING = {
    'version': 1,
    'disable_existing_loggers': False,
    'handlers': {
        'console': {'class': 'logging.StreamHandler'},
    },
    'loggers': {
        'apps.contas': {
            'handlers': ['console'],
            'level': 'INFO',
            'propagate': False,
        },
        'apps.auditoria': {
            'handlers': ['console'],
            'level': 'INFO',
            'propagate': False,
        },
    },
}

# --- Tefe Cidadao (Keycloak) ---
# Onde os anexos do prontuario sao gravados. Em producao precisa ser volume
# persistente: container recriado sem volume perde RG e comprovante de
# residencia dos cidadaos, e o metadado no banco fica apontando para o vazio.
ARMAZENAMENTO_LOCAL = env('LOCAL_STORAGE_PATH', default=str(BASE_DIR / 'armazenamento'))

# --- Pre-cadastro do cidadao no Tefe Cidadao ---
PRECADASTRO_ENABLED = env.bool('PRECADASTRO_ENABLED', default=False)
PRECADASTRO_CLIENT_ID = env('PRECADASTRO_CLIENT_ID', default='')
PRECADASTRO_CLIENT_SECRET = env('PRECADASTRO_CLIENT_SECRET', default='')

# --- Cifragem de PII ---
#
# Em producao a cifragem e obrigatoria e vem ligada por padrao. Sem ela CPF, RG e e-mail
# ficam em texto puro no banco, e quem le o banco (ou um backup) le todo mundo. Subir
# assim "so por enquanto" e como esses dados acabam vazando, entao o boot recusa: melhor
# um erro claro na implantacao do que descobrir depois. Em desenvolvimento segue opcional.
PII_ENCRYPTION_ENABLED = env.bool('PII_ENCRYPTION_ENABLED', default=not DEBUG)
PII_ENCRYPTION_KEY = env('PII_ENCRYPTION_KEY', default='')
PII_HMAC_KEY = env('PII_HMAC_KEY', default='')

_COMO_GERAR_CHAVE = 'python -c "import base64, os; print(base64.b64encode(os.urandom(32)).decode())"'

if not DEBUG and not PII_ENCRYPTION_ENABLED:
    raise RuntimeError(
        'PII_ENCRYPTION_ENABLED não pode ficar desligado em produção: os dados pessoais dos '
        'cidadãos ficariam em texto puro no banco. Ligue-o e informe PII_ENCRYPTION_KEY e '
        f'PII_HMAC_KEY (duas chaves diferentes; gere cada uma com: {_COMO_GERAR_CHAVE}).'
    )


def _chave_de_32_bytes(valor: str) -> bool:
    try:
        return len(base64.b64decode(valor, validate=True)) == 32
    except ValueError:
        return False


if PII_ENCRYPTION_ENABLED:
    # Confere no boot, e sem repetir o valor na mensagem: uma chave errada so apareceria
    # no primeiro cadastro salvo, e o erro de uma chave jamais deve ir parar no log.
    for _nome, _valor in (('PII_ENCRYPTION_KEY', PII_ENCRYPTION_KEY), ('PII_HMAC_KEY', PII_HMAC_KEY)):
        if not _chave_de_32_bytes(_valor):
            raise RuntimeError(
                f'{_nome} precisa ser uma chave de 32 bytes em base64 (está ausente ou inválida). '
                f'Gere com: {_COMO_GERAR_CHAVE}'
            )
    if PII_ENCRYPTION_KEY == PII_HMAC_KEY:
        raise RuntimeError(
            'PII_ENCRYPTION_KEY e PII_HMAC_KEY precisam ser diferentes: quem descobrisse uma '
            'teria a outra. Gere uma chave nova para cada.'
        )

KEYCLOAK_URL = env('KEYCLOAK_URL', default='')
KEYCLOAK_REALM = env('KEYCLOAK_REALM', default='')
KEYCLOAK_CLIENT_ID = env('KEYCLOAK_CLIENT_ID', default='')
KEYCLOAK_CLIENT_SECRET = env('KEYCLOAK_CLIENT_SECRET', default='')
KEYCLOAK_REDIRECT_URI = env(
    'KEYCLOAK_REDIRECT_URI',
    default='http://localhost:3000/api/auth/keycloak/callback',
)
FRONTEND_URL = env('FRONTEND_URL', default='http://localhost:3000')

# Atrás do proxy do Next, o navegador manda `Origin` com o domínio do front, mas
# o `Host` que chega aqui é o da API (o proxy troca pelo do destino). Sem listar
# o front, a checagem de origem recusa todo POST protegido por CSRF — hoje, sair
# e reenviar solicitação.
_front = urlparse(FRONTEND_URL)
CSRF_TRUSTED_ORIGINS = [f'{_front.scheme}://{_front.netloc}']
# Outros enderecos pelos quais o front e aberto (o IP da rede num teste, por exemplo).
# Toda escrita autenticada confere o token CSRF e a origem, entao a origem do
# navegador precisa estar aqui. Vazio por padrao.
CSRF_TRUSTED_ORIGINS += env.list('CSRF_TRUSTED_ORIGINS_EXTRAS', default=[])
