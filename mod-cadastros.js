// ══════════════════════════════════════════════════════════════════════
// MÓDULOS DE FEITIO COMUM
//
// Proprietários, Clientes, Agenda, Propostas e contratos e Financeiro são
// lista + ficha. Cada um aqui é um descritor, não uma tela escrita à mão:
// é o gerador em crud.js que monta. Módulo novo do mesmo feitio vira uma
// configuração de vinte linhas.
//
// Funil, Início, Site e Relatórios NÃO estão aqui: têm forma própria e por
// isso ganham arquivo próprio.
// ══════════════════════════════════════════════════════════════════════

(() => {
  'use strict';

  const SIT_COMPROMISSO = [['marcado','Marcado','autorizado'],['realizado','Realizado','vitrine'],
                           ['cancelado','Cancelado','restrito'],['nao_compareceu','Não compareceu','restrito']];
  const TIPO_COMPROMISSO = [['visita','Visita'],['reuniao','Reunião'],['ligacao','Ligação'],
                            ['vistoria','Vistoria'],['outro','Outro']];
  const SIT_PROPOSTA = [['rascunho','Rascunho','restrito'],['enviada','Enviada','autorizado'],
                        ['em_analise','Em análise','mural'],['aceita','Aceita','vitrine'],
                        ['recusada','Recusada','restrito'],['expirada','Expirada','restrito']];
  const TIPO_CONTRATO = [['venda','Venda'],['locacao','Locação'],
                         ['intermediacao','Intermediação'],['autorizacao','Autorização de venda']];
  const SIT_CONTRATO = [['rascunho','Rascunho','restrito'],['enviado','Enviado','autorizado'],
                        ['assinado','Assinado','vitrine'],['cancelado','Cancelado','restrito'],
                        ['encerrado','Encerrado','autorizado']];

  // ── Proprietários ───────────────────────────────────────────────────
  Crud.criar({
    nome: 'proprietarios', titulo: 'Proprietários',
    tabela: 'proprietario', singular: 'proprietário', plural: 'proprietários',
    rotuloNovo: 'Cadastrar proprietário',
    placeholderBusca: 'Nome, telefone, e-mail…',
    busca: ['nome','telefone','email','cpf_cnpj'],
    ordem: { campo: 'nome', asc: true },
    obrigatorios: ['nome'],
    padrao: { ativo: true },
    colunas: [
      { campo: 'nome', rotulo: 'Nome' },
      { campo: 'telefone', rotulo: 'Telefone' },
      { campo: 'email', rotulo: 'E-mail' },
      { campo: 'cpf_cnpj', rotulo: 'CPF / CNPJ' },
      { campo: 'ativo', rotulo: 'Ativo', tipo: 'bool' },
    ],
    campos: [
      { campo: 'nome', rotulo: 'Nome completo', largo: true },
      { campo: 'telefone', rotulo: 'Telefone', tipo: 'tel', ph: '(53) 9 9999-9999' },
      { campo: 'email', rotulo: 'E-mail', tipo: 'email' },
      { campo: 'cpf_cnpj', rotulo: 'CPF ou CNPJ' },
      { campo: 'ativo', rotulo: 'Ativo', tipo: 'bool', dica: 'Desmarcado, some dos seletores mas continua no que já foi cadastrado.' },
      { campo: 'obs', rotulo: 'Observações', tipo: 'texto', largo: true, secao: 'Notas internas' },
    ],
  });

  // ── Clientes ────────────────────────────────────────────────────────
  Crud.criar({
    nome: 'clientes', titulo: 'Clientes',
    tabela: 'contato', singular: 'cliente', plural: 'clientes',
    rotuloNovo: 'Cadastrar cliente',
    placeholderBusca: 'Nome, telefone, e-mail…',
    busca: ['nome','telefone','email'],
    ordem: { campo: 'nome', asc: true },
    obrigatorios: ['nome'],
    padrao: { ativo: true, favorito: false },
    colunas: [
      { campo: 'nome', rotulo: 'Nome' },
      { campo: 'telefone', rotulo: 'Telefone' },
      { campo: 'categoria_id', rotulo: 'Categoria', tipo: 'ref', ref: 'categoria_cliente' },
      { campo: 'origem_id', rotulo: 'Origem', tipo: 'ref', ref: 'origem_lead' },
      { campo: 'favorito', rotulo: 'Favorito', tipo: 'bool' },
      { campo: 'created_at', rotulo: 'Cadastrado', tipo: 'data' },
    ],
    campos: [
      { campo: 'nome', rotulo: 'Nome', largo: true },
      { campo: 'telefone', rotulo: 'Telefone', tipo: 'tel' },
      { campo: 'email', rotulo: 'E-mail', tipo: 'email' },
      { campo: 'categoria_id', rotulo: 'Categoria', tipo: 'ref', ref: 'categoria_cliente' },
      { campo: 'origem_id', rotulo: 'Origem do contato', tipo: 'ref', ref: 'origem_lead',
        dica: 'É o que mostra qual canal traz cliente de verdade.' },
      { campo: 'favorito', rotulo: 'Favorito', tipo: 'bool', dica: 'Destaca na lista.' },
      { campo: 'ativo', rotulo: 'Ativo', tipo: 'bool' },
      { campo: 'obs', rotulo: 'Observações', tipo: 'texto', largo: true, linhas: 4, secao: 'Notas internas' },
    ],
  });

  // ── Agenda e visitas ────────────────────────────────────────────────
  Crud.criar({
    nome: 'agenda', titulo: 'Agenda e visitas',
    tabela: 'compromisso', singular: 'compromisso', plural: 'compromissos',
    rotuloNovo: 'Novo compromisso',
    placeholderBusca: 'Título, local…',
    busca: ['titulo','local'],
    ordem: { campo: 'inicio', asc: false },
    obrigatorios: ['titulo','inicio'],
    padrao: { tipo: 'visita', situacao: 'marcado' },
    filtro: { campo: 'situacao', rotulo: 'Toda situação', opcoes: SIT_COMPROMISSO.map(o => [o[0], o[1]]) },
    colunas: [
      { campo: 'inicio', rotulo: 'Quando', tipo: 'datahora' },
      { campo: 'titulo', rotulo: 'Compromisso' },
      { campo: 'tipo', rotulo: 'Tipo', tipo: 'fixa', opcoes: TIPO_COMPROMISSO },
      { campo: 'contato_id', rotulo: 'Cliente', tipo: 'ref', ref: 'contato' },
      { campo: 'local', rotulo: 'Local' },
      { campo: 'situacao', rotulo: 'Situação', tipo: 'selo', opcoes: SIT_COMPROMISSO },
    ],
    campos: [
      { campo: 'titulo', rotulo: 'Título', largo: true, ph: 'Visita ao apartamento do Centro' },
      { campo: 'tipo', rotulo: 'Tipo', tipo: 'fixa', opcoes: TIPO_COMPROMISSO },
      { campo: 'inicio', rotulo: 'Início', tipo: 'datahora' },
      { campo: 'fim', rotulo: 'Fim', tipo: 'datahora' },
      { campo: 'local', rotulo: 'Local', largo: true },
      { campo: 'contato_id', rotulo: 'Cliente', tipo: 'ref', ref: 'contato' },
      { campo: 'situacao', rotulo: 'Situação', tipo: 'fixa', opcoes: SIT_COMPROMISSO.map(o => [o[0], o[1]]) },
      { campo: 'obs', rotulo: 'Observações', tipo: 'texto', largo: true, secao: 'Depois da visita' },
      { campo: 'feedback', rotulo: 'O que o cliente achou', tipo: 'texto', largo: true, linhas: 4,
        secao: 'Depois da visita',
        dica: 'A ficha de visita. É daqui que sai o argumento para a próxima oferta.' },
    ],
  });

  // ── Propostas e contratos ───────────────────────────────────────────
  Crud.criar({
    nome: 'contratos', titulo: 'Propostas e contratos',
    tabela: 'contrato', singular: 'contrato', plural: 'contratos',
    rotuloNovo: 'Novo contrato',
    placeholderBusca: 'Observações…',
    busca: ['obs','clicksign_id'],
    ordem: { campo: 'created_at', asc: false },
    padrao: { tipo: 'venda', situacao: 'rascunho', exclusivo: false },
    filtro: { campo: 'situacao', rotulo: 'Toda situação', opcoes: SIT_CONTRATO.map(o => [o[0], o[1]]) },
    colunas: [
      { campo: 'tipo', rotulo: 'Tipo', tipo: 'fixa', opcoes: TIPO_CONTRATO },
      { campo: 'imovel_id', rotulo: 'Imóvel', tipo: 'ref', ref: 'imovel' },
      { campo: 'contato_id', rotulo: 'Cliente', tipo: 'ref', ref: 'contato' },
      { campo: 'valor', rotulo: 'Valor', tipo: 'moeda' },
      { campo: 'comissao_pct', rotulo: 'Comissão %' },
      { campo: 'situacao', rotulo: 'Situação', tipo: 'selo', opcoes: SIT_CONTRATO },
      { campo: 'inicio', rotulo: 'Início', tipo: 'data' },
    ],
    campos: [
      { campo: 'tipo', rotulo: 'Tipo de contrato', tipo: 'fixa', opcoes: TIPO_CONTRATO },
      { campo: 'situacao', rotulo: 'Situação', tipo: 'fixa', opcoes: SIT_CONTRATO.map(o => [o[0], o[1]]) },
      { campo: 'imovel_id', rotulo: 'Imóvel', tipo: 'ref', ref: 'imovel' },
      { campo: 'contato_id', rotulo: 'Cliente', tipo: 'ref', ref: 'contato' },
      { campo: 'proprietario_id', rotulo: 'Proprietário', tipo: 'ref', ref: 'proprietario' },
      { campo: 'valor', rotulo: 'Valor (R$)', tipo: 'moeda', secao: 'Valores e prazo' },
      { campo: 'comissao_pct', rotulo: 'Comissão (%)', tipo: 'numero', passo: '0.01', secao: 'Valores e prazo' },
      { campo: 'inicio', rotulo: 'Início', tipo: 'data', secao: 'Valores e prazo' },
      { campo: 'fim', rotulo: 'Fim', tipo: 'data', secao: 'Valores e prazo' },
      { campo: 'exclusivo', rotulo: 'Exclusividade', tipo: 'bool', secao: 'Valores e prazo',
        dica: 'Só você tem autorização para vender este imóvel no período.' },
      { campo: 'clicksign_id', rotulo: 'Documento no Clicksign', secao: 'Assinatura', largo: true,
        dica: 'Identificador do documento. A integração automática vem depois.' },
      { campo: 'obs', rotulo: 'Observações', tipo: 'texto', largo: true, secao: 'Notas internas' },
    ],
  });

  // O Financeiro saiu daqui: virou módulo próprio em mod-financeiro.js, com
  // visão de caixa, contas, cartões e categorias. Descritor de CRUD não dava
  // conta de saldo por conta nem de projeção.
})();
