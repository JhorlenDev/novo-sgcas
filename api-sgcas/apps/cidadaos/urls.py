from django.urls import path

from apps.cidadaos import api_anexos, api_cadastro, api_impressao, api_lgpd, api_registros

urlpatterns = [
    path('', api_cadastro.buscar, name='cidadaos-buscar'),
    path('novo', api_cadastro.cadastrar, name='cidadao-cadastrar'),
    path('<str:cidadao_id>', api_cadastro.detalhar, name='cidadao-detalhe'),
    path('<str:cidadao_id>/prontuario', api_cadastro.prontuario, name='cidadao-prontuario'),
    path('<str:cidadao_id>/beneficios', api_registros.registrar_beneficio, name='cidadao-registrar-beneficio'),
    path('<str:cidadao_id>/encaminhamentos', api_registros.registrar_encaminhamento, name='cidadao-registrar-encaminhamento'),
    path('<str:cidadao_id>/historico', api_cadastro.historico_do_cidadao, name='cidadao-historico'),
    path('<str:cidadao_id>/duplicidade', api_cadastro.verificar_duplicidade, name='cidadao-duplicidade'),
    path('<str:cidadao_id>/imprimir', api_impressao.imprimir_prontuario, name='cidadao-imprimir-prontuario'),
    path('<str:cidadao_id>/anexos', api_anexos.anexos, name='cidadao-anexos'),
    path('<str:cidadao_id>/anexos/<str:anexo_id>', api_anexos.baixar_anexo, name='anexo-baixar'),
    path('<str:cidadao_id>/anexos/<str:anexo_id>/remover', api_anexos.remover_anexo, name='anexo-remover'),
    # LGPD (Art. 18)
    path('<str:cidadao_id>/exportar', api_lgpd.exportar_dados, name='cidadao-exportar'),
    path('<str:cidadao_id>/dados-pessoais', api_lgpd.eliminar_dados_pessoais, name='cidadao-eliminar-dados'),
    path('<str:cidadao_id>/consentimento-imagem', api_lgpd.revogar_consentimento_imagem, name='cidadao-revogar-imagem'),
    path('<str:cidadao_id>/consentimento-imagem/registrar', api_lgpd.registrar_consentimento_imagem, name='cidadao-registrar-imagem'),
]
