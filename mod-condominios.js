// ══════════════════════════════════════════════════════════════════════
// MÓDULO: CONDOMÍNIOS / EMPREENDIMENTOS
//
// Mesmo feitio de Proprietários e Clientes (lista + ficha), então nasce como
// descritor do Crud, não tela escrita à mão. A galeria de fotos usa o mesmo
// Fotos.montar do imóvel — dono = { tabela, coluna, id }, como o comentário
// em fotos.js já previa.
//
// `favorito` decide o que entra na queda "Condomínios" do site público (até
// 6 por vez — a trava do número é no clique, aqui embaixo, não no banco).
// ══════════════════════════════════════════════════════════════════════

(() => {
  'use strict';

  const MAX_FAVORITOS = 6;

  async function validarFavorito(dados, editando) {
    if (!dados.favorito) return null;
    let q = supabaseClient.from('empreendimento').select('id', { count: 'exact', head: true })
      .eq('favorito', true).eq('ativo', true);
    if (editando !== 'novo') q = q.neq('id', editando);
    const { count } = await q;
    if ((count || 0) >= MAX_FAVORITOS)
      return `Já tem ${MAX_FAVORITOS} empreendimentos marcados pro menu do site. Desmarque um antes de adicionar outro.`;
    return null;
  }

  Crud.criar({
    nome: 'condominios', titulo: 'Condomínios / Empreendimentos',
    tabela: 'empreendimento', singular: 'empreendimento', plural: 'empreendimentos',
    rotuloNovo: 'Cadastrar empreendimento',
    placeholderBusca: 'Nome, endereço…',
    busca: ['nome', 'endereco'],
    ordem: { campo: 'nome', asc: true },
    obrigatorios: ['nome'],
    padrao: { ativo: true, favorito: false },
    galeria: { tabela: 'empreendimento_foto', coluna: 'empreendimento_id', pasta: 'empreendimentos' },
    publicaNoSite: true,
    validar: validarFavorito,
    colunas: [
      { campo: 'nome', rotulo: 'Nome' },
      { campo: 'construtora_id', rotulo: 'Construtora', tipo: 'ref', ref: 'construtora' },
      { campo: 'bairro_id', rotulo: 'Bairro', tipo: 'ref', ref: 'bairro' },
      { campo: 'favorito', rotulo: 'No menu do site', tipo: 'bool' },
      { campo: 'ativo', rotulo: 'Ativo', tipo: 'bool' },
    ],
    campos: [
      { campo: 'nome', rotulo: 'Nome do empreendimento', largo: true },
      { campo: 'construtora_id', rotulo: 'Construtora', tipo: 'ref', ref: 'construtora', vazio: 'Nenhuma',
        criarRapido: { rotulo: 'construtora' } },
      { campo: 'endereco', rotulo: 'Endereço', secao: 'Localização' },
      { campo: 'numero', rotulo: 'Número', secao: 'Localização' },
      { campo: 'bairro_id', rotulo: 'Bairro', tipo: 'ref', ref: 'bairro', secao: 'Localização' },
      { campo: 'cidade_id', rotulo: 'Cidade', tipo: 'ref', ref: 'cidade', secao: 'Localização' },
      { campo: 'estado', rotulo: 'Estado', ph: 'RS', secao: 'Localização' },
      { campo: 'favorito', rotulo: 'Mostrar no menu do site', tipo: 'bool',
        dica: `Até ${MAX_FAVORITOS} de cada vez — é o que aparece na queda "Condomínios" pro visitante. Os demais ficam achável só pela busca de lá.` },
      { campo: 'ordem_favorito', rotulo: 'Posição no menu', tipo: 'numero',
        dica: 'Menor número aparece primeiro. Empate ordena por nome.' },
      { campo: 'ativo', rotulo: 'Ativo', tipo: 'bool', dica: 'Desmarcado, some da ficha de imóvel e do site, mas continua no que já foi cadastrado.' },
      { campo: 'descricao', rotulo: 'Descrição', tipo: 'texto', largo: true, linhas: 5, secao: 'Sobre o empreendimento' },
      { campo: 'link_video', rotulo: 'Vídeo do YouTube', ph: 'https://', largo: true, secao: 'Sobre o empreendimento',
        dica: 'Toca embutido na ficha do condomínio no site, sem sair pro YouTube.' },
    ],
  });
})();
