"""O relato do caso é um histórico: toda escrita nele acrescenta."""
from django.utils import timezone


def acrescentar_ao_relato(caso, operador, momento, texto: str) -> None:
    """
    Acrescenta uma anotação datada e assinada ao relato do caso.

    O relato é um histórico — a observação da recepção, a evolução durante o
    atendimento, a conclusão —, e quem atende depois lê tudo isso. Por isso toda
    escrita nele acrescenta; substituir apagaria o que os colegas registraram.
    O chamador salva o caso.
    """
    marca = timezone.localtime(momento).strftime('%d/%m/%Y %H:%M')
    anotacao = f'[{marca}] {operador.nome}: {texto}'
    caso.descricao = f'{caso.descricao}\n\n{anotacao}' if caso.descricao else anotacao
