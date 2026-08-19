// ══════════════════════════════════════════════════════════════════════
// MÓDULO: CONSTRUTORAS
//
// Mesmo feitio de Proprietários (lista + ficha), descritor do Crud. Existe
// pra "construtora" em Condomínios/Empreendimentos deixar de ser texto
// solto — sem cadastro, "Alphaville" e "Alphaville Urbanismo" viravam duas
// construtoras diferentes, e não dava pra listar tudo de uma só.
// ══════════════════════════════════════════════════════════════════════

(() => {
  'use strict';

  Crud.criar({
    nome: 'construtoras', titulo: 'Construtoras',
    tabela: 'construtora', singular: 'construtora', plural: 'construtoras',
    rotuloNovo: 'Cadastrar construtora',
    placeholderBusca: 'Nome, e-mail, telefone…',
    busca: ['nome', 'email', 'telefone'],
    ordem: { campo: 'nome', asc: true },
    obrigatorios: ['nome'],
    padrao: { ativo: true },
    colunas: [
      { campo: 'nome', rotulo: 'Nome' },
      { campo: 'site', rotulo: 'Site' },
      { campo: 'telefone', rotulo: 'Telefone' },
      { campo: 'ativo', rotulo: 'Ativo', tipo: 'bool' },
    ],
    campos: [
      { campo: 'nome', rotulo: 'Nome da construtora', largo: true },
      { campo: 'site', rotulo: 'Site', ph: 'https://' },
      { campo: 'telefone', rotulo: 'Telefone', tipo: 'tel', ph: '(53) 9 9999-9999' },
      { campo: 'email', rotulo: 'E-mail', tipo: 'email' },
      { campo: 'ativo', rotulo: 'Ativa', tipo: 'bool', dica: 'Desmarcada, some dos seletores mas continua no que já foi cadastrado.' },
    ],
  });
})();
