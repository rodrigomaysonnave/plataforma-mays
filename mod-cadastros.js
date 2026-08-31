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
  const { db } = Plataforma;

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
  // Abrir um proprietário não mostrava os imóveis dele. O vínculo sempre
  // existiu (`imovel.proprietario_id`), mas só era navegável no sentido
  // contrário: do imóvel se chegava ao dono, do dono não se chegava a
  // imóvel nenhum sem voltar à lista de imóveis e procurar pelo nome.
  //
  // Rascunho entra na lista. É imóvel dele do mesmo jeito, e esconder o
  // que ainda está sendo cadastrado é justamente perder de vista o que
  // falta terminar.
  const STATUS_IMOVEL = { disponivel: 'Disponível', reservado: 'Reservado',
                          vendido: 'Vendido', alugado: 'Alugado', suspenso: 'Suspenso' };

  async function imoveisDoProprietario(proprietarioId) {
    const linhas = await db(supabaseClient.from('imovel')
      .select('id,codigo,titulo,endereco,numero,bairro_id,valor,status,rascunho')
      .eq('proprietario_id', proprietarioId)
      .order('codigo'), 'carregar imóveis do proprietário');

    const bairros = await Crud.listaApoio('bairro');
    const nomeBairro = id => (bairros.find(b => b.id === id) || {}).nome;

    return (linhas || []).map(im => {
      const endereco = [im.endereco, im.numero].filter(Boolean).join(', ');
      const sub = [endereco || null, nomeBairro(im.bairro_id) || null,
                   im.valor ? Crud.brl(im.valor) : null].filter(Boolean).join(' · ');
      return {
        id: im.id,
        rotulo: im.codigo || null,
        titulo: im.titulo || endereco || 'Sem título',
        sub: sub || null,
        selo: im.rascunho ? 'rascunho' : (STATUS_IMOVEL[im.status] || im.status),
        seloTipo: im.rascunho ? 'restrito'
                : im.status === 'disponivel' ? 'autorizado' : 'vitrine',
      };
    });
  }

  Crud.criar({
    nome: 'proprietarios', titulo: 'Proprietários',
    tabela: 'proprietario', singular: 'proprietário', plural: 'proprietários',
    rotuloNovo: 'Cadastrar proprietário',
    placeholderBusca: 'Nome, telefone, e-mail…',
    busca: ['nome','telefone','email','cpf_cnpj'],
    ordem: { campo: 'nome', asc: true },
    obrigatorios: ['nome'],
    padrao: { ativo: true },
    vinculos: {
      titulo: 'Imóveis deste proprietário',
      descricao: 'Clique para abrir a ficha do imóvel.',
      vazio: 'Nenhum imóvel cadastrado no nome dele ainda.',
      modulo: 'imoveis',
      carregar: imoveisDoProprietario,
    },
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
  const CANAIS_INTERACAO = { whatsapp: 'WhatsApp', ligacao: 'Ligação', email: 'E-mail',
                             presencial: 'Presencial', visita: 'Visita', outro: 'Outro' };

  // Junta interação, agenda e negócio numa timeline só — a conversa mora em
  // três tabelas separadas, mas quem abre a ficha do cliente quer ver tudo
  // junto, na ordem em que aconteceu, não caçar em três telas.
  async function carregarAtividadeContato(contatoId) {
    const [interacoes, compromissos, negocios, etapas] = await Promise.all([
      db(supabaseClient.from('interacao').select('*').eq('contato_id', contatoId), 'carregar interações'),
      db(supabaseClient.from('compromisso').select('*').eq('contato_id', contatoId), 'carregar agenda'),
      db(supabaseClient.from('negocio').select('*').eq('contato_id', contatoId), 'carregar negócios'),
      Crud.listaApoio('etapa_funil'),
    ]);
    const etapaPorId = {};
    etapas.forEach(e => { etapaPorId[e.id] = e; });

    const eventos = [];
    interacoes.forEach(i => eventos.push({
      quando: i.quando,
      texto: `${CANAIS_INTERACAO[i.canal] || i.canal || 'Interação'}`
           + `${i.quem ? ' com ' + i.quem : ''}${i.resumo ? ': ' + i.resumo : ''}`,
    }));
    compromissos.forEach(c => {
      const sit = SIT_COMPROMISSO.find(s => s[0] === c.situacao);
      eventos.push({ quando: c.inicio, texto: `Agenda: ${c.titulo}${sit ? ' — ' + sit[1] : ''}` });
    });
    negocios.forEach(n => {
      eventos.push({ quando: n.created_at, texto: 'Negócio aberto' + (n.imovel_id ? ', com imóvel vinculado' : '') });
      const etapa = etapaPorId[n.etapa_id];
      // Sem histórico de etapa no banco, só dá pra contar o resultado final
      // (ganho/perda) — o meio do caminho não fica registrado ainda.
      if (etapa && n.updated_at !== n.created_at && (etapa.resultado === 'ganho' || etapa.resultado === 'perda'))
        eventos.push({ quando: n.updated_at, texto: `Negócio marcado como ${etapa.resultado === 'ganho' ? 'ganho' : 'perdido'}` });
    });
    return eventos;
  }

  Crud.criar({
    nome: 'clientes', titulo: 'Clientes',
    tabela: 'contato', singular: 'cliente', plural: 'clientes',
    rotuloNovo: 'Cadastrar cliente',
    placeholderBusca: 'Nome, telefone, e-mail…',
    busca: ['nome','telefone','email'],
    ordem: { campo: 'nome', asc: true },
    // Só o nome é obrigatório, mesma regra do cadastro rápido no funil: um
    // cliente com contato incompleto ainda é melhor que cliente nenhum, e
    // exigir telefone aqui deixava sem salvar justamente quem tinha nascido
    // no funil só com nome. Telefone e e-mail, quando vierem, continuam
    // sendo conferidos: o que não se aceita é dado errado, não dado vazio.
    obrigatorios: ['nome'],
    validar: dados => {
      if (String(dados.nome).trim().length < 3) return ['Escreva o nome completo do cliente.', 'nome'];
      if (dados.telefone && !Plataforma.telefoneValido(dados.telefone)) return ['Telefone precisa do DDD. Ex.: (53) 99999-9999', 'telefone'];
      if (dados.email && !Plataforma.emailValido(dados.email)) return ['E-mail inválido. Ex.: nome@dominio.com', 'email'];
      return null;
    },
    padrao: { ativo: true, favorito: false },
    whatsapp: 'telefone',
    timeline: { carregar: carregarAtividadeContato },
    colunas: [
      { campo: 'nome', rotulo: 'Nome' },
      { campo: 'telefone', rotulo: 'Telefone' },
      { campo: 'categoria_id', rotulo: 'Categoria', tipo: 'ref', ref: 'categoria_cliente' },
      { campo: 'corretor_id', rotulo: 'Responsável', tipo: 'ref', ref: 'perfil' },
      { campo: 'favorito', rotulo: 'Favorito', tipo: 'bool' },
      { campo: 'created_at', rotulo: 'Cadastrado', tipo: 'data' },
    ],
    campos: [
      { campo: 'nome', rotulo: 'Nome', largo: true },
      { campo: 'telefone', rotulo: 'Telefone', tipo: 'tel' },
      { campo: 'email', rotulo: 'E-mail', tipo: 'email' },
      { campo: 'corretor_id', rotulo: 'Corretor responsável', tipo: 'ref', ref: 'perfil', vazio: 'Sem responsável',
        dica: 'Quem toca esse cliente — reatribui sem perder o histórico.' },
      { campo: 'categoria_id', rotulo: 'Categoria', tipo: 'ref', ref: 'categoria_cliente' },
      { campo: 'origem_id', rotulo: 'Origem do contato', tipo: 'ref', ref: 'origem_lead',
        dica: 'É o que mostra qual canal traz cliente de verdade.' },
      { campo: 'favorito', rotulo: 'Favorito', tipo: 'bool', dica: 'Destaca na lista.' },
      { campo: 'ativo', rotulo: 'Ativo', tipo: 'bool' },
      { campo: 'obs', rotulo: 'Observações', tipo: 'texto', largo: true, linhas: 4, secao: 'Notas internas' },
    ],
  });

  // ── Agenda e visitas ────────────────────────────────────────────────
  // Saiu daqui. Agenda não se lê em tabela, se lê por dia, e desde que ela
  // espelha o Google precisa de salvamento próprio. Ver mod-agenda.js.

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
