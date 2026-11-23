from django.urls import path

from apps.atendimentos import (
    api_acoes_itinerantes,
    api_casos,
    api_encaminhamentos,
    api_fila,
    api_recepcao,
)

recepcao_urlpatterns = [
    path('atendimento', api_recepcao.registrar_recepcao, name='recepcao-registrar'),
    path('atendimentos', api_recepcao.atendimentos_da_recepcao, name='recepcao-atendimentos'),
    path('painel', api_recepcao.painel_da_recepcao, name='recepcao-painel'),
]

fila_urlpatterns = [
    path('', api_fila.fila, name='fila'),
    path('painel', api_fila.painel_da_fila, name='fila-painel'),
    path('painel/<str:grupo>', api_fila.detalhes_do_painel, name='fila-painel-detalhes'),
    path('em-atendimento', api_fila.atendimentos_abertos, name='fila-abertos'),
    path('<str:senha_id>/retomar', api_fila.recuperar_atendimento, name='fila-retomar'),
    path('atendimento-atual', api_fila.atendimento_atual, name='fila-atendimento-atual'),
    path('chamar-proximo', api_fila.chamar_proximo, name='fila-chamar-proximo'),
    path('<str:senha_id>/nao-compareceu', api_fila.nao_compareceu, name='fila-nao-compareceu'),
]

casos_urlpatterns = [
    path('', api_casos.casos, name='casos'),
    path('<str:caso_id>/observacao', api_casos.anotar_caso, name='caso-observacao'),
    path('<str:caso_id>/encaminhar', api_casos.encaminhar, name='caso-encaminhar'),
    path('<str:caso_id>/concluir', api_casos.concluir, name='caso-concluir'),
]

acoes_urlpatterns = [
    path('', api_acoes_itinerantes.acoes_itinerantes, name='acoes-itinerantes'),
    path('resumo', api_acoes_itinerantes.resumo_acoes_itinerantes, name='acoes-resumo'),
    path('<str:acao_id>/concluir', api_acoes_itinerantes.concluir_acao_itinerante, name='acao-concluir'),
    path('<str:acao_id>/balanco', api_acoes_itinerantes.balanco_acao_itinerante, name='acao-balanco'),
    path('<str:acao_id>/excluir', api_acoes_itinerantes.excluir_acao_itinerante, name='acao-excluir'),
]

encaminhamentos_urlpatterns = [
    path('recebidos', api_encaminhamentos.recebidos, name='encaminhamentos-recebidos'),
    path('enviados', api_encaminhamentos.enviados, name='encaminhamentos-enviados'),
    path('<str:encaminhamento_id>', api_encaminhamentos.detalhar, name='encaminhamento-detalhe'),
    path('<str:encaminhamento_id>/aceitar', api_encaminhamentos.aceitar, name='encaminhamento-aceitar'),
    path('<str:encaminhamento_id>/recusar', api_encaminhamentos.recusar, name='encaminhamento-recusar'),
    path('<str:encaminhamento_id>/concluir', api_encaminhamentos.concluir, name='encaminhamento-concluir'),
]

avisos_urlpatterns = [
    path('', api_encaminhamentos.avisos, name='avisos'),
    path('resumo', api_encaminhamentos.resumo_dos_avisos, name='avisos-resumo'),
    path('lidos', api_encaminhamentos.marcar_todos_como_lidos, name='avisos-lidos'),
    path('<str:aviso_id>/lido', api_encaminhamentos.marcar_como_lido, name='aviso-lido'),
]
