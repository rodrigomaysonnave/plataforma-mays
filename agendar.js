// ══════════════════════════════════════════════════════════════════════
// AGENDAR DE QUALQUER LUGAR
//
// Uma janela só, chamada de onde a visita nasce: a ficha do lead do site, a
// do lead de campanha, o negócio do funil, a fila do Atendimento. Antes
// disso, marcar visita queria dizer sair da ficha, ir na Agenda e digitar de
// novo o nome de quem já estava na tela. Agendamento que dá trabalho não
// acontece, e visita que não é marcada na hora do "sim" some.
//
// Grava na MESMA tabela `compromisso` da Agenda e usa o MESMO espelho do
// Google. Isto aqui é um atalho de entrada, não uma agenda paralela: quem
// quiser mexer no feedback da visita depois abre a ficha completa lá.
//
// A regra da Agenda continua valendo e é o motivo de a ordem ser esta:
// grava aqui primeiro, espelha depois. Falha no Google avisa, mas nunca
// desfaz o compromisso. O dado da casa é o que manda.
//
//   Plataforma.agendar({
//     titulo, tipo, local, obs,          // pré-preenchimento
//     contato_id, imovel_id, negocio_id, // vínculos que já se sabe
//     origem: { tabela, id, nome, telefone, email },  // lead ainda sem contato
//     aoSalvar: async (compromisso) => {}             // o módulo registra o que quiser
//   });
// ══════════════════════════════════════════════════════════════════════

