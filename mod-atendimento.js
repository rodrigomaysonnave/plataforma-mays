// ══════════════════════════════════════════════════════════════════════
// MÓDULO: ATENDIMENTO
//
// A porta de entrada. Responde três perguntas na ordem em que elas doem:
//   1. Quem chegou e ainda não tem responsável
//   2. Quem tem responsável e ainda não virou negócio
//   3. O que foi conversado, com quem, e quando
//
// A terceira é a que mais importa e é a que nenhum sistema dele tem hoje: a
// conversa mora no WhatsApp pessoal do corretor. No dia em que ele sai, o
// relacionamento sai junto e fica só o telefone. Aqui a interação pertence à
// imobiliária.
// ══════════════════════════════════════════════════════════════════════

(() => {
  'use strict';
  const { db, esc, avisar } = Plataforma;

  let alvoEl = null;

  const CANAIS = [['whatsapp','WhatsApp'],['ligacao','Ligação'],['email','E-mail'],
                  ['presencial','Presencial'],['visita','Visita'],['outro','Outro']];

  const quando = iso => {
    const dias = Math.floor((Date.now() - new Date(iso)) / 86400000);
    if (dias === 0) return 'hoje';
    if (dias === 1) return 'ontem';
    if (dias < 30) return `há ${dias} dias`;
    return new Date(iso).toLocaleDateString('pt-BR');
  };

  async function montar(alvo) {
    alvoEl = alvo;
    const [contatos, negocios, interacoes, origens, corretores, etapas] = await Promise.all([
      db(supabaseClient.from('contato').select('*').eq('ativo', true).order('created_at', { ascending: false }), 'carregar contatos'),
      db(supabaseClient.from('negocio').select('id,contato_id'), 'carregar negócios'),
      db(supabaseClient.from('interacao').select('*').order('quando', { ascending: false }).limit(25), 'carregar interações'),
      db(supabaseClient.from('origem_lead').select('id,nome'), 'carregar origens'),
      db(supabaseClient.from('perfil').select('id,nome').eq('aprovado', true), 'carregar corretores'),
      db(supabaseClient.from('etapa_funil').select('id,nome').eq('ativo', true).order('ordem'), 'carregar etapas'),
    ]);

    const comNegocio = new Set(negocios.map(n => n.contato_id));
    const nome = (lista, id) => (lista.find(x => x.id === id) || {}).nome || '—';

    const semResponsavel = contatos.filter(c => !c.corretor_id);
    const semNegocio     = contatos.filter(c => c.corretor_id && !comNegocio.has(c.id));

    const linhaLead = (c, acoes) => `
      <tr class="cad-linha" data-id="${c.id}">
        <td><div class="cad-end-rua">${esc(c.nome)}</div>
            <div class="cad-end-sub">${esc(c.telefone || 'sem telefone')}${c.email ? ' · ' + esc(c.email) : ''}</div></td>
        <td><span class="cad-fin">${esc(nome(origens, c.origem_id))}</span></td>
        <td class="cad-num">${quando(c.created_at)}</td>
        <td>${c.corretor_id ? esc(nome(corretores, c.corretor_id)) : '<span class="cad-vazio">ninguém</span>'}</td>
        <td class="cad-onde">${acoes}</td>
      </tr>`;

    const tabela = (titulo, explica, itens, vazio, acoes) => `
      <section class="ficha-secao">
        <div class="ficha-secao-topo">
          <h3>${esc(titulo)}<span class="ini-conta">${itens.length}</span></h3>
          <p>${esc(explica)}</p>
        </div>
        ${itens.length ? `<div class="cad-tabela-scroll" style="border:none;border-radius:0">
            <table class="cad-tabela"><tbody>${itens.map(c => linhaLead(c, acoes)).join('')}</tbody></table></div>`
          : `<p class="ini-vazio" style="padding:18px 20px">${esc(vazio)}</p>`}
      </section>`;

    alvo.innerHTML = `
      <div class="secao-topo">
        <div class="secao-titulo"><div class="ponto"></div>
          <div><h2>Atendimento</h2>
          <div class="secao-meta">Quem chegou, quem está sem dono, e o que já foi conversado.</div></div>
        </div>
        <div class="secao-acoes">
          <button class="btn btn-primario" id="atRegistrar">Registrar contato</button>
        </div>
      </div>

      <div class="painel-numeros">
        <div class="num${semResponsavel.length ? ' num-alerta' : ''}"><span class="num-v">${semResponsavel.length}</span><span class="num-r">Sem responsável</span></div>
        <div class="num${semNegocio.length ? ' num-destaque' : ''}"><span class="num-v">${semNegocio.length}</span><span class="num-r">Sem negócio aberto</span></div>
        <div class="num"><span class="num-v">${contatos.length}</span><span class="num-r">Clientes ativos</span></div>
        <div class="num"><span class="num-v">${interacoes.length}</span><span class="num-r">Interações recentes</span></div>
      </div>

      <div id="atForm" hidden></div>

      ${tabela('Sem responsável', 'Lead que entrou e ninguém assumiu. É aqui que atendimento se perde.',
        semResponsavel, 'Todo mundo tem responsável.',
        '<button class="btn btn-mini btn-primario" data-acao="assumir">Assumir</button>')}

      ${tabela('Sem negócio aberto', 'Tem responsável, mas nada no funil. Ou vira negócio, ou vira motivo de perda.',
        semNegocio, 'Todos os clientes têm negócio.',
        '<button class="btn btn-mini" data-acao="negocio">Abrir negócio</button>' +
        '<button class="btn btn-mini" data-acao="conversa">Registrar</button>')}

      <section class="ficha-secao">
        <div class="ficha-secao-topo">
          <h3>Últimas conversas<span class="ini-conta">${interacoes.length}</span></h3>
          <p>Fica na imobiliária, não no celular de quem atendeu.</p>
        </div>
        ${interacoes.length ? `<ul class="ini-lista" style="padding:16px 20px">${interacoes.map(i => `
          <li><span class="ini-hora">${quando(i.quando)}</span>
              <span class="ini-txt"><strong>${esc(nome(contatos, i.contato_id))}</strong> — ${esc(i.resumo)}</span>
              <span class="ini-sub">${esc((CANAIS.find(c => c[0] === i.canal) || [,i.canal])[1])}</span></li>`).join('')}</ul>`
          : '<p class="ini-vazio" style="padding:18px 20px">Nenhuma conversa registrada ainda.</p>'}
      </section>`;

    // ── Ações ────────────────────────────────────────────────────────
    alvo.querySelectorAll('[data-acao]').forEach(b => {
      b.addEventListener('click', async e => {
        e.stopPropagation();
        const id = b.closest('.cad-linha').dataset.id;
        const acao = b.dataset.acao;

        if (acao === 'assumir') {
          await db(supabaseClient.from('contato')
            .update({ corretor_id: Plataforma.perfil.id }).eq('id', id), 'assumir o lead');
          avisar('Lead assumido.');
          return montar(alvoEl);
        }
        if (acao === 'negocio') {
          await db(supabaseClient.from('negocio').insert({
            contato_id: id, etapa_id: (etapas[0] || {}).id, corretor_id: Plataforma.perfil.id,
          }), 'abrir o negócio');
          avisar(`Negócio aberto na etapa "${(etapas[0] || {}).nome}". Está no funil.`);
          return montar(alvoEl);
        }
        if (acao === 'conversa') formularioConversa(id, contatos);
      });
    });

    document.getElementById('atRegistrar').addEventListener('click', () => formularioConversa(null, contatos));

    function formularioConversa(contatoId, lista) {
      const form = document.getElementById('atForm');
      form.hidden = false;
      form.innerHTML = `
        <section class="ficha-secao">
          <div class="ficha-secao-topo"><h3>Registrar conversa</h3>
            <p>Uma linha basta. O que importa é não perder o que foi dito.</p></div>
          <div class="ficha-grade">
            <div class="campo"><label for="atContato">Cliente</label>
              <select id="atContato"><option value="">Selecione</option>
                ${lista.map(c => `<option value="${c.id}"${c.id === contatoId ? ' selected' : ''}>${esc(c.nome)}</option>`).join('')}</select></div>
            <div class="campo"><label for="atCanal">Canal</label>
              <select id="atCanal">${CANAIS.map(([v,r]) => `<option value="${v}">${r}</option>`).join('')}</select></div>
            <div class="campo campo-largo"><label for="atResumo">O que foi conversado</label>
              <textarea id="atResumo" rows="3" placeholder="Ligou perguntando pelo terreno do Centro. Vai passar amanhã."></textarea></div>
          </div>
          <div class="ficha-rodape" style="padding:0 20px 18px">
            <button class="btn" id="atCancelar">Cancelar</button>
            <button class="btn btn-primario" id="atSalvar">Registrar</button>
          </div>
        </section>`;
      form.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      document.getElementById('atCancelar').addEventListener('click', () => { form.hidden = true; });
      document.getElementById('atSalvar').addEventListener('click', async () => {
        const contato = document.getElementById('atContato').value;
        const resumo  = document.getElementById('atResumo').value.trim();
        if (!contato) { avisar('Escolha o cliente.'); return; }
        if (!resumo)  { avisar('Escreva o que foi conversado.'); return; }
        await db(supabaseClient.from('interacao').insert({
          contato_id: contato, canal: document.getElementById('atCanal').value,
          resumo, quem: Plataforma.perfil.id,
        }), 'registrar a conversa');
        avisar('Conversa registrada.');
        await montar(alvoEl);
      });
    }
  }

  Plataforma.registrar('atendimento', { titulo: 'Atendimento', montar });
})();
