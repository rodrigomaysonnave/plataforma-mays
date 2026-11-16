// ══════════════════════════════════════════════════════════════════════
// MÓDULO: LOCAÇÕES
//
// Administração de aluguéis, no lugar do Pleno (que acabou em 11/2026).
// Banco: migração 80. Acesso: admin ou quem tiver a função "gestão
// imobiliária" (perfil.gestao_locacao). A trava está no banco.
//
// Quatro vistas: Painel (o que pede ação), Mês a mês (cobrar, receber,
// repassar), Contratos e Pessoas.
//
// Regras combinadas com o Rodrigo em 16/11/2026:
//   * cobrança por PIX manual: a tela calcula e monta a mensagem;
//   * multa e juros vão para o proprietário (entram no repasse);
//   * no primeiro aluguel, 100% fica com a imobiliária (intermediação);
//   * aluguel e repasse NÃO entram no caixa; no Financeiro entra só a taxa,
//     lançada pela função do banco ao confirmar o recebimento.
// ══════════════════════════════════════════════════════════════════════

(() => {
  'use strict';
  const { db, esc, avisar, hoje, dataLocal } = Plataforma;

  let alvoEl = null, vista = 'painel', mesEscolhido = null;

  const brl = v => 'R$ ' + Number(v || 0).toLocaleString('pt-BR',
    { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const dataBr = v => v ? new Date(v.slice(0, 10) + 'T12:00:00').toLocaleDateString('pt-BR') : '-';
  const mesBr = v => v ? new Date(v.slice(0, 10) + 'T12:00:00')
    .toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }) : '-';
  const num = v => (v === '' || v == null) ? null : Number(v);
  const dias = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
  const somaDias = (iso, n) => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return dataLocal(d); };
  function somarMeses(iso, n) {
    const [a, m, d] = iso.split('-').map(Number);
    const alvo = new Date(a, m - 1 + n, 1);
    const ultimo = new Date(alvo.getFullYear(), alvo.getMonth() + 1, 0).getDate();
    alvo.setDate(Math.min(d, ultimo));
    return dataLocal(alvo);
  }
  const primeiroNome = n => (n || '').trim().split(/\s+/)[0] || '';
  const soDigitos = t => (t || '').replace(/\D/g, '');
  const linkWhats = (tel, txt) => {
    let d = soDigitos(tel);
    if (d && !d.startsWith('55')) d = '55' + d;
    return `https://wa.me/${d}?text=${encodeURIComponent(txt)}`;
  };

  const SITUACOES = [['rascunho', 'Rascunho'], ['ativo', 'Ativo'], ['aviso', 'Em aviso de saída'],
                     ['encerrado', 'Encerrado'], ['rescindido', 'Rescindido']];
  const GARANTIAS = [['fiador', 'Fiador'], ['caucao', 'Caução'], ['seguro_fianca', 'Seguro fiança'],
                     ['capitalizacao', 'Título de capitalização'], ['garantidora', 'Garantidora (Loft e similares)'],
                     ['sem_garantia', 'Sem garantia']];
  const PAPEIS = [['locador', 'Locador'], ['locatario', 'Locatário'], ['fiador', 'Fiador']];
  const ENCARGOS = ['Condomínio', 'IPTU', 'Água', 'Luz', 'Gás', 'Taxa de lixo', 'Seguro incêndio', 'Multas condominiais'];
  const QUEM = [['', 'Não se aplica'], ['locatario', 'Locatário paga direto'],
                ['cobranca', 'Vem junto na cobrança'], ['locador', 'Locador paga']];
  const DOCS = [['contrato', 'Contrato'], ['vistoria_entrada', 'Vistoria de entrada'], ['vistoria_saida', 'Vistoria de saída'],
                ['aditivo', 'Aditivo'], ['garantia', 'Garantia'], ['outro', 'Outro']];
  const ASSIN = [['completa', 'Assinado'], ['parcial', 'Assinatura parcial'], ['pendente', 'Falta assinar'],
                 ['nao_se_aplica', 'Não precisa']];
  const rot = (lista, v) => (lista.find(x => x[0] === v) || [, v || '-'])[1];
  const opts = (lista, sel) => lista.map(([v, r]) => `<option value="${v}"${v === sel ? ' selected' : ''}>${esc(r)}</option>`).join('');

  // Ícone e cabeçalho de seção, no mesmo desenho dos outros módulos.
  const topo = (titulo, meta, acoes = '') => `
    <div class="secao-topo">
      <div class="secao-titulo"><div class="ponto"></div>
        <div><h2>${titulo}</h2>${meta ? `<div class="secao-meta">${meta}</div>` : ''}</div></div>
      <div class="secao-acoes">${acoes}</div>
    </div>`;

  // ── Dados ───────────────────────────────────────────────────────────
  async function carregar() {
    const [contratos, partes, pessoas, cobrancas, repasses, docs] = await Promise.all([
      db(supabaseClient.from('locacao_contrato').select('*').order('numero'), 'carregar contratos'),
      db(supabaseClient.from('locacao_parte').select('*'), 'carregar partes'),
      db(supabaseClient.from('locacao_pessoa').select('*').order('nome'), 'carregar pessoas'),
      db(supabaseClient.from('locacao_cobranca').select('*').order('vencimento'), 'carregar cobranças'),
      db(supabaseClient.from('locacao_repasse').select('*'), 'carregar repasses'),
      db(supabaseClient.from('locacao_documento').select('*').order('created_at'), 'carregar documentos'),
    ]);
    const pessoa = id => pessoas.find(p => p.id === id) || {};
    const partesDe = (cid, papel) => partes.filter(p => p.contrato_id === cid && (!papel || p.papel === papel))
      .map(p => ({ ...p, pessoa: pessoa(p.pessoa_id) }));
    const contrato = id => contratos.find(c => c.id === id) || {};
    const rotulo = c => c.imovel_rotulo || c.imovel_endereco || `Contrato ${c.numero}`;
    return { contratos, partes, pessoas, cobrancas, repasses, docs, pessoa, partesDe, contrato, rotulo };
  }

  // O que falta no cadastro, do jeito que o Pleno mostrava.
  function faltas(p, papeis) {
    const f = [];
    if (!p.cpf_cnpj) f.push('CPF/CNPJ');
    if (!p.telefone) f.push('telefone');
    if (!p.endereco || !p.cidade) f.push('endereço');
    if (papeis.includes('locatario') || papeis.includes('fiador') || papeis.includes('locador')) {
      if (!p.rg && p.tipo_pessoa !== 'PJ') f.push('RG');
    }
    if (papeis.includes('locatario') && !p.email) f.push('e-mail');
    if (papeis.includes('locador') && !p.pix && !p.conta) f.push('PIX para repasse');
    return f;
  }

  const extrasDe = cb => (cb.itens || []).reduce((s, i) => s + Number(i.valor || 0), 0);
  const totalDe = cb => Number(cb.aluguel || 0) + extrasDe(cb);

  // Multa e juros pela regra do contrato: multa fixa e juros por dia.
  function encargosAtraso(cb, ct, pagoEm) {
    const atraso = dias(cb.vencimento, pagoEm);
    if (atraso <= 0) return { atraso: 0, multa: 0, juros: 0 };
    const base = totalDe(cb);
    const multa = Math.round(base * Number(ct.multa_atraso_pct || 0)) / 100;
    const juros = Math.round(base * Number(ct.juros_mes_pct || 0) / 30 * atraso) / 100;
    return { atraso, multa, juros };
  }

  function taxaDe(cb, ct) {
    const base = totalDe(cb);
    if (cb.intermediacao) return Math.round(base * Number(ct.taxa_intermediacao_pct || 0)) / 100;
    if (ct.taxa_adm_fixa != null) return Number(ct.taxa_adm_fixa);
    return Math.round(base * Number(ct.taxa_adm_pct || 0)) / 100;
  }

  // Último dia útil de fevereiro: prazo da DIMOB.
  function prazoDimob(ano) {
    const d = new Date(ano, 2, 0);
    while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() - 1);
    return dataLocal(d);
  }

  // ── Entrada ─────────────────────────────────────────────────────────
  async function montar(alvo, sub) {
    alvoEl = alvo;
    if (sub) vista = sub;
    const eu = Plataforma.perfil;
    if (!eu || !(eu.papel === 'admin' || eu.gestao_locacao)) {
      alvo.innerHTML = `
        <div class="vazio"><div class="vazio-ico">◎</div>
          <h3>Locações é da gestão imobiliária</h3>
          <p>Quem acessa: administrador e quem ele marcar com a função "gestão imobiliária"
             em Corretores. A trava está no banco.</p></div>`;
      return;
    }
    if (vista === 'mes') return montarMes(alvo);
    if (vista === 'contratos') return montarContratos(alvo);
    if (vista === 'pessoas') return montarPessoas(alvo);
    return montarPainel(alvo);
  }

  // ══════════════════════════════════════════════════════════════════
  // PAINEL
  // ══════════════════════════════════════════════════════════════════
  async function montarPainel(alvo) {
    const D = await carregar();
    const [vagos, cfg] = await Promise.all([
      db(supabaseClient.from('imovel').select('id,codigo,titulo,complemento,valor_aluguel,updated_at')
        .in('finalidade', ['aluguel', 'venda_aluguel']).eq('status', 'disponivel').eq('rascunho', false), 'carregar vagos'),
      db(supabaseClient.from('configuracao').select('id,pix_locacao').limit(1), 'carregar configuração'),
    ]);
    const d = hoje();
    const ativos = D.contratos.filter(c => ['ativo', 'aviso'].includes(c.situacao));
    const aluguelGestao = ativos.reduce((s, c) => s + Number(c.aluguel || 0), 0);
    const taxaMes = ativos.reduce((s, c) => s + (c.taxa_adm_fixa != null ? Number(c.taxa_adm_fixa)
      : Number(c.aluguel || 0) * Number(c.taxa_adm_pct || 0) / 100), 0);

    // Cobranças: atrasadas, deste mês e próximas.
    const abertas = D.cobrancas.filter(c => !c.pago_em && !c.cancelada);
    const vencidas = abertas.filter(c => c.vencimento < d);
    const mesQueVem = somarMeses(d.slice(0, 8) + '01', 1);
    const geradoMes = m => ativos.length && D.cobrancas.some(c => c.vencimento.slice(0, 7) === m.slice(0, 7));
    // O mês corrente só entra se o vencimento ainda não passou; depois disso
    // quem pede ação é o mês que vem (e evita cobrar de novo o que já foi).
    const ultimoDia = Math.max(0, ...ativos.map(c => Number(c.dia_vencimento || 0)));
    const faltaGerar = [d, mesQueVem].filter(m => ativos.length && !geradoMes(m)
      && (m !== d || Number(d.slice(8, 10)) <= ultimoDia));
    const aRepassar = D.repasses.filter(r => !r.repassado_em);

    // Linha do tempo dos próximos 90 dias.
    const limite = somaDias(d, 90);
    const eventos = [];
    for (const c of ativos) {
      const r = D.rotulo(c);
      const loc = D.partesDe(c.id, 'locatario').map(p => primeiroNome(p.pessoa.nome)).join(', ');
      if (c.proximo_reajuste && c.proximo_reajuste <= limite)
        eventos.push([c.proximo_reajuste, `Reajuste do ${r} pelo ${c.indice || 'índice'} (${brl(c.aluguel)} hoje)`, 'amar', c.id]);
      if (c.fim) {
        const aviso = somaDias(c.fim, -Number(c.aviso_dias || 30));
        if (aviso <= limite) eventos.push([aviso, `Último dia para falar com ${loc || 'o locatário'} sobre o fim do ${r}`, 'amar', c.id]);
        if (c.fim <= limite) eventos.push([c.fim, `Fim do prazo do ${r}${Number(c.prazo_meses) < 30 ? '. Abaixo de 30 meses: sem acordo, vira prazo indeterminado' : ''}`, 'verm', c.id]);
      }
      if (c.garantia_vigencia_fim && c.garantia_vigencia_fim <= limite)
        eventos.push([c.garantia_vigencia_fim, `Garantia do ${r} vence (${c.garantia_empresa || rot(GARANTIAS, c.garantia_tipo)})`, 'verm', c.id]);
    }
    const anoDimob = Number(d.slice(0, 4)) + (d.slice(5, 7) === '12' ? 1 : 0);
    const dimob = prazoDimob(anoDimob);
    if (D.contratos.length && dimob >= d && dimob <= limite)
      eventos.push([dimob, `DIMOB do ano ${anoDimob - 1} para a Receita (último dia útil de fevereiro)`, 'verm', null]);
    eventos.sort((a, b) => a[0].localeCompare(b[0]));

    // Pendências que não têm data, mas travam alguma coisa.
    const pend = [];
    for (const doc of D.docs.filter(x => ['pendente', 'parcial'].includes(x.assinatura))) {
      const c = D.contrato(doc.contrato_id);
      pend.push([`${D.rotulo(c)}: ${doc.titulo} (${rot(ASSIN, doc.assinatura).toLowerCase()})`, c.id, doc.assinatura === 'parcial' || doc.tipo === 'vistoria_entrada']);
    }
    for (const c of ativos) {
      if (['garantidora', 'seguro_fianca', 'capitalizacao'].includes(c.garantia_tipo) && !c.garantia_apolice)
        pend.push([`${D.rotulo(c)}: faltam os dados da garantia (${c.garantia_empresa || 'apólice'} e vigência)`, c.id, false]);
      if (!D.partesDe(c.id, 'locador').length) pend.push([`${D.rotulo(c)}: sem locador cadastrado`, c.id, true]);
    }
    for (const p of D.pessoas) {
      const papeis = D.partes.filter(x => x.pessoa_id === p.id).map(x => x.papel);
      if (!papeis.length) continue;
      const f = faltas(p, papeis);
      if (f.length) pend.push([`${p.nome}: falta ${f.join(', ')}`, 'p:' + p.id, false]);
    }

    const pix = cfg && cfg[0] ? cfg[0].pix_locacao : null;
    const souAdmin = Plataforma.perfil.papel === 'admin';

    alvo.innerHTML = `
      ${topo('Locações', 'Carteira de aluguéis administrados. Aluguel e repasse são dinheiro do proprietário; no caixa entra só a taxa.',
        '<button class="btn" id="loIrMes">Mês a mês</button><button class="btn btn-primario" id="loNovoContrato">Novo contrato</button>')}

      <div class="painel-numeros">
        <div class="num"><span class="num-v">${ativos.length}</span><span class="num-r">Contratos ativos</span></div>
        <div class="num"><span class="num-v">${brl(aluguelGestao)}</span><span class="num-r">Aluguel sob gestão por mês</span></div>
        <div class="num num-destaque"><span class="num-v">${brl(taxaMes)}</span><span class="num-r">Taxa de administração por mês</span></div>
        <div class="num${vencidas.length ? ' num-alerta' : ''}"><span class="num-v">${vencidas.length}</span><span class="num-r">Cobranças atrasadas</span></div>
        <div class="num${aRepassar.length ? ' fi-atencao' : ''}"><span class="num-v">${aRepassar.length}</span><span class="num-r">Repasses a fazer</span></div>
      </div>

      ${!pix ? `
        <div class="ficha-secao fi-secao-alerta"><div style="padding:14px 20px">
          <p class="campo-dica"><strong>Falta a chave PIX da cobrança.</strong> Ela vai na mensagem ao locatário.</p>
          ${souAdmin ? `<div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap">
            <input type="text" id="loPix" placeholder="CNPJ, e-mail ou celular da conta que recebe" style="flex:1;min-width:220px">
            <button class="btn btn-primario" id="loPixSalvar">Salvar</button></div>`
            : '<p class="campo-dica">Peça ao administrador para cadastrar.</p>'}
        </div></div>` : ''}

      ${faltaGerar.length ? `
        <div class="ficha-secao fi-secao-alerta"><div style="padding:14px 20px;display:flex;gap:12px;align-items:center;flex-wrap:wrap">
          <p class="campo-dica" style="flex:1;min-width:220px"><strong>Cobranças ainda não geradas:</strong>
            ${faltaGerar.map(m => mesBr(m)).join(' e ')}. Vencimento em fim de semana passa para segunda.</p>
          ${faltaGerar.map(m => `<button class="btn btn-primario" data-gerar="${m}">Gerar ${esc(mesBr(m).split(' ')[0])}</button>`).join('')}
        </div></div>` : ''}

      <div class="rel-grade">
        <section class="ficha-secao${vencidas.length ? ' fi-secao-alerta' : ''}">
          <div class="ficha-secao-topo"><h3>Cobranças em aberto<span class="ini-conta">${abertas.length}</span></h3>
            <p>Atrasada em vermelho. Clique para abrir o mês.</p></div>
          <div style="padding:12px 20px">
            ${abertas.length ? `<ul class="ini-lista lo-lista">${abertas.slice(0, 8).map(cb => {
              const c = D.contrato(cb.contrato_id);
              const atras = cb.vencimento < d;
              return `<li data-mes="${cb.vencimento.slice(0, 7)}" style="cursor:pointer">
                <span class="ini-hora${atras ? ' ini-vencida' : ''}">${dataBr(cb.vencimento).slice(0, 5)}</span>
                <span class="ini-txt">${esc(D.rotulo(c))} · ${esc(D.partesDe(c.id, 'locatario').map(p => primeiroNome(p.pessoa.nome)).join(', '))}</span>
                <span class="ini-sub${atras ? ' ini-vencida' : ''}">${brl(totalDe(cb))}${atras ? ` · ${dias(cb.vencimento, d)} dias` : ''}</span></li>`;
            }).join('')}</ul>` : '<p class="ini-vazio">Nada em aberto.</p>'}
          </div>
        </section>

        <section class="ficha-secao">
          <div class="ficha-secao-topo"><h3>Próximos 90 dias<span class="ini-conta">${eventos.length}</span></h3>
            <p>Reajustes, fim de contrato, garantias e DIMOB.</p></div>
          <div style="padding:12px 20px">
            ${eventos.length ? `<ul class="ini-lista lo-lista">${eventos.map(([dt, txt, cor, cid]) => `
              <li ${cid ? `data-contrato="${cid}" style="cursor:pointer"` : ''}>
                <span class="ini-hora" style="color:var(--${cor === 'verm' ? 'vermelho' : 'dourado'})">${dataBr(dt).slice(0, 5)}</span>
                <span class="ini-txt">${esc(txt)}</span>
                <span class="ini-sub">${dias(d, dt) <= 0 ? 'hoje ou passou' : `em ${dias(d, dt)} dias`}</span></li>`).join('')}</ul>`
              : '<p class="ini-vazio">Nada nos próximos 90 dias.</p>'}
          </div>
        </section>

        <section class="ficha-secao">
          <div class="ficha-secao-topo"><h3>Pendências<span class="ini-conta">${pend.length}</span></h3>
            <p>Sem data, mas enfraquecem o contrato ou travam o repasse.</p></div>
          <div style="padding:12px 20px">
            ${pend.length ? `<ul class="ini-lista lo-lista">${pend.map(([txt, ref, grave]) => `
              <li data-ref="${esc(ref)}" style="cursor:pointer"><span class="ini-hora${grave ? ' ini-vencida' : ''}">${grave ? 'urgente' : 'conferir'}</span>
                <span class="ini-txt">${esc(txt)}</span></li>`).join('')}</ul>`
              : '<p class="ini-vazio">Tudo em ordem.</p>'}
          </div>
        </section>

        <section class="ficha-secao">
          <div class="ficha-secao-topo"><h3>Imóveis vagos para alugar<span class="ini-conta">${vagos.length}</span></h3>
            <p>Os marcados como Aluguel e disponíveis no cadastro de imóveis.</p></div>
          <div style="padding:12px 20px">
            ${vagos.length ? `<ul class="ini-lista lo-lista">${vagos.map(i => `
              <li><span class="ini-hora">${esc(i.codigo)}</span>
                <span class="ini-txt">${esc(i.titulo || '')}${i.complemento ? ` · ${esc(i.complemento)}` : ''}</span>
                <span class="ini-sub">${i.valor_aluguel ? brl(i.valor_aluguel) : 'sem valor'}</span></li>`).join('')}</ul>
              <p class="rel-nota">Alugados pela taxa de 10%, somariam ${brl(vagos.reduce((s, i) => s + Number(i.valor_aluguel || 0), 0) * 0.1)} por mês.</p>`
              : '<p class="ini-vazio">Nenhum imóvel vago.</p>'}
          </div>
        </section>
      </div>`;

    document.getElementById('loIrMes').addEventListener('click', () => Plataforma.irPara('locacoes', 'mes'));
    document.getElementById('loNovoContrato').addEventListener('click', () => abrirContrato('novo'));
    alvo.querySelectorAll('[data-gerar]').forEach(b => b.addEventListener('click', async () => {
      b.disabled = true;
      const n = await db(supabaseClient.rpc('locacao_gerar_cobrancas', { p_mes: b.dataset.gerar }), 'gerar cobranças');
      avisar(`${n} cobrança(s) gerada(s).`);
      mesEscolhido = b.dataset.gerar.slice(0, 7);
      Plataforma.irPara('locacoes', 'mes');
    }));
    alvo.querySelectorAll('[data-mes]').forEach(li => li.addEventListener('click', () => {
      mesEscolhido = li.dataset.mes; Plataforma.irPara('locacoes', 'mes');
    }));
    alvo.querySelectorAll('[data-contrato]').forEach(li => li.addEventListener('click', () => abrirContrato(li.dataset.contrato)));
    alvo.querySelectorAll('[data-ref]').forEach(li => li.addEventListener('click', () => {
      const r = li.dataset.ref;
      if (r.startsWith('p:')) abrirPessoa(r.slice(2)); else abrirContrato(r);
    }));
    const ps = document.getElementById('loPixSalvar');
    if (ps) ps.addEventListener('click', async () => {
      const v = document.getElementById('loPix').value.trim();
      if (!v) return avisar('Digite a chave PIX.');
      await db(supabaseClient.from('configuracao').update({ pix_locacao: v }).eq('id', cfg[0].id), 'salvar a chave PIX');
      avisar('Chave PIX salva.');
      montarPainel(alvo);
    });
  }

  // ══════════════════════════════════════════════════════════════════
  // MÊS A MÊS
  // ══════════════════════════════════════════════════════════════════
  async function montarMes(alvo) {
    const D = await carregar();
    const [cfgL] = await Promise.all([
      db(supabaseClient.from('configuracao').select('pix_locacao').limit(1), 'carregar configuração')]);
    const pix = cfgL && cfgL[0] ? cfgL[0].pix_locacao : '';
    const d = hoje();
    // Mês padrão: o primeiro com cobrança em aberto, senão o atual.
    const primeiraAberta = D.cobrancas.find(c => !c.pago_em && !c.cancelada);
    const mes = mesEscolhido || (primeiraAberta ? primeiraAberta.vencimento.slice(0, 7) : d.slice(0, 7));
    const lista = D.cobrancas.filter(c => c.vencimento.slice(0, 7) === mes)
      .sort((a, b) => a.vencimento.localeCompare(b.vencimento));
    const total = lista.filter(c => !c.cancelada).reduce((s, c) => s + totalDe(c), 0);
    const recebido = lista.reduce((s, c) => s + Number(c.valor_pago || 0), 0);
    const meses = [...new Set([...D.cobrancas.map(c => c.vencimento.slice(0, 7)), d.slice(0, 7), mes])].sort();

    const linha = cb => {
      const c = D.contrato(cb.contrato_id);
      const locs = D.partesDe(c.id, 'locatario');
      const atras = !cb.pago_em && !cb.cancelada && cb.vencimento < d;
      const reps = D.repasses.filter(r => r.cobranca_id === cb.id);
      const situ = cb.cancelada ? '<span class="cad-selo cad-selo-vazio">cancelada</span>'
        : cb.pago_em ? `<span class="cad-selo cad-selo-vitrine">recebido ${dataBr(cb.pago_em)}</span>`
        : atras ? `<span class="cad-selo cad-selo-restrito">atrasada ${dias(cb.vencimento, d)} dias</span>`
        : '<span class="cad-selo cad-selo-autorizado">em aberto</span>';
      const msg = `Olá, ${primeiroNome(locs[0] && locs[0].pessoa.nome)}! Segue o aluguel de ${mesBr(cb.competencia)} do ${D.rotulo(c)}: ${brl(totalDe(cb))}, com vencimento em ${dataBr(cb.vencimento)}.${pix ? ` PIX: ${pix}.` : ''} Depois de pagar, me manda o comprovante por aqui. Obrigado! Maysonnave Imóveis`;
      return `
        <tr class="cad-linha" data-cob="${cb.id}">
          <td class="cad-num${atras ? ' ini-vencida' : ''}">${dataBr(cb.vencimento)}</td>
          <td><div class="cad-end-rua">${esc(D.rotulo(c))}${cb.intermediacao ? ' <span class="cad-selo cad-selo-mural">1º aluguel</span>' : ''}</div>
              <div class="cad-end-sub">${esc(locs.map(p => p.pessoa.nome).join(', ') || 'sem locatário')} · ref. ${esc(mesBr(cb.competencia))}</div></td>
          <td class="cad-valor">${brl(totalDe(cb))}${cb.pago_em && Number(cb.valor_pago) !== totalDe(cb) ? `<div class="cad-end-sub">pago ${brl(cb.valor_pago)}</div>` : ''}</td>
          <td>${situ}</td>
          <td class="fi-ag-acao">
            ${!cb.pago_em && !cb.cancelada ? `
              ${locs[0] && locs[0].pessoa.telefone ? `<a class="btn btn-mini" target="_blank" rel="noopener" href="${esc(linkWhats(locs[0].pessoa.telefone, msg))}">Cobrar</a>` : ''}
              <button class="btn btn-mini btn-primario" data-receber="${cb.id}">Recebido</button>` : ''}
            ${cb.pago_em ? `<button class="btn btn-mini" data-desfazer="${cb.id}">Desfazer</button>` : ''}
          </td>
        </tr>
        ${reps.map(r => {
          const p = D.pessoa(r.pessoa_id);
          return `<tr class="lo-repasse"><td></td>
            <td colspan="2"><div class="cad-end-sub">Repasse a ${esc(p.nome || '')}${Number(r.percentual) !== 100 ? ` (${r.percentual}%)` : ''}:
              ${brl(r.bruto)} recebido, menos ${brl(r.taxa)} de ${cb.intermediacao ? 'intermediação' : 'taxa'}${Number(r.despesas) ? ` e ${brl(r.despesas)} de despesas` : ''} =
              <strong>${brl(r.liquido)}</strong>${p.pix ? ` · PIX ${esc(p.pix)}` : ' · <span class="ini-vencida">sem PIX cadastrado</span>'}</div></td>
            <td>${r.repassado_em ? `<span class="cad-selo cad-selo-vitrine">repassado ${dataBr(r.repassado_em)}</span>` : '<span class="cad-selo cad-selo-restrito">a repassar</span>'}</td>
            <td class="fi-ag-acao">
              ${r.repassado_em
                ? `<button class="btn btn-mini" data-desrepassar="${r.id}">Desfazer</button>`
                : `<button class="btn btn-mini btn-primario" data-repassar="${r.id}">Repassado</button>`}
              <button class="btn btn-mini" data-extrato="${r.id}">Extrato</button>
            </td></tr>`;
        }).join('')}`;
    };

    alvo.innerHTML = `
      ${topo('Mês a mês', 'Cobrar, receber e repassar. Cada linha tem o botão que fecha a pendência.',
        `<select id="loMes">${meses.map(m => `<option value="${m}"${m === mes ? ' selected' : ''}>${esc(mesBr(m + '-01'))}</option>`).join('')}</select>
         <button class="btn" id="loGerar">Gerar cobranças do mês</button>`)}
      <div class="painel-numeros">
        <div class="num"><span class="num-v">${lista.filter(c => !c.cancelada).length}</span><span class="num-r">Cobranças</span></div>
        <div class="num"><span class="num-v">${brl(total)}</span><span class="num-r">A receber no mês</span></div>
        <div class="num num-destaque"><span class="num-v">${brl(recebido)}</span><span class="num-r">Recebido</span></div>
        <div class="num"><span class="num-v">${brl(lista.reduce((s, c) => s + D.repasses.filter(r => r.cobranca_id === c.id && r.repassado_em).reduce((x, r) => x + Number(r.liquido), 0), 0))}</span><span class="num-r">Repassado</span></div>
      </div>
      ${!pix ? '<p class="campo-dica" style="margin:0 0 12px">Sem chave PIX cadastrada: a mensagem de cobrança sai sem ela. Cadastre no Painel.</p>' : ''}
      ${lista.length ? `
        <div class="cad-tabela-scroll"><table class="cad-tabela">
          <thead><tr><th>Vencimento</th><th>Contrato</th><th>Valor</th><th>Situação</th><th></th></tr></thead>
          <tbody>${lista.map(linha).join('')}</tbody></table></div>`
        : `<div class="vazio"><div class="vazio-ico">◎</div><h3>Nenhuma cobrança neste mês</h3>
            <p>Use "Gerar cobranças do mês" para criar a de cada contrato ativo.</p></div>`}
      <p class="rel-nota">Clique na linha para ajustar a cobrança (proporcional, desconto, valor, vencimento).
        Multa e juros entram no repasse do proprietário; a taxa vai sozinha para o Financeiro.</p>`;

    document.getElementById('loMes').addEventListener('change', e => { mesEscolhido = e.target.value; montarMes(alvo); });
    document.getElementById('loGerar').addEventListener('click', async () => {
      const n = await db(supabaseClient.rpc('locacao_gerar_cobrancas', { p_mes: mes + '-01' }), 'gerar cobranças');
      avisar(n ? `${n} cobrança(s) gerada(s).` : 'Nada novo: as cobranças deste mês já existem.');
      mesEscolhido = mes; montarMes(alvo);
    });
    alvo.querySelectorAll('tr[data-cob]').forEach(tr => tr.addEventListener('click', e => {
      if (e.target.closest('button, a, input')) return;
      abrirCobranca(tr.dataset.cob);
    }));

    // Recebido: abre na própria linha data, valor, multa e juros já calculados.
    alvo.querySelectorAll('[data-receber]').forEach(b => b.addEventListener('click', e => {
      e.stopPropagation();
      const cb = D.cobrancas.find(x => x.id === b.dataset.receber);
      const ct = D.contrato(cb.contrato_id);
      const cel = b.closest('td');
      const desenhar = dt => {
        const a = encargosAtraso(cb, ct, dt);
        return { a, total: Math.round((totalDe(cb) + a.multa + a.juros) * 100) / 100 };
      };
      let r = desenhar(d);
      cel.innerHTML = `
        <div class="lo-receber">
          <label>Pago em <input type="date" class="lo-dt" value="${d}"></label>
          <label>Multa <input type="number" step="0.01" class="lo-mu" value="${r.a.multa}"></label>
          <label>Juros <input type="number" step="0.01" class="lo-ju" value="${r.a.juros}"></label>
          <label>Valor pago <input type="number" step="0.01" class="lo-vp" value="${r.total}"></label>
          <span class="campo-dica lo-at">${r.a.atraso ? `${r.a.atraso} dias de atraso` : 'em dia'}</span>
          <button class="btn btn-mini btn-primario lo-ok">Confirmar</button>
        </div>`;
      const q = s => cel.querySelector(s);
      q('.lo-dt').addEventListener('change', () => {
        r = desenhar(q('.lo-dt').value);
        q('.lo-mu').value = r.a.multa; q('.lo-ju').value = r.a.juros; q('.lo-vp').value = r.total;
        q('.lo-at').textContent = r.a.atraso ? `${r.a.atraso} dias de atraso` : 'em dia';
      });
      ['.lo-mu', '.lo-ju'].forEach(s => q(s).addEventListener('input', () => {
        q('.lo-vp').value = Math.round((totalDe(cb) + Number(q('.lo-mu').value || 0) + Number(q('.lo-ju').value || 0)) * 100) / 100;
      }));
      cel.addEventListener('click', ev => ev.stopPropagation());
      q('.lo-ok').addEventListener('click', async () => {
        await db(supabaseClient.rpc('locacao_confirmar_recebimento', {
          p_cobranca: cb.id, p_pago_em: q('.lo-dt').value, p_valor_pago: Number(q('.lo-vp').value),
          p_multa: Number(q('.lo-mu').value || 0), p_juros: Number(q('.lo-ju').value || 0), p_forma: 'PIX' }), 'confirmar o recebimento');
        avisar('Recebido. Repasse calculado e taxa lançada no Financeiro.');
        mesEscolhido = mes; montarMes(alvo);
      });
    }));

    alvo.querySelectorAll('[data-desfazer]').forEach(b => b.addEventListener('click', async e => {
      e.stopPropagation();
      await db(supabaseClient.rpc('locacao_desfazer_recebimento', { p_cobranca: b.dataset.desfazer }), 'desfazer o recebimento');
      avisar('Voltou para em aberto. Repasse e lançamento da taxa foram removidos.');
      mesEscolhido = mes; montarMes(alvo);
    }));
    alvo.querySelectorAll('[data-repassar]').forEach(b => b.addEventListener('click', async e => {
      e.stopPropagation();
      await db(supabaseClient.from('locacao_repasse').update({ repassado_em: hoje() }).eq('id', b.dataset.repassar), 'marcar o repasse');
      avisar('Repasse marcado como feito hoje.');
      mesEscolhido = mes; montarMes(alvo);
    }));
    alvo.querySelectorAll('[data-desrepassar]').forEach(b => b.addEventListener('click', async e => {
      e.stopPropagation();
      await db(supabaseClient.from('locacao_repasse').update({ repassado_em: null }).eq('id', b.dataset.desrepassar), 'desfazer o repasse');
      mesEscolhido = mes; montarMes(alvo);
    }));
    alvo.querySelectorAll('[data-extrato]').forEach(b => b.addEventListener('click', e => {
      e.stopPropagation();
      const r = D.repasses.find(x => x.id === b.dataset.extrato);
      const cb = D.cobrancas.find(x => x.id === r.cobranca_id);
      abrirExtrato(D, r, cb);
    }));
  }

  // Extrato do proprietário: página própria, pronta para imprimir em PDF,
  // e o mesmo resumo em texto para o WhatsApp.
  function abrirExtrato(D, r, cb) {
    const c = D.contrato(cb.contrato_id), p = D.pessoa(r.pessoa_id);
    const loc = D.partesDe(c.id, 'locatario').map(x => x.pessoa.nome).join(', ');
    const fr = Number(r.percentual) / 100;
    const linhas = [
      ['Aluguel', Number(cb.aluguel) * fr],
      ...(cb.itens || []).map(i => [i.descricao || 'Ajuste', Number(i.valor) * fr]),
      ...(Number(cb.multa) ? [['Multa por atraso', Number(cb.multa) * fr]] : []),
      ...(Number(cb.juros) ? [['Juros por atraso', Number(cb.juros) * fr]] : []),
      [cb.intermediacao ? 'Intermediação (1º aluguel)' : `Taxa de administração (${c.taxa_adm_pct}%)`, -Number(r.taxa)],
      ...(Number(r.despesas) ? [['Despesas do mês', -Number(r.despesas)]] : []),
    ];
    const texto = `Olá, ${primeiroNome(p.nome)}! Extrato do aluguel de ${mesBr(cb.competencia)} do ${D.rotulo(c)}:\n` +
      linhas.map(([t, v]) => `${t}: ${v < 0 ? '- ' : ''}${brl(Math.abs(v))}`).join('\n') +
      `\nLíquido a repassar: ${brl(r.liquido)}${r.repassado_em ? `, repassado em ${dataBr(r.repassado_em)}` : ''}.\nMaysonnave Imóveis`;
    const w = window.open('', '_blank');
    if (!w) return avisar('O navegador bloqueou a janela do extrato. Libere pop-ups para a Plataforma.');
    w.document.write(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1"><title>Extrato ${esc(D.rotulo(c))} ${esc(mesBr(cb.competencia))}</title>
      <style>body{font:15px/1.5 -apple-system,Helvetica,Arial,sans-serif;color:#2C2416;background:#F5F0E8;margin:0}
      main{max-width:640px;margin:0 auto;padding:28px 16px}h1{font-size:22px;margin:0}.s{color:#6b5e4b;font-size:13px}
      table{width:100%;border-collapse:collapse;margin:18px 0}td{padding:8px 0;border-bottom:1px solid #d8cfc1}td:last-child{text-align:right;white-space:nowrap}
      .t td{font-weight:700;font-size:17px;border-bottom:2px solid #9B7B5A}.b{display:flex;gap:8px;margin-top:18px;flex-wrap:wrap}
      button,a.btn{background:#9B7B5A;color:#fff;border:0;border-radius:8px;padding:9px 14px;font:inherit;cursor:pointer;text-decoration:none}
      footer{margin-top:30px;font-size:11px;color:#6b5e4b;text-align:center}@media print{.b{display:none}body{background:#fff}}</style></head><body><main>
      <h1>Extrato do proprietário</h1>
      <p class="s">Maysonnave Imóveis · CNPJ 58.899.369/0002-49 · CRECI/RS 61580</p>
      <p><strong>${esc(p.nome || '')}</strong><br>${esc(c.imovel_endereco || D.rotulo(c))}<br>
        Locatário: ${esc(loc)}<br>Referência: ${esc(mesBr(cb.competencia))} · recebido em ${dataBr(cb.pago_em)}</p>
      <table>${linhas.map(([t, v]) => `<tr><td>${esc(t)}</td><td>${v < 0 ? '- ' : ''}${brl(Math.abs(v))}</td></tr>`).join('')}
        <tr class="t"><td>Líquido ${r.repassado_em ? `repassado em ${dataBr(r.repassado_em)}` : 'a repassar'}</td><td>${brl(r.liquido)}</td></tr></table>
      ${p.pix ? `<p class="s">PIX do proprietário: ${esc(p.pix)}</p>` : ''}
      <div class="b"><button onclick="print()">Salvar em PDF</button>
        ${p.telefone ? `<a class="btn" target="_blank" rel="noopener" href="${esc(linkWhats(p.telefone, texto))}">Enviar no WhatsApp</a>` : ''}</div>
      <footer>Maysonnave Imóveis · Rua XV de Novembro, 666, Loja 67, Pelotas/RS · (53) 98104-1499 · maysimoveis.com</footer>
      </main></body></html>`);
    w.document.close();
    supabaseClient.from('locacao_repasse').update({ extrato_enviado_em: hoje() }).eq('id', r.id).then(() => {});
  }

  // Ficha da cobrança: ajustes que o mês pede (proporcional, desconto,
  // encargo cobrado junto), vencimento e cancelamento.
  async function abrirCobranca(id) {
    const D = await carregar();
    const cb = D.cobrancas.find(x => x.id === id);
    const c = D.contrato(cb.contrato_id);
    let itens = [...(cb.itens || [])];
    const travada = !!cb.pago_em;

    alvoEl.innerHTML = `
      ${topo(`Cobrança ${esc(D.rotulo(c))} · ${esc(mesBr(cb.competencia))}`, travada ? 'Recebida. Para mudar valores, desfaça o recebimento antes.' : '',
        `<button class="btn" id="lcVoltar">Voltar</button>${travada ? '' : '<button class="btn btn-primario" id="lcSalvar">Salvar</button>'}`)}
      <div class="ficha-secao"><div class="ficha-grade">
        <div class="campo"><label>Vencimento</label><input type="date" id="lcVenc" value="${cb.vencimento}" ${travada ? 'disabled' : ''}></div>
        <div class="campo"><label>Aluguel (R$)</label><input type="number" step="0.01" id="lcAluguel" value="${cb.aluguel}" ${travada ? 'disabled' : ''}></div>
        <div class="campo"><label>Mês de referência</label><input type="month" id="lcComp" value="${cb.competencia.slice(0, 7)}" ${travada ? 'disabled' : ''}></div>
        <div class="campo campo-largo"><label class="campo-check"><input type="checkbox" id="lcInter" ${cb.intermediacao ? 'checked' : ''} ${travada ? 'disabled' : ''}>
          <span>Primeiro aluguel: a imobiliária fica com ${c.taxa_intermediacao_pct}% (intermediação) em vez da taxa mensal</span></label></div>
        <div class="campo campo-largo"><label class="campo-check"><input type="checkbox" id="lcCancel" ${cb.cancelada ? 'checked' : ''} ${travada ? 'disabled' : ''}>
          <span>Cancelada (não será cobrada)</span></label></div>
        <div class="campo campo-largo"><label>Observações</label><textarea id="lcObs" rows="2" ${travada ? 'disabled' : ''}>${esc(cb.obs || '')}</textarea></div>
      </div></div>
      <div class="ficha-secao">
        <div class="ficha-secao-topo"><h3>Ajustes do mês</h3>
          <p>Valor negativo é desconto (ex.: proporcional de dias). Positivo é acréscimo (ex.: condomínio cobrado junto).</p></div>
        <div style="padding:14px 20px" id="lcItens"></div>
        ${travada ? '' : `<div style="padding:0 20px 16px;display:flex;gap:8px;flex-wrap:wrap">
          <input type="text" id="lcItDesc" placeholder="Descrição" style="flex:2;min-width:160px">
          <input type="number" step="0.01" id="lcItVal" placeholder="Valor" style="flex:1;min-width:100px">
          <button class="btn" id="lcItAdd">Adicionar</button></div>`}
        <p class="rel-nota" style="padding:0 20px 16px" id="lcTotal"></p>
      </div>`;

    const desenharItens = () => {
      document.getElementById('lcItens').innerHTML = itens.length ? `<ul class="ini-lista">${itens.map((i, k) => `
        <li><span class="ini-txt">${esc(i.descricao || 'Ajuste')}</span><span class="ini-sub">${brl(i.valor)}</span>
          ${travada ? '' : `<button class="btn btn-mini btn-remover" data-tira="${k}">Tirar</button>`}</li>`).join('')}</ul>`
        : '<p class="ini-vazio">Sem ajustes.</p>';
      const al = Number(document.getElementById('lcAluguel').value || 0);
      document.getElementById('lcTotal').innerHTML = `Total a cobrar: <strong>${brl(al + itens.reduce((s, i) => s + Number(i.valor || 0), 0))}</strong>`;
      document.querySelectorAll('[data-tira]').forEach(b => b.addEventListener('click', () => { itens.splice(Number(b.dataset.tira), 1); desenharItens(); }));
    };
    desenharItens();
    document.getElementById('lcAluguel').addEventListener('input', desenharItens);
    document.getElementById('lcVoltar').addEventListener('click', () => { mesEscolhido = cb.vencimento.slice(0, 7); Plataforma.irPara('locacoes', 'mes'); });
    if (travada) return;
    document.getElementById('lcItAdd').addEventListener('click', () => {
      const v = num(document.getElementById('lcItVal').value);
      if (v == null) return avisar('Informe o valor do ajuste.');
      itens.push({ descricao: document.getElementById('lcItDesc').value.trim() || 'Ajuste', valor: v });
      document.getElementById('lcItDesc').value = ''; document.getElementById('lcItVal').value = '';
      desenharItens();
    });
    document.getElementById('lcSalvar').addEventListener('click', async () => {
      const comp = document.getElementById('lcComp').value;
      await db(supabaseClient.from('locacao_cobranca').update({
        vencimento: document.getElementById('lcVenc').value,
        aluguel: num(document.getElementById('lcAluguel').value) || 0,
        competencia: comp ? comp + '-01' : cb.competencia,
        intermediacao: document.getElementById('lcInter').checked,
        cancelada: document.getElementById('lcCancel').checked,
        obs: document.getElementById('lcObs').value.trim() || null, itens,
      }).eq('id', cb.id), 'salvar a cobrança');
      avisar('Cobrança salva.');
      mesEscolhido = document.getElementById('lcVenc').value.slice(0, 7);
      Plataforma.irPara('locacoes', 'mes');
    });
  }

  // ══════════════════════════════════════════════════════════════════
  // CONTRATOS
  // ══════════════════════════════════════════════════════════════════
  async function montarContratos(alvo) {
    const D = await carregar();
    const ordem = { ativo: 0, aviso: 1, rascunho: 2, encerrado: 3, rescindido: 4 };
    const lista = [...D.contratos].sort((a, b) => (ordem[a.situacao] - ordem[b.situacao]) || (a.numero - b.numero));
    alvo.innerHTML = `
      ${topo('Contratos de locação', `${D.contratos.filter(c => c.situacao === 'ativo').length} ativos`,
        '<button class="btn btn-primario" id="loNovo">Novo contrato</button>')}
      ${lista.length ? `<div class="cad-tabela-scroll"><table class="cad-tabela">
        <thead><tr><th>Nº</th><th>Imóvel</th><th>Locatário</th><th>Locador</th><th>Aluguel</th><th>Reajuste</th><th>Fim</th><th>Situação</th></tr></thead>
        <tbody>${lista.map(c => `<tr class="cad-linha" data-id="${c.id}">
          <td class="cad-num">${c.numero}</td>
          <td><div class="cad-end-rua">${esc(D.rotulo(c))}</div><div class="cad-end-sub">${esc(rot(GARANTIAS, c.garantia_tipo))}</div></td>
          <td>${esc(D.partesDe(c.id, 'locatario').map(p => p.pessoa.nome).join(', ') || '-')}</td>
          <td>${esc(D.partesDe(c.id, 'locador').map(p => p.pessoa.nome).join(', ') || '-')}</td>
          <td class="cad-valor">${brl(c.aluguel)}<div class="cad-end-sub">dia ${c.dia_vencimento}</div></td>
          <td class="cad-num">${dataBr(c.proximo_reajuste)}<div class="cad-end-sub">${esc(c.indice || '')}</div></td>
          <td class="cad-num">${dataBr(c.fim)}</td>
          <td><span class="cad-selo ${c.situacao === 'ativo' ? 'cad-selo-vitrine' : c.situacao === 'aviso' ? 'cad-selo-restrito' : 'cad-selo-vazio'}">${esc(rot(SITUACOES, c.situacao))}</span></td>
        </tr>`).join('')}</tbody></table></div>`
        : '<div class="vazio"><div class="vazio-ico">◎</div><h3>Nenhum contrato ainda</h3></div>'}`;
    document.getElementById('loNovo').addEventListener('click', () => abrirContrato('novo'));
    alvo.querySelectorAll('tr[data-id]').forEach(tr => tr.addEventListener('click', () => abrirContrato(tr.dataset.id)));
  }

  async function abrirContrato(id) {
    const D = await carregar();
    const imoveis = await Crud.listaApoio('imovel');
    const novo = id === 'novo';
    const c = novo ? { situacao: 'ativo', finalidade: 'residencial', dia_vencimento: 5, referencia: 'vencido', indice: 'IPCA',
      multa_atraso_pct: 10, juros_mes_pct: 1, multa_rescisoria_alugueis: 3, taxa_adm_pct: 10, taxa_intermediacao_pct: 100,
      aviso_dias: 30, encargos: [] } : D.contrato(id);
    const enc = Object.fromEntries((c.encargos || []).map(e => [e.nome, e.quem]));
    const partes = novo ? [] : D.partesDe(c.id);
    const docs = novo ? [] : D.docs.filter(x => x.contrato_id === c.id);
    const reaj = novo ? [] : await db(supabaseClient.from('locacao_reajuste').select('*').eq('contrato_id', c.id).order('data'), 'carregar reajustes');
    const v = (k, d = '') => esc(c[k] ?? d);
    const campo = (rotulo, html, largo, dica) =>
      `<div class="campo${largo ? ' campo-largo' : ''}"><label>${rotulo}</label>${html}${dica ? `<p class="campo-dica">${dica}</p>` : ''}</div>`;
    const inp = (idc, k, tipo = 'text', extra = '') => `<input type="${tipo}" id="${idc}" value="${v(k)}" ${extra}>`;

    alvoEl.innerHTML = `
      ${topo(novo ? 'Novo contrato de locação' : `Contrato ${c.numero} · ${esc(D.rotulo(c))}`, novo ? 'Salve primeiro; partes e documentos entram depois.' : '',
        `<button class="btn" id="lfVoltar">Voltar</button><button class="btn btn-primario" id="lfSalvar">Salvar</button>`)}

      <div class="ficha-secao"><div class="ficha-secao-topo"><h3>Imóvel e situação</h3></div><div class="ficha-grade">
        ${campo('Apelido curto', inp('lfRot', 'imovel_rotulo', 'text', 'placeholder="603G, Village 21D"'))}
        ${campo('Situação', `<select id="lfSit">${opts(SITUACOES, c.situacao)}</select>`)}
        ${campo('Finalidade', `<select id="lfFin">${opts([['residencial', 'Residencial'], ['comercial', 'Comercial']], c.finalidade)}</select>`)}
        ${campo('Endereço completo', inp('lfEnd', 'imovel_endereco'), true, 'Vai no extrato do proprietário.')}
        ${campo('Imóvel cadastrado (opcional)', `<select id="lfImovel"><option value="">Nenhum</option>${imoveis.map(i => `<option value="${i.id}"${i.id === c.imovel_id ? ' selected' : ''}>${esc(i.nome)}</option>`).join('')}</select>`, true)}
      </div></div>

      ${novo ? '' : `
      <div class="ficha-secao"><div class="ficha-secao-topo"><h3>Partes</h3>
        <p>Locador com % divide o repasse. A pessoa precisa estar cadastrada em Pessoas.</p></div>
        <div style="padding:12px 20px">
          ${partes.length ? `<ul class="ini-lista lo-lista">${partes.map(p => `
            <li><span class="ini-hora">${esc(rot(PAPEIS, p.papel))}</span>
              <span class="ini-txt" data-pessoa="${p.pessoa_id}" style="cursor:pointer;text-decoration:underline">${esc(p.pessoa.nome)}</span>
              <span class="ini-sub">${p.papel === 'locador' ? `${p.percentual}%` : ''}</span>
              <button class="btn btn-mini btn-remover" data-tirar-parte="${p.id}">Tirar</button></li>`).join('')}</ul>` : '<p class="ini-vazio">Ninguém ainda.</p>'}
          <div class="lo-add">
            <select id="lfPessoa" style="flex:2;min-width:180px"><option value="">Escolha a pessoa</option>${D.pessoas.map(p => `<option value="${p.id}">${esc(p.nome)}</option>`).join('')}</select>
            <select id="lfPapel">${opts(PAPEIS, 'locatario')}</select>
            <input type="number" id="lfPct" value="100" min="0" max="100" step="0.01" style="width:90px" title="% do locador">
            <button class="btn" id="lfAddParte">Adicionar</button>
            <button class="btn" id="lfNovaPessoa">Cadastrar pessoa</button>
          </div>
        </div></div>`}

      <div class="ficha-secao"><div class="ficha-secao-topo"><h3>Prazo</h3></div><div class="ficha-grade">
        ${campo('Início', inp('lfIni', 'inicio', 'date'))}
        ${campo('Prazo (meses)', inp('lfPrazo', 'prazo_meses', 'number'), false, 'Abaixo de 30 meses, no fim vira prazo indeterminado se ninguém fizer nada (art. 47).')}
        ${campo('Fim', inp('lfFim', 'fim', 'date'))}
        ${campo('Assinado em', inp('lfAss', 'assinado_em', 'date'))}
        ${campo('Aviso antes do fim (dias)', inp('lfAviso', 'aviso_dias', 'number'))}
        ${campo('Carência para sair sem multa (meses)', inp('lfCar', 'carencia_meses', 'number'))}
      </div></div>

      <div class="ficha-secao"><div class="ficha-secao-topo"><h3>Valores e reajuste</h3></div><div class="ficha-grade">
        ${campo('Aluguel (R$)', inp('lfAluguel', 'aluguel', 'number', 'step="0.01"'))}
        ${campo('Dia do vencimento', inp('lfDia', 'dia_vencimento', 'number', 'min="1" max="31"'))}
        ${campo('O vencimento paga', `<select id="lfRef">${opts([['vencido', 'O mês anterior (mês vencido)'], ['corrente', 'O próprio mês']], c.referencia)}</select>`, false, 'Com garantia, a lei não deixa exigir aluguel adiantado (art. 20).')}
        ${campo('Primeiro vencimento', inp('lfPrim', 'primeiro_vencimento', 'date'))}
        ${campo('Índice', `<select id="lfIndice">${opts([['IPCA', 'IPCA'], ['IGP-M', 'IGP-M'], ['INPC', 'INPC'], ['IVAR', 'IVAR']], c.indice)}</select>`)}
        ${campo('Próximo reajuste', inp('lfReaj', 'proximo_reajuste', 'date'))}
        ${campo('Multa por atraso (%)', inp('lfMulta', 'multa_atraso_pct', 'number', 'step="0.01"'))}
        ${campo('Juros por mês (%)', inp('lfJuros', 'juros_mes_pct', 'number', 'step="0.01"'))}
        ${campo('Multa rescisória (aluguéis)', inp('lfMRes', 'multa_rescisoria_alugueis', 'number', 'step="0.5"'))}
      </div>
      ${novo ? '' : `<div style="padding:0 20px 16px">
        <p class="campo-dica">${reaj.length ? 'Reajustes feitos: ' + reaj.map(r => `${dataBr(r.data)} ${r.indice || ''} ${r.percentual}% (${brl(r.valor_antigo)} para ${brl(r.valor_novo)})`).join('; ') : 'Nenhum reajuste registrado.'}</p>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;align-items:center">
          <input type="number" id="lfReajPct" step="0.0001" placeholder="% do índice em 12 meses" style="width:200px">
          <button class="btn" id="lfReajAplicar">Aplicar reajuste</button>
          <span class="campo-dica" id="lfReajPrev"></span></div></div>`}
      </div>

      <div class="ficha-secao"><div class="ficha-secao-topo"><h3>Remuneração da imobiliária e repasse</h3></div><div class="ficha-grade">
        ${campo('Taxa de administração (%)', inp('lfTaxa', 'taxa_adm_pct', 'number', 'step="0.01"'))}
        ${campo('Ou taxa fixa (R$)', inp('lfTaxaFixa', 'taxa_adm_fixa', 'number', 'step="0.01"'), false, 'Se preencher, vale no lugar do %.')}
        ${campo('Intermediação no 1º aluguel (%)', inp('lfInter', 'taxa_intermediacao_pct', 'number', 'step="0.01"'))}
        ${campo('Dia do repasse', inp('lfDiaRep', 'dia_repasse', 'number'))}
        ${campo('Parceiro', inp('lfParc', 'parceiro'))}
        ${campo('% do parceiro', inp('lfParcPct', 'parceiro_pct', 'number', 'step="0.01"'))}
        <div class="campo campo-largo"><label class="campo-check"><input type="checkbox" id="lfGar" ${c.aluguel_garantido ? 'checked' : ''}>
          <span>Aluguel garantido (a imobiliária repassa mesmo se o locatário atrasar)</span></label></div>
      </div></div>

      <div class="ficha-secao"><div class="ficha-secao-topo"><h3>Encargos</h3><p>Quem paga cada conta do imóvel.</p></div>
        <div class="ficha-grade">${ENCARGOS.map((e, k) => campo(e, `<select data-enc="${esc(e)}">${opts(QUEM, enc[e] || '')}</select>`)).join('')}</div></div>

      <div class="ficha-secao"><div class="ficha-secao-topo"><h3>Garantia</h3></div><div class="ficha-grade">
        ${campo('Tipo', `<select id="lfGTipo"><option value="">Não informado</option>${opts(GARANTIAS, c.garantia_tipo)}</select>`)}
        ${campo('Valor (caução, cobertura)', inp('lfGVal', 'garantia_valor', 'number', 'step="0.01"'))}
        ${campo('Quem guarda a caução', inp('lfGQuem', 'garantia_quem_guarda', 'text', 'placeholder="Locador, imobiliária, poupança"'))}
        ${campo('Empresa (seguradora, garantidora)', inp('lfGEmp', 'garantia_empresa'))}
        ${campo('Apólice ou nº', inp('lfGApo', 'garantia_apolice'))}
        ${campo('Vigência até', inp('lfGVig', 'garantia_vigencia_fim', 'date'))}
        ${campo('Detalhes (imóvel do fiador, matrícula)', `<textarea id="lfGDet" rows="2">${v('garantia_detalhe')}</textarea>`, true)}
      </div></div>

      ${novo ? '' : `
      <div class="ficha-secao"><div class="ficha-secao-topo"><h3>Documentos</h3><p>Ficam numa pasta privada; só a gestão imobiliária abre.</p></div>
        <div style="padding:12px 20px">
          ${docs.length ? `<ul class="ini-lista lo-lista">${docs.map(x => `
            <li><span class="ini-hora${['pendente', 'parcial'].includes(x.assinatura) ? ' ini-vencida' : ''}">${esc(rot(ASSIN, x.assinatura))}</span>
              <span class="ini-txt">${esc(x.titulo)}${x.obs ? `<div class="cad-end-sub">${esc(x.obs)}</div>` : ''}</span>
              ${x.caminho ? `<button class="btn btn-mini" data-abrir-doc="${esc(x.caminho)}">Abrir</button>` : ''}
              ${x.link ? `<a class="btn btn-mini" target="_blank" rel="noopener" href="${esc(x.link)}">Validação</a>` : ''}
              <select data-assin="${x.id}" title="Situação da assinatura">${opts(ASSIN, x.assinatura)}</select>
              <button class="btn btn-mini btn-remover" data-tirar-doc="${x.id}">Tirar</button></li>`).join('')}</ul>` : '<p class="ini-vazio">Nenhum documento.</p>'}
          <div class="lo-add">
            <select id="lfDocTipo">${opts(DOCS, 'contrato')}</select>
            <input type="text" id="lfDocTitulo" placeholder="Título" style="flex:1;min-width:160px">
            <select id="lfDocAss">${opts(ASSIN, 'completa')}</select>
            <input type="file" id="lfDocArq" accept=".pdf,image/*">
            <button class="btn" id="lfDocSubir">Subir</button>
          </div>
        </div></div>`}

      <div class="ficha-secao"><div class="ficha-secao-topo"><h3>Encerramento e observações</h3></div><div class="ficha-grade">
        ${campo('Encerrado em', inp('lfEncEm', 'encerrado_em', 'date'))}
        ${campo('Motivo', inp('lfEncMot', 'motivo_encerramento'))}
        ${campo('Observações', `<textarea id="lfObs" rows="4">${v('obs')}</textarea>`, true)}
      </div></div>`;

    const g = i => document.getElementById(i);
    g('lfVoltar').addEventListener('click', () => Plataforma.irPara('locacoes', 'contratos'));
    g('lfSalvar').addEventListener('click', async () => {
      const dados = {
        imovel_rotulo: g('lfRot').value.trim() || null, situacao: g('lfSit').value, finalidade: g('lfFin').value,
        imovel_endereco: g('lfEnd').value.trim() || null, imovel_id: g('lfImovel').value || null,
        inicio: g('lfIni').value || null, prazo_meses: num(g('lfPrazo').value), fim: g('lfFim').value || null,
        assinado_em: g('lfAss').value || null, aviso_dias: num(g('lfAviso').value) ?? 30, carencia_meses: num(g('lfCar').value),
        aluguel: num(g('lfAluguel').value) || 0, dia_vencimento: num(g('lfDia').value) || 5, referencia: g('lfRef').value,
        primeiro_vencimento: g('lfPrim').value || null, indice: g('lfIndice').value, proximo_reajuste: g('lfReaj').value || null,
        multa_atraso_pct: num(g('lfMulta').value) ?? 0, juros_mes_pct: num(g('lfJuros').value) ?? 0,
        multa_rescisoria_alugueis: num(g('lfMRes').value), taxa_adm_pct: num(g('lfTaxa').value) ?? 0,
        taxa_adm_fixa: num(g('lfTaxaFixa').value), taxa_intermediacao_pct: num(g('lfInter').value) ?? 0,
        dia_repasse: num(g('lfDiaRep').value), parceiro: g('lfParc').value.trim() || null, parceiro_pct: num(g('lfParcPct').value),
        aluguel_garantido: g('lfGar').checked,
        encargos: [...document.querySelectorAll('[data-enc]')].filter(s => s.value).map(s => ({ nome: s.dataset.enc, quem: s.value })),
        garantia_tipo: g('lfGTipo').value || null, garantia_valor: num(g('lfGVal').value),
        garantia_quem_guarda: g('lfGQuem').value.trim() || null, garantia_empresa: g('lfGEmp').value.trim() || null,
        garantia_apolice: g('lfGApo').value.trim() || null, garantia_vigencia_fim: g('lfGVig').value || null,
        garantia_detalhe: g('lfGDet').value.trim() || null, encerrado_em: g('lfEncEm').value || null,
        motivo_encerramento: g('lfEncMot').value.trim() || null, obs: g('lfObs').value.trim() || null,
      };
      if (!dados.imovel_rotulo && !dados.imovel_endereco) return avisar('Dê ao menos um apelido ou o endereço do imóvel.');
      if (!dados.aluguel) return avisar('Informe o valor do aluguel.');
      if (novo) {
        const r = await db(supabaseClient.from('locacao_contrato').insert(dados).select('id'), 'criar o contrato');
        avisar('Contrato criado. Agora adicione as partes.');
        return abrirContrato(r[0].id);
      }
      await db(supabaseClient.from('locacao_contrato').update(dados).eq('id', c.id), 'salvar o contrato');
      avisar('Contrato salvo.');
      abrirContrato(c.id);
    });
    if (novo) return;

    g('lfAddParte').addEventListener('click', async () => {
      if (!g('lfPessoa').value) return avisar('Escolha a pessoa.');
      await db(supabaseClient.from('locacao_parte').insert({ contrato_id: c.id, pessoa_id: g('lfPessoa').value,
        papel: g('lfPapel').value, percentual: num(g('lfPct').value) ?? 100 }), 'adicionar a parte');
      abrirContrato(c.id);
    });
    g('lfNovaPessoa').addEventListener('click', () => abrirPessoa('novo', c.id));
    document.querySelectorAll('[data-pessoa]').forEach(s => s.addEventListener('click', () => abrirPessoa(s.dataset.pessoa, c.id)));
    document.querySelectorAll('[data-tirar-parte]').forEach(b => b.addEventListener('click', async () => {
      await db(supabaseClient.from('locacao_parte').delete().eq('id', b.dataset.tirarParte), 'tirar a parte');
      abrirContrato(c.id);
    }));

    const prev = () => {
      const p = num(g('lfReajPct').value);
      g('lfReajPrev').textContent = p == null ? '' : `${brl(c.aluguel)} vira ${brl(Math.round(c.aluguel * (1 + p / 100) * 100) / 100)}`;
    };
    g('lfReajPct').addEventListener('input', prev);
    g('lfReajAplicar').addEventListener('click', async () => {
      const p = num(g('lfReajPct').value);
      if (p == null) return avisar('Informe o % acumulado do índice.');
      const novoValor = Math.round(c.aluguel * (1 + p / 100) * 100) / 100;
      const data = c.proximo_reajuste || hoje();
      await db(supabaseClient.from('locacao_reajuste').insert({ contrato_id: c.id, data, indice: c.indice, percentual: p,
        valor_antigo: c.aluguel, valor_novo: novoValor }), 'registrar o reajuste');
      await db(supabaseClient.from('locacao_contrato').update({ aluguel: novoValor, proximo_reajuste: somarMeses(data, 12) })
        .eq('id', c.id), 'atualizar o aluguel');
      avisar(`Aluguel reajustado para ${brl(novoValor)}. Cobranças já geradas não mudam; ajuste se precisar.`);
      abrirContrato(c.id);
    });

    document.querySelectorAll('[data-abrir-doc]').forEach(b => b.addEventListener('click', async () => {
      const { data, error } = await supabaseClient.storage.from('locacao').createSignedUrl(b.dataset.abrirDoc, 300);
      if (error) return avisar('Não consegui abrir o arquivo: ' + error.message);
      window.open(data.signedUrl, '_blank', 'noopener');
    }));
    document.querySelectorAll('[data-assin]').forEach(s => s.addEventListener('change', async () => {
      await db(supabaseClient.from('locacao_documento').update({ assinatura: s.value }).eq('id', s.dataset.assin), 'salvar a assinatura');
      avisar('Situação da assinatura salva.');
    }));
    document.querySelectorAll('[data-tirar-doc]').forEach(b => b.addEventListener('click', async () => {
      const doc = docs.find(x => x.id === b.dataset.tirarDoc);
      if (doc.caminho) await supabaseClient.storage.from('locacao').remove([doc.caminho]);
      await db(supabaseClient.from('locacao_documento').delete().eq('id', doc.id), 'tirar o documento');
      abrirContrato(c.id);
    }));
    g('lfDocSubir').addEventListener('click', async () => {
      const arq = g('lfDocArq').files[0];
      const titulo = g('lfDocTitulo').value.trim() || (arq && arq.name);
      if (!arq) return avisar('Escolha o arquivo.');
      const nome = `${c.id}/${Date.now()}-${arq.name.normalize('NFD').replace(/[^\w.-]+/g, '-')}`;
      const { error } = await supabaseClient.storage.from('locacao').upload(nome, arq, { contentType: arq.type || 'application/pdf' });
      if (error) return avisar('Não consegui subir: ' + error.message);
      await db(supabaseClient.from('locacao_documento').insert({ contrato_id: c.id, tipo: g('lfDocTipo').value,
        titulo, caminho: nome, assinatura: g('lfDocAss').value }), 'registrar o documento');
      avisar('Documento salvo.');
      abrirContrato(c.id);
    });
  }

  // ══════════════════════════════════════════════════════════════════
  // PESSOAS
  // ══════════════════════════════════════════════════════════════════
  async function montarPessoas(alvo) {
    const D = await carregar();
    alvo.innerHTML = `
      ${topo('Pessoas', 'Locadores, locatários e fiadores. Dados de documento ficam só aqui, fora do cadastro aberto à equipe.',
        '<input type="search" id="lpBusca" placeholder="Nome ou CPF"><button class="btn btn-primario" id="lpNova">Nova pessoa</button>')}
      <div id="lpCorpo"></div>`;
    const desenhar = () => {
      const q = (document.getElementById('lpBusca').value || '').toLowerCase().trim();
      const lista = D.pessoas.filter(p => !q || [p.nome, p.cpf_cnpj].some(x => (x || '').toLowerCase().includes(q)));
      document.getElementById('lpCorpo').innerHTML = lista.length ? `<div class="cad-tabela-scroll"><table class="cad-tabela">
        <thead><tr><th>Nome</th><th>Papel</th><th>Telefone</th><th>Contratos</th><th>Cadastro</th></tr></thead>
        <tbody>${lista.map(p => {
          const ps = D.partes.filter(x => x.pessoa_id === p.id);
          const papeis = [...new Set(ps.map(x => x.papel))];
          const f = faltas(p, papeis);
          return `<tr class="cad-linha" data-id="${p.id}">
            <td><div class="cad-end-rua">${esc(p.nome)}</div><div class="cad-end-sub">${esc(p.cpf_cnpj || 'sem CPF')}</div></td>
            <td>${esc(papeis.map(x => rot(PAPEIS, x)).join(', ') || '-')}</td>
            <td>${esc(p.telefone || '-')}</td>
            <td>${esc(ps.map(x => D.rotulo(D.contrato(x.contrato_id))).join(', ') || '-')}</td>
            <td>${f.length ? `<span class="cad-selo cad-selo-restrito" title="${esc(f.join(', '))}">falta ${esc(f.join(', '))}</span>` : '<span class="cad-selo cad-selo-vitrine">completo</span>'}</td>
          </tr>`;
        }).join('')}</tbody></table></div>` : '<div class="vazio"><div class="vazio-ico">◎</div><h3>Ninguém encontrado</h3></div>';
      document.querySelectorAll('#lpCorpo tr[data-id]').forEach(tr => tr.addEventListener('click', () => abrirPessoa(tr.dataset.id)));
    };
    document.getElementById('lpBusca').addEventListener('input', desenhar);
    document.getElementById('lpNova').addEventListener('click', () => abrirPessoa('novo'));
    desenhar();
  }

  async function abrirPessoa(id, voltarContrato) {
    const novo = id === 'novo';
    const p = novo ? { tipo_pessoa: 'PF', nacionalidade: 'brasileira' }
      : (await db(supabaseClient.from('locacao_pessoa').select('*').eq('id', id).limit(1), 'abrir a pessoa'))[0];
    const CAMPOS = [
      ['Dados', [['nome', 'Nome completo', 'text', true], ['tipo_pessoa', 'PF ou PJ', [['PF', 'Pessoa física'], ['PJ', 'Pessoa jurídica']]],
        ['cpf_cnpj', 'CPF ou CNPJ'], ['rg', 'RG'], ['rg_orgao', 'Órgão emissor'], ['nacionalidade', 'Nacionalidade'],
        ['estado_civil', 'Estado civil'], ['profissao', 'Profissão'], ['nascimento', 'Nascimento', 'date'],
        ['razao_social', 'Razão social (PJ)'], ['representante', 'Representante (PJ)']]],
      ['Contato e endereço', [['telefone', 'Telefone (WhatsApp)'], ['telefone2', 'Outro telefone'], ['email', 'E-mail'],
        ['cep', 'CEP'], ['endereco', 'Rua'], ['numero', 'Número'], ['complemento', 'Complemento'], ['bairro', 'Bairro'],
        ['cidade', 'Cidade'], ['uf', 'UF']]],
      ['Cônjuge', [['conjuge_nome', 'Nome'], ['conjuge_cpf', 'CPF'], ['conjuge_rg', 'RG']]],
      ['Repasse (locador)', [['pix', 'Chave PIX'], ['banco', 'Banco'], ['agencia', 'Agência'], ['conta', 'Conta']]],
      ['Análise (locatário)', [['renda', 'Renda mensal (R$)', 'number'], ['empregador', 'Empregador'], ['contato_emergencia', 'Contato de emergência']]],
    ];
    alvoEl.innerHTML = `
      ${topo(novo ? 'Nova pessoa' : esc(p.nome), '', `${novo ? '' : '<button class="btn btn-remover" id="lpExcluir">Excluir</button>'}
        <button class="btn" id="lpVoltar">Voltar</button><button class="btn btn-primario" id="lpSalvar">Salvar</button>`)}
      ${CAMPOS.map(([sec, cs]) => `<div class="ficha-secao"><div class="ficha-secao-topo"><h3>${sec}</h3></div><div class="ficha-grade">
        ${cs.map(([k, r, t, largo]) => `<div class="campo${largo ? ' campo-largo' : ''}"><label for="pp_${k}">${r}</label>${Array.isArray(t)
          ? `<select id="pp_${k}">${opts(t, p[k])}</select>`
          : `<input type="${t || 'text'}" id="pp_${k}" value="${esc(p[k] ?? '')}"${t === 'number' ? ' step="0.01"' : ''}>`}</div>`).join('')}
      </div></div>`).join('')}
      <div class="ficha-secao"><div class="ficha-grade"><div class="campo campo-largo"><label for="pp_obs">Observações</label>
        <textarea id="pp_obs" rows="3">${esc(p.obs || '')}</textarea></div></div></div>`;

    const voltar = () => voltarContrato ? abrirContrato(voltarContrato) : Plataforma.irPara('locacoes', 'pessoas');
    document.getElementById('lpVoltar').addEventListener('click', voltar);
    document.getElementById('lpSalvar').addEventListener('click', async () => {
      const dados = {};
      CAMPOS.forEach(([, cs]) => cs.forEach(([k, , t]) => {
        const val = document.getElementById('pp_' + k).value.trim();
        dados[k] = t === 'number' ? num(val) : (val || null);
      }));
      dados.obs = document.getElementById('pp_obs').value.trim() || null;
      dados.tipo_pessoa = dados.tipo_pessoa || 'PF';
      if (!dados.nome) return avisar('O nome é obrigatório.');
      if (novo) await db(supabaseClient.from('locacao_pessoa').insert(dados), 'cadastrar a pessoa');
      else await db(supabaseClient.from('locacao_pessoa').update(dados).eq('id', p.id), 'salvar a pessoa');
      avisar('Pessoa salva.');
      voltar();
    });
    const ex = document.getElementById('lpExcluir');
    if (ex) ex.addEventListener('click', async () => {
      const { error } = await supabaseClient.from('locacao_pessoa').delete().eq('id', p.id);
      if (error) return avisar('Não dá para excluir: a pessoa está em algum contrato. Tire dela o contrato antes.');
      avisar('Pessoa excluída.');
      voltar();
    });
  }

  Plataforma.registrar('locacoes', { titulo: 'Locações', montar });
})();