(() => {
  'use strict';
  const { db, esc, avisar } = Plataforma;

  const TIPOS = [['visita', 'Visita'], ['reuniao', 'Reunião'], ['ligacao', 'Ligação'],
                 ['vistoria', 'Vistoria'], ['outro', 'Outro']];

  const DURACOES = [[30, '30 minutos'], [60, '1 hora'], [90, '1h30'], [120, '2 horas'],
                    [180, '3 horas']];

  // Uma hora antes é o padrão porque é o tempo de sair de casa para uma
  // visita em Pelotas. "Sem lembrete" existe porque compromisso registrado
  // só para constar não precisa tocar o celular de ninguém.
  const LEMBRETES = [['10', '10 minutos antes'], ['30', '30 minutos antes'],
                     ['60', '1 hora antes'], ['120', '2 horas antes'],
                     ['1440', '1 dia antes'], ['', 'Sem lembrete']];
  const LEMBRETE_PADRAO = '60';

  const soDigitos = t => String(t || '').replace(/\D/g, '');

  // <input type="datetime-local"> só entende hora local sem fuso.
  const paraCampo = d => {
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
  };

  // Sugestão de horário: a próxima hora cheia daqui a pelo menos uma hora.
  // Ninguém marca visita para 14h37, e deixar o campo vazio faz a pessoa
  // digitar data inteira à mão toda vez.
  function proximaHoraCheia() {
    const d = new Date(Date.now() + 3600000);
    d.setMinutes(0, 0, 0);
    return d;
  }

  function fechar() {
    const m = document.getElementById('agModal');
    if (m) m.remove();
  }

  // ── O contato é o vínculo que a agenda entende ──────────────────────
  // `compromisso` aponta para `contato`, não para lead. Então agendar a
  // partir de um lead solto precisa que ele vire cliente da carteira antes.
  // Mesma travessia que o "Interessado" do funil já fazia, e mesma proteção:
  // procura pelo telefone antes de criar, senão o mesmo interessado que
  // preencheu dois formulários vira dois clientes.
  async function garantirContato(origem) {
    const tel = soDigitos(origem.telefone);
    if (tel && tel.length >= 8) {
      const candidatos = await db(supabaseClient.from('contato')
        .select('id,telefone').not('telefone', 'is', null), 'procurar na carteira');
      const achado = (candidatos || []).find(c => soDigitos(c.telefone).endsWith(tel.slice(-8)));
      if (achado) {
        await vincular(origem, achado.id);
        return achado.id;
      }
    }
    const novo = await db(supabaseClient.from('contato').insert({
      nome: origem.nome, telefone: origem.telefone || null, email: origem.email || null,
      corretor_id: (Plataforma.perfil || {}).id || null,
      created_by: (Plataforma.perfil || {}).id || null,
      obs: origem.obs || 'Criado ao agendar um compromisso.',
    }).select('id').single(), 'criar o cliente');
    await vincular(origem, novo.id);
    return novo.id;
  }

  async function vincular(origem, contatoId) {
    if (!origem.tabela || !origem.id) return;
    await db(supabaseClient.from(origem.tabela)
      .update({ contato_id: contatoId }).eq('id', origem.id), 'vincular o cliente ao lead');
  }

  // ── Espelho no Google ───────────────────────────────────────────────
  // Cópia deliberada da regra do módulo Agenda, e não uma importação: as
  // duas telas gravam a mesma tabela, e o que sobe para o Google tem que
  // seguir a mesma lei em qualquer porta de entrada.
  async function espelhar(c) {
    if (!Plataforma.google) return null;
    try {
      const est = await Plataforma.google('estado');
      if (!est.conectado) {
        avisar('Compromisso salvo na agenda daqui. O Google não está conectado, então não foi espelhado.');
        return null;
      }
      const r = await Plataforma.google('salvar', { compromisso: c });
      if (r.google_event_id) {
        await db(supabaseClient.from('compromisso')
          .update({ google_event_id: r.google_event_id }).eq('id', c.id), 'guardar o id do evento');
      }
      return r;
    } catch (e) {
      avisar('Salvo aqui, mas não foi para o Google: ' + e.message);
      return null;
    }
  }

  // ── A janela ────────────────────────────────────────────────────────
  async function agendar(ctx) {
    ctx = ctx || {};
    fechar();

    const imoveis = await Crud.listaApoio('imovel');
    const inicio = proximaHoraCheia();
    const email = (ctx.origem && ctx.origem.email) || ctx.email || null;
    const quem = (ctx.origem && ctx.origem.nome) || ctx.nome || null;

    const opTipos = TIPOS.map(t =>
      `<option value="${t[0]}"${t[0] === (ctx.tipo || 'visita') ? ' selected' : ''}>${t[1]}</option>`).join('');
    const opDur = DURACOES.map(d =>
      `<option value="${d[0]}"${d[0] === 60 ? ' selected' : ''}>${d[1]}</option>`).join('');
    const opLem = LEMBRETES.map(l =>
      `<option value="${l[0]}"${l[0] === LEMBRETE_PADRAO ? ' selected' : ''}>${l[1]}</option>`).join('');
    const opImoveis = `<option value="">Nenhum</option>` + imoveis.map(o =>
      `<option value="${o.id}"${o.id === ctx.imovel_id ? ' selected' : ''}>${esc(o.nome)}</option>`).join('');

    const overlay = document.createElement('div');
    overlay.className = 'cp-modal';
    overlay.id = 'agModal';
    overlay.innerHTML = `
      <div class="cp-modal-caixa ag-modal-caixa">
        <h3>Agendar</h3>
        ${quem ? `<p class="campo-dica" style="margin:0 0 14px">Com ${esc(quem)}.</p>`
               : '<p class="campo-dica" style="margin:0 0 14px">Vai para a Agenda e para o seu Google.</p>'}

        <div class="ficha-grade ag-modal-grade">
          <div class="campo campo-largo"><label for="agmTitulo">Título</label>
            <input type="text" id="agmTitulo" value="${esc(ctx.titulo || '')}"
                   placeholder="Visita ao apartamento do Centro"></div>

          <div class="campo"><label for="agmTipo">Tipo</label>
            <select id="agmTipo">${opTipos}</select></div>

          <div class="campo"><label for="agmInicio">Quando</label>
            <input type="datetime-local" id="agmInicio" value="${paraCampo(inicio)}"></div>

          <div class="campo"><label for="agmDur">Duração</label>
            <select id="agmDur">${opDur}</select></div>

          <div class="campo"><label for="agmLembrete">Lembrete</label>
            <select id="agmLembrete">${opLem}</select></div>

          <div class="campo campo-largo"><label for="agmLocal">Local</label>
            <input type="text" id="agmLocal" value="${esc(ctx.local || '')}"
                   placeholder="Endereço do encontro"></div>

          <div class="campo campo-largo"><label for="agmImovel">Imóvel</label>
            <select id="agmImovel">${opImoveis}</select></div>

          <div class="campo campo-largo"><label for="agmObs">Observações</label>
            <textarea id="agmObs" rows="2">${esc(ctx.obs || '')}</textarea></div>
        </div>

        ${email ? `
          <label class="campo-check" style="margin-top:14px">
            <input type="checkbox" id="agmConvidar">
            <span>Avisar o cliente por e-mail (${esc(email)})</span>
          </label>
          <p class="campo-dica">O Google manda o convite na hora. Confira o endereço:
            convite disparado não volta atrás, e para desconvidar depois é preciso
            abrir o evento no próprio Google.</p>`
        : `<p class="campo-dica" style="margin-top:14px">Sem e-mail cadastrado, então o
            cliente não recebe convite. Só entra na sua agenda.</p>`}

        <div class="cp-anot-btns" style="margin-top:18px">
          <button class="btn btn-primario" id="agmSalvar">Agendar</button>
          <button class="btn" id="agmCancelar">Cancelar</button>
        </div>
      </div>`;

    document.body.appendChild(overlay);
    overlay.addEventListener('click', e => { if (e.target === overlay) fechar(); });
    document.getElementById('agmCancelar').addEventListener('click', fechar);
    document.getElementById('agmTitulo').focus();

    document.getElementById('agmSalvar').addEventListener('click', async () => {
      const botao = document.getElementById('agmSalvar');
      const v = i => (document.getElementById(i).value || '').trim();

      const titulo = v('agmTitulo');
      if (!titulo) { avisar('O compromisso precisa de título.'); return; }
      if (!v('agmInicio')) { avisar('Informe quando começa.'); return; }

      const dtInicio = new Date(v('agmInicio'));
      if (isNaN(dtInicio)) { avisar('A data não foi entendida.'); return; }
      const dtFim = new Date(dtInicio.getTime() + Number(v('agmDur')) * 60000);

      // Trava dupla: o botão desabilita e a bandeira segura o clique duplo
      // que o navegador dispara antes do disabled valer. Sem isso, dois
      // cliques rápidos viram dois compromissos e dois eventos no Google.
      if (botao.dataset.salvando) return;
      botao.dataset.salvando = '1';
      botao.disabled = true;
      botao.textContent = 'Agendando…';

      try {
        let contatoId = ctx.contato_id || null;
        if (!contatoId && ctx.origem && ctx.origem.nome) {
          contatoId = await garantirContato(ctx.origem);
        }

        const convidar = !!(email && document.getElementById('agmConvidar')
                                  && document.getElementById('agmConvidar').checked);
        const lembrete = v('agmLembrete');

        const dados = {
          titulo, tipo: v('agmTipo'), situacao: 'marcado',
          inicio: dtInicio.toISOString(), fim: dtFim.toISOString(),
          local: v('agmLocal') || null,
          obs: v('agmObs') || null,
          contato_id: contatoId,
          imovel_id: v('agmImovel') || null,
          negocio_id: ctx.negocio_id || null,
          corretor_id: (Plataforma.perfil || {}).id || null,
          lembrete_min: lembrete === '' ? null : Number(lembrete),
          convidado_email: convidar ? email : null,
        };

        const salvo = await db(supabaseClient.from('compromisso')
          .insert(dados).select('*').single(), 'agendar');

        fechar();
        avisar('Agendado.');
        await espelhar(salvo);
        if (ctx.aoSalvar) await ctx.aoSalvar(salvo);
      } catch (e) {
        // db() já avisa. Aqui só devolve o botão, senão a janela fica
        // travada com o compromisso não gravado.
        delete botao.dataset.salvando;
        botao.disabled = false;
        botao.textContent = 'Agendar';
      }
    });
  }

  Plataforma.agendar = agendar;

  // Texto curto para o histórico do lead, igual em todos os módulos que
  // chamam. Fica aqui para não virar quatro versões diferentes da mesma
  // frase espalhadas pelos módulos. Sem concordância de gênero na frase
  // ("visita agendada", "compromisso agendada"): dois-pontos resolve.
  Plataforma.fraseDoAgendamento = c => {
    const q = new Date(c.inicio).toLocaleString('pt-BR',
      { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    const tipo = (TIPOS.find(t => t[0] === c.tipo) || [, 'Compromisso'])[1];
    return `Agendado: ${tipo.toLowerCase()} em ${q}${c.local ? ', ' + c.local : ''}.`;
  };
})();
