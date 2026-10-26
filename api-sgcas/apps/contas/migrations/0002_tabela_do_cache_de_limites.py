from django.conf import settings
from django.core.management import call_command
from django.db import migrations


def criar_tabela(apps, schema_editor):
    """
    Cria a tabela do cache `limites`.

    O Django não a cria sozinho (é o `createcachetable`) e não há migration para
    ela. Fazer aqui garante que o `migrate` — passo obrigatório do deploy — deixe
    o limite de requisições funcionando, sem um comando a mais para esquecer.
    """
    call_command(
        'createcachetable', settings.CACHES['limites']['LOCATION'],
        database=schema_editor.connection.alias, verbosity=0,
    )


class Migration(migrations.Migration):

    dependencies = [
        ('contas', '0001_initial'),
    ]

    operations = [
        migrations.RunPython(criar_tabela, migrations.RunPython.noop),
    ]
