// ══════════════════════════════════════════════════════════════════════
// MÓDULO: SDR · ASSISTENTE IA
//
// O assistente que atende o WhatsApp oficial, em quatro páginas:
//   Painel      · o que está conectado, o que falta e os números;
//   Conversas   · o inbox (mod-conversas.js), aqui dentro;
//   Treinar     · identidade, tom, instruções, base de conhecimento,
//                 exemplos, qualificação, horários. Vale na próxima resposta;
//   Simulador   · conversar com a IA como se fosse o cliente, sem WhatsApp e
//                 sem gravar nada. 👍/👎 em cada resposta ensina a IA.
//
// As regras de segurança (dados só do catálogo, sem endereço, sem negociar,
// regras da Meta) são fixas na função `sdr-responder` e aparecem aqui só
// para leitura: nenhuma configuração as desliga.
// ══════════════════════════════════════════════════════════════════════

(() => {
  'use strict';
  const { db, esc, avisar } = Plataforma;

  let alvoEl = null;
  const souAdmin = () => Plataforma.perfil && Plataforma.perfil.papel === 'admin';

  const DIAS = [['0', 'Dom'], ['1', 'Seg'], ['2', 'Ter'], ['3', 'Qua'], ['4', 'Qui'], ['5', 'Sex'], ['6', 'Sáb']];
  const CAMPOS = { operacao: 'Compra ou aluguel', tipo: 'Tipo de imóvel', bairros: 'Bairros', valor_max: 'Faixa de investimento',
                   objetivo: 'Morar ou investir', prazo: 'Prazo', pagamento: 'Forma de pagamento', dormitorios_min: 'Quartos' };
  const REGRAS_FIXAS = [
    'Dados de imóvel (preço, metragem, quartos, disponibilidade) só do catálogo da Plataforma. Nunca da cabeça da IA.',
    'Nunca informa endereço exato, número, proprietário ou detalhes de segurança do imóvel.',
    'Não negocia preço, não promete desconto, prazo, financiamento nem dá parecer jurídico: chama o corretor.',
    'Só fala de imóveis e da imobiliária (exigência da Meta para IA no WhatsApp).',
    'Diz que é assistente virtual quando perguntam.',
    'Nunca confirma visita sozinha: reserva o horário como "a confirmar" e chama o corretor.',
    'Mensagens curtas, uma pergunta por vez, sem travessão, no formato do WhatsApp.',
    'Sempre chama o corretor quando a pessoa pede gente, se irrita ou está pronta para avançar.',
    'Quem pede para sair (SAIR, PARAR, STOP) não recebe mais nada.',
  ];

  async function chamarFuncao(corpo) {
    const { data, error } = await supabaseClient.functions.invoke('sdr-responder', { body: corpo });
    let motivo = (error && error.message) || (data && data.erro);
    if (error && error.context && typeof error.context.json === 'function') {
      try { const j = await error.context.json(); if (j && j.erro) motivo = j.erro; } catch (e) { /* mantém */ }
    }
    if (error || (data && data.erro)) throw new Error(motivo || 'Falha desconhecida');
    return data;
  }

  function topo(titulo, meta, acoes = '') {
    return `<div class="secao-topo"><div class="secao-titulo"><div class="ponto"></div>
      <div><h2>${esc(titulo)}</h2><div class="secao-meta">${meta}</div></div></div>
      <div class="secao-acoes">${acoes}</div></div>`;
  }

  // ══════════════════════════ PAINEL ══════════════════════════════════
  async function painel(alvo) {
    alvo.innerHTML = topo('SDR · Painel', 'O assistente que faz o primeiro atendimento no WhatsApp oficial.') + '<p class="iv-carregando">Conferindo as conexões…</p>';
    let st = null;
    try { st = await chamarFuncao({ status: true }); } catch (e) { st = { erro: e.message }; }

    const desde = new Date(Date.now() - 30 * 86400e3).toISOString();
    const [conversas, msgs, visitas, aval] = await Promise.all([
      db(supabaseClient.from('wa_conversa').select('id,temperatura,precisa_humano,created_at,optout_em').gte('created_at', desde), 'carregar conversas'),
      db(supabaseClient.from('wa_mensagem').select('conversa_id,direcao,autor,status,quando').gte('quando', desde).order('quando'), 'carregar mensagens'),
      db(supabaseClient.from('compromisso').select('id,a_confirmar,situacao').not('wa_conversa_id', 'is', null).gte('created_at', desde), 'carregar visitas'),
      db(supabaseClient.from('sdr_avaliacao').select('nota').gte('created_at', desde), 'carregar avaliações'),
    ]);

    // Tempo até a primeira resposta enviada (IA ou corretor), por conversa.
    const primeira = {}, tempos = [];
    for (const m of msgs) {
      if (m.direcao === 'entrada' && !primeira[m.conversa_id]) primeira[m.conversa_id] = { entrada: Date.parse(m.quando) };
      if (m.direcao === 'saida' && ['enviada', 'entregue', 'lida'].includes(m.status) && primeira[m.conversa_id] && !primeira[m.conversa_id].saida) {
        primeira[m.conversa_id].saida = Date.parse(m.quando);
        tempos.push(primeira[m.conversa_id].saida - primeira[m.conversa_id].entrada);
      }
    }
    const mediana = tempos.length ? tempos.sort((a, b) => a - b)[Math.floor(tempos.length / 2)] : null;
    const fmtTempo = ms => ms == null ? '—' : ms < 60e3 ? `${Math.round(ms / 1e3)} s` : ms < 3600e3 ? `${Math.round(ms / 60e3)} min` : `${(ms / 3600e3).toFixed(1)} h`;
    const semResposta = Object.values(primeira).filter(p => !p.saida).length;
    const enviadasIa = msgs.filter(m => m.autor === 'sdr' && ['enviada', 'entregue', 'lida'].includes(m.status)).length;
    const qualificados = conversas.filter(c => c.temperatura).length;
    const quentes = conversas.filter(c => c.temperatura === 'quente').length;
    const esperando = conversas.filter(c => c.precisa_humano).length;
    const boas = aval.filter(a => a.nota === 'boa').length;

    const item = (ok, titulo, texto, acao = '') => `
      <div class="sdr-status ${ok ? 'ok' : 'falta'}">
        <span class="sdr-status-ico">${ok ? '✓' : '!'}</span>
        <div><b>${titulo}</b><p>${texto}</p>${acao}</div>
      </div>`;
    const s = st && !st.erro ? st : {};
    const iaOk = s.motor === 'gemini' ? s.gemini : s.claude || (s.reserva && s.gemini);
    const whatsOk = s.whatsapp_token && s.whatsapp_verificacao;

    alvo.innerHTML = topo('SDR · Painel', 'O assistente que faz o primeiro atendimento no WhatsApp oficial.',
      `<button class="btn" data-ir-sub="simulador">Testar no simulador</button><button class="btn btn-primario" data-ir-sub="treinar">Treinar a IA</button>`) + `
      ${esperando ? `<div class="cv-alerta" style="cursor:pointer" data-ir-sub="conversas">${esperando} conversa${esperando > 1 ? 's' : ''} esperando por você. Abrir conversas ›</div>` : ''}
      <section class="ficha-secao">
        <div class="ficha-secao-topo"><h3>Conexões</h3><p>O que o assistente precisa para atender sozinho.</p></div>
        <div class="sdr-status-grade">
          ${st && st.erro ? item(false, 'Não consegui conferir', esc(st.erro)) : ''}
          ${item(!!iaOk, 'Inteligência artificial',
            `Atuando: <b>${s.motor === 'gemini' ? 'Gemini' : 'Claude'}</b>${s.reserva ? ', com reserva automática' : ', sem reserva'}. ` +
            `Claude ${s.claude ? 'com chave' : 'sem chave'}, Gemini ${s.gemini ? 'com chave' : 'sem chave'}.`,
            `<p class="campo-dica">Troque em Configurações › Inteligência artificial.</p>`)}
          ${item(!!whatsOk, 'WhatsApp oficial (Meta)',
            whatsOk ? 'Número conectado. As mensagens chegam em Conversas.' : 'Ainda não conectado. Falta criar o App na Meta, verificar o negócio e escolher o número. Até lá, use o Simulador.')}
          ${item(s.google_agendas > 0, 'Agenda Google', s.google_agendas > 0 ? `${s.google_agendas} agenda conectada: a IA oferece horários livres reais e pré-agenda visitas.` : 'Nenhuma agenda conectada: a IA não consegue oferecer horários.')}
          ${item(true, 'Envio automático', s.automatico_liberado ? 'Liberado pelo administrador. Só vale nas conversas em que você escolher "Envia sozinha".' : 'Bloqueado: a IA só escreve rascunhos e você aprova cada envio. Recomendado no começo.')}
        </div>
      </section>
      <section class="ficha-secao">
        <div class="ficha-secao-topo"><h3>Últimos 30 dias</h3><p>Tudo o que entrou pelo WhatsApp oficial.</p></div>
        <div class="sdr-numeros">
          ${[[conversas.length, 'Conversas'], [fmtTempo(mediana), 'Tempo até responder (mediana)'], [semResposta, 'Sem nenhuma resposta'],
             [enviadasIa, 'Respostas da IA enviadas'], [qualificados, 'Leads qualificados'], [quentes, 'Leads quentes'],
             [visitas.length, 'Visitas pré-agendadas pela IA'], [aval.length ? `${Math.round(100 * boas / aval.length)}%` : '—', 'Respostas avaliadas como boas']]
            .map(([v, r]) => `<div class="sdr-num"><b>${esc(String(v))}</b><span>${r}</span></div>`).join('')}
        </div>
      </section>
      <section class="ficha-secao">
        <div class="ficha-secao-topo"><h3>Como colocar para rodar</h3><p>Nesta ordem.</p></div>
        <ol class="sdr-passos">
          <li class="${iaOk ? 'feito' : ''}">IA com chave e crédito (Configurações › Inteligência artificial › Testar a IA).</li>
          <li>Treinar: revise identidade, tom, perguntas e horários, e escreva a base de conhecimento.</li>
          <li>Simulador: converse como cliente, avalie com 👍/👎 até gostar das respostas.</li>
          <li class="${whatsOk ? 'feito' : ''}">Conectar o WhatsApp oficial (App Meta, negócio verificado, número dedicado).</li>
          <li>Ligar a IA em modo "Escreve rascunho" nas conversas e aprovar cada envio por alguns dias.</li>
          <li>Só então, se quiser, liberar o envio automático.</li>
        </ol>
      </section>`;
  }

  // ══════════════════════════ TREINAR ═════════════════════════════════
  async function treinar(container) {
    // Filho próprio: cada redesenho do treino liga os cliques de novo, e no
    // mesmo elemento eles se acumulariam (um "Apagar" pediria duas vezes).
    const alvo = document.createElement('div');
    const [[cfg], conhecimento, exemplos, avaliacoes] = await Promise.all([
      db(supabaseClient.from('sdr_config').select('*').limit(1), 'carregar o treino'),
      db(supabaseClient.from('sdr_conhecimento').select('*').order('ordem').order('created_at'), 'carregar a base de conhecimento'),
      db(supabaseClient.from('sdr_exemplo').select('*').order('created_at', { ascending: false }), 'carregar os exemplos'),
      db(supabaseClient.from('sdr_avaliacao').select('*').eq('nota', 'ruim').order('created_at', { ascending: false }).limit(30), 'carregar as avaliações'),
    ]);
    container.replaceChildren(alvo);
    const c = cfg || {};
    const adm = souAdmin();
    const dis = adm ? '' : 'disabled';
    const at = c.atendimento || {}, vis = c.visitas || {};
    const area = (id, rot, val, dica, linhas = 3, ph = '') => `
      <div class="campo campo-largo"><label for="${id}">${rot}</label>
        <textarea id="${id}" rows="${linhas}" ${dis} placeholder="${esc(ph)}">${esc(val || '')}</textarea>
        ${dica ? `<p class="campo-dica">${dica}</p>` : ''}</div>`;
    const horas = (id, sel, de, ate) => `<div class="sdr-horas" id="${id}">${Array.from({ length: ate - de + 1 }, (_, i) => de + i)
      .map(h => `<label class="sdr-chip"><input type="checkbox" value="${h}" ${(sel || []).includes(h) ? 'checked' : ''} ${dis}><span>${h}h</span></label>`).join('')}</div>`;

    alvo.innerHTML = topo('SDR · Treinar a IA', 'Tudo aqui entra na próxima resposta da IA. Teste no Simulador depois de mudar.',
      `<button class="btn" data-ir-sub="simulador">Abrir o simulador</button>`) + `
      ${adm ? '' : '<div class="sdr-aviso">Só o administrador altera o treino. Você pode ler e avaliar respostas no Simulador.</div>'}

      <section class="ficha-secao">
        <div class="ficha-secao-topo"><h3>Identidade e jeito de falar</h3><p>Quem é o assistente e como ele soa.</p></div>
        <div class="ficha-grade">
          <div class="campo"><label for="sdrNome">Nome do assistente</label><input type="text" id="sdrNome" value="${esc(c.nome_assistente || '')}" ${dis}>
            <p class="campo-dica">Como ele se identifica se perguntarem.</p></div>
          ${area('sdrApresentacao', 'Apresentação na primeira mensagem', c.apresentacao, 'A IA adapta ao que a pessoa escreveu, não copia palavra por palavra.', 2)}
          ${area('sdrTom', 'Tom de voz', c.tom, 'Ex.: formal ou próximo, emojis, como tratar a pessoa.', 2)}
          ${area('sdrInstrucoes', 'Instruções do corretor', c.instrucoes, 'O jeito de vender da Maysonnave. Escreva como se estivesse orientando um corretor novo.', 6,
            'Ex.: Sempre pergunte se a pessoa já visitou o bairro. Em imóvel de alto padrão, valorize localização e privacidade antes da metragem. Se a pessoa for investidor, fale de valorização e liquidez.')}
          ${area('sdrNunca', 'Nunca diga ou faça', c.nunca_dizer, 'Proibições específicas da imobiliária (as de segurança já são fixas, abaixo).', 3)}
          ${area('sdrChamar', 'Também chame o corretor quando', c.quando_chamar, 'Além dos casos fixos (pedido de humano, irritação, lead quente).', 3)}
        </div>
      </section>

      <section class="ficha-secao">
        <div class="ficha-secao-topo"><h3>Qualificação</h3><p>O que a IA descobre ao longo da conversa, sem parecer formulário. Desmarque o que não quiser perguntar.</p></div>
        <div class="sdr-perguntas">
          ${(c.perguntas || []).map((q, i) => `
            <div class="sdr-pergunta">
              <label class="sdr-chk"><input type="checkbox" data-q="${i}" class="sdrQAtivo" ${q.ativo !== false ? 'checked' : ''} ${dis}> <b>${esc(CAMPOS[q.campo] || q.campo)}</b></label>
              <input type="text" class="sdrQTexto" data-q="${i}" value="${esc(q.pergunta || '')}" ${dis}>
            </div>`).join('')}
        </div>
      </section>

      <section class="ficha-secao">
        <div class="ficha-secao-topo"><h3>Horário de atendimento</h3><p>Fora dele, o que a IA faz quando chega mensagem.</p></div>
        <div class="ficha-grade">
          <div class="campo campo-largo"><label>Dias</label><div class="sdr-horas" id="sdrDias">${DIAS.map(([v, r]) =>
            `<label class="sdr-chip"><input type="checkbox" value="${v}" ${(at.dias || []).includes(Number(v)) ? 'checked' : ''} ${dis}><span>${r}</span></label>`).join('')}</div></div>
          <div class="campo"><label for="sdrIni">Das</label><input type="time" id="sdrIni" value="${esc(at.inicio || '08:00')}" ${dis}></div>
          <div class="campo"><label for="sdrFim">Até</label><input type="time" id="sdrFim" value="${esc(at.fim || '20:00')}" ${dis}></div>
          <div class="campo campo-largo"><label for="sdrFora">Fora do horário</label>
            <select id="sdrFora" ${dis}>
              <option value="responder" ${at.fora_do_horario === 'responder' || !at.fora_do_horario ? 'selected' : ''}>A IA responde normalmente (24 horas)</option>
              <option value="mensagem" ${at.fora_do_horario === 'mensagem' ? 'selected' : ''}>Manda só a mensagem abaixo, uma vez</option>
              <option value="nao_responder" ${at.fora_do_horario === 'nao_responder' ? 'selected' : ''}>Não responde; fica para o próximo horário</option>
            </select></div>
          ${area('sdrMsgFora', 'Mensagem fora do horário', at.mensagem_fora, '', 2)}
        </div>
      </section>

      <section class="ficha-secao">
        <div class="ficha-secao-topo"><h3>Horários de visita</h3><p>O que a IA pode oferecer. Ela cruza com a sua Agenda Google e só oferece o que está livre.</p></div>
        <div class="ficha-grade">
          <div class="campo campo-largo"><label>Segunda a sexta</label>${horas('sdrVisSemana', vis.semana, 8, 19)}</div>
          <div class="campo campo-largo"><label>Sábado</label>${horas('sdrVisSabado', vis.sabado, 8, 14)}</div>
          <div class="campo"><label for="sdrAntec">Antecedência mínima (horas)</label><input type="number" min="1" max="72" id="sdrAntec" value="${esc(vis.antecedencia_h ?? 3)}" ${dis}></div>
          <div class="campo"><label for="sdrMaxDia">Máximo de visitas oferecidas por dia</label><input type="number" min="1" max="10" id="sdrMaxDia" value="${esc(vis.max_por_dia ?? 2)}" ${dis}></div>
          <div class="campo"><label for="sdrLimite">Limite de respostas por conversa por hora</label><input type="number" min="1" max="200" id="sdrLimite" value="${esc(c.limite_hora ?? 20)}" ${dis}>
            <p class="campo-dica">Freio de custo: passou disso, a IA pausa e chama você.</p></div>
        </div>
      </section>

      ${adm ? `<div class="sdr-salvar"><button class="btn btn-primario" id="sdrSalvar">Salvar treino</button><span class="campo-dica">Vale na próxima resposta.</span></div>` : ''}

      <section class="ficha-secao">
        <div class="ficha-secao-topo"><h3>Base de conhecimento<span class="ini-conta">${conhecimento.length}</span></h3>
          <p>O que a IA precisa saber sobre a imobiliária: como funciona a visita, documentos, região, diferenciais. Dados de imóvel ela tira do catálogo, não daqui.</p></div>
        <div class="sdr-lista" id="sdrConh">
          ${conhecimento.length ? conhecimento.map(k => `
            <div class="sdr-card ${k.ativo ? '' : 'inativo'}">
              <div class="sdr-card-topo"><b>${esc(k.titulo)}</b>
                ${adm ? `<span><button class="btn btn-fantasma" data-conh-ativo="${k.id}" data-v="${k.ativo ? 0 : 1}">${k.ativo ? 'Desativar' : 'Ativar'}</button>
                <button class="btn btn-fantasma" data-conh-editar="${k.id}">Editar</button>
                <button class="btn btn-fantasma" data-conh-apagar="${k.id}">Apagar</button></span>` : ''}</div>
              <p>${esc(k.conteudo)}</p>
            </div>`).join('') : '<p class="ini-vazio" style="padding:4px 2px 12px">Nada ainda. Comece pelas sugestões abaixo.</p>'}
        </div>
        ${adm ? `<div class="sdr-form" id="sdrConhForm">
          <input type="text" id="sdrConhId" type="hidden">
          <div class="campo"><label for="sdrConhTitulo">Assunto</label><input type="text" id="sdrConhTitulo" placeholder="Ex.: Como funciona a visita"></div>
          <div class="campo campo-largo"><label for="sdrConhTexto">O que a IA deve saber</label><textarea id="sdrConhTexto" rows="4"></textarea></div>
          <div class="sdr-sugestoes">Sugestões: ${['Sobre a Maysonnave Imóveis', 'Como funciona a visita', 'Documentos para comprar', 'Financiamento: o básico', 'Bairros que atendemos', 'Horário e endereço do escritório']
            .map(t => `<button class="sdr-sug" data-sug="${esc(t)}">${esc(t)}</button>`).join('')}</div>
          <button class="btn btn-primario" id="sdrConhSalvar">Adicionar à base</button>
        </div>` : ''}
      </section>

      <section class="ficha-secao">
        <div class="ficha-secao-topo"><h3>Exemplos de resposta ideal<span class="ini-conta">${exemplos.length}</span></h3>
          <p>A forma mais forte de ensinar: "quando o cliente diz isto, responda assim". Os 15 mais recentes entram em toda resposta. Também nascem do 👎 no Simulador e nas Conversas.</p></div>
        <div class="sdr-lista">
          ${exemplos.length ? exemplos.map(e => `
            <div class="sdr-card ${e.ativo ? '' : 'inativo'}">
              <div class="sdr-card-topo"><span class="cv-tag">${{ manual: 'escrito à mão', avaliacao: 'de uma conversa', simulador: 'do simulador' }[e.origem] || e.origem}</span>
                ${adm ? `<span><button class="btn btn-fantasma" data-ex-ativo="${e.id}" data-v="${e.ativo ? 0 : 1}">${e.ativo ? 'Desativar' : 'Ativar'}</button>
                <button class="btn btn-fantasma" data-ex-apagar="${e.id}">Apagar</button></span>` : ''}</div>
              <p class="sdr-ex-cli">Cliente: ${esc(e.mensagem_cliente)}</p>
              <p class="sdr-ex-ia">Resposta ideal: ${esc(e.resposta_ideal)}</p>
              ${e.observacao ? `<p class="campo-dica">${esc(e.observacao)}</p>` : ''}
            </div>`).join('') : '<p class="ini-vazio" style="padding:4px 2px 12px">Nenhum exemplo ainda.</p>'}
        </div>
        ${adm ? `<div class="sdr-form">
          <div class="campo campo-largo"><label for="sdrExCli">Quando o cliente diz</label><textarea id="sdrExCli" rows="2" placeholder="Ex.: Qual o valor do condomínio?"></textarea></div>
          <div class="campo campo-largo"><label for="sdrExIa">A IA deve responder</label><textarea id="sdrExIa" rows="3"></textarea></div>
          <div class="campo campo-largo"><label for="sdrExObs">Por quê (opcional)</label><input type="text" id="sdrExObs"></div>
          <button class="btn btn-primario" id="sdrExSalvar">Adicionar exemplo</button>
        </div>` : ''}
      </section>

      ${avaliacoes.length ? `<section class="ficha-secao">
        <div class="ficha-secao-topo"><h3>Respostas marcadas com 👎<span class="ini-conta">${avaliacoes.length}</span></h3><p>O que a equipe achou ruim. Vire exemplo o que fizer sentido.</p></div>
        <div class="sdr-lista">${avaliacoes.map(a => `
          <div class="sdr-card"><p class="sdr-ex-ia">IA: ${esc(a.texto_ia)}</p>${a.comentario ? `<p class="sdr-ex-cli">Comentário: ${esc(a.comentario)}</p>` : ''}</div>`).join('')}</div>
      </section>` : ''}

      <section class="ficha-secao">
        <div class="ficha-secao-topo"><h3>Regras fixas de segurança</h3><p>Valem acima de qualquer treino e não podem ser desligadas.</p></div>
        <ul class="sdr-regras">${REGRAS_FIXAS.map(r => `<li>${esc(r)}</li>`).join('')}</ul>
      </section>`;

    if (!adm) return;
    const v = id => alvo.querySelector('#' + id).value;
    const marcados = id => [...alvo.querySelectorAll(`#${id} input:checked`)].map(i => Number(i.value));

    alvo.querySelector('#sdrSalvar').addEventListener('click', async () => {
      const perguntas = (c.perguntas || []).map((q, i) => ({ ...q,
        ativo: alvo.querySelector(`.sdrQAtivo[data-q="${i}"]`).checked,
        pergunta: alvo.querySelector(`.sdrQTexto[data-q="${i}"]`).value.trim() || q.pergunta }));
      await db(supabaseClient.from('sdr_config').update({
        nome_assistente: v('sdrNome').trim() || 'Assistente da Maysonnave Imóveis',
        apresentacao: v('sdrApresentacao').trim(), tom: v('sdrTom').trim(), instrucoes: v('sdrInstrucoes').trim(),
        nunca_dizer: v('sdrNunca').trim(), quando_chamar: v('sdrChamar').trim(), perguntas,
        atendimento: { dias: marcados('sdrDias'), inicio: v('sdrIni') || '08:00', fim: v('sdrFim') || '20:00', fora_do_horario: v('sdrFora'), mensagem_fora: v('sdrMsgFora').trim() },
        visitas: { semana: marcados('sdrVisSemana'), sabado: marcados('sdrVisSabado'), antecedencia_h: Number(v('sdrAntec')) || 3, max_por_dia: Number(v('sdrMaxDia')) || 2, duracao_min: 60 },
        limite_hora: Math.min(200, Math.max(1, Number(v('sdrLimite')) || 20)),
        updated_by: Plataforma.perfil.id,
      }).eq('id', true), 'salvar o treino');
      avisar('Treino salvo. Vale na próxima resposta.');
    });

    alvo.querySelectorAll('[data-sug]').forEach(b => b.addEventListener('click', () => {
      alvo.querySelector('#sdrConhTitulo').value = b.dataset.sug; alvo.querySelector('#sdrConhTexto').focus();
    }));
    alvo.querySelector('#sdrConhSalvar').addEventListener('click', async () => {
      const titulo = v('sdrConhTitulo').trim(), conteudo = v('sdrConhTexto').trim(), id = v('sdrConhId');
      if (!titulo || !conteudo) return avisar('Preencha o assunto e o texto.');
      if (id) await db(supabaseClient.from('sdr_conhecimento').update({ titulo, conteudo }).eq('id', id), 'salvar');
      else await db(supabaseClient.from('sdr_conhecimento').insert({ titulo, conteudo, ordem: conhecimento.length }), 'adicionar');
      avisar('Base de conhecimento atualizada.'); treinar(container);
    });
    alvo.querySelector('#sdrExSalvar').addEventListener('click', async () => {
      const cli = v('sdrExCli').trim(), ia = v('sdrExIa').trim();
      if (!cli || !ia) return avisar('Preencha o que o cliente diz e a resposta ideal.');
      await db(supabaseClient.from('sdr_exemplo').insert({ mensagem_cliente: cli, resposta_ideal: ia, observacao: v('sdrExObs').trim() || null, origem: 'manual', criado_por: Plataforma.perfil.id }), 'adicionar exemplo');
      avisar('Exemplo adicionado.'); treinar(container);
    });
    alvo.addEventListener('click', async ev => {
      const b = ev.target.closest('button'); if (!b) return;
      try {
        if (b.dataset.conhAtivo) { await db(supabaseClient.from('sdr_conhecimento').update({ ativo: b.dataset.v === '1' }).eq('id', b.dataset.conhAtivo), 'alterar'); treinar(container); }
        else if (b.dataset.conhApagar) { if (!confirm('Apagar este item da base de conhecimento?')) return; await db(supabaseClient.from('sdr_conhecimento').delete().eq('id', b.dataset.conhApagar), 'apagar'); treinar(container); }
        else if (b.dataset.conhEditar) {
          const k = conhecimento.find(x => x.id === b.dataset.conhEditar);
          alvo.querySelector('#sdrConhId').value = k.id; alvo.querySelector('#sdrConhTitulo').value = k.titulo; alvo.querySelector('#sdrConhTexto').value = k.conteudo;
          alvo.querySelector('#sdrConhSalvar').textContent = 'Salvar alteração'; alvo.querySelector('#sdrConhForm').scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
        else if (b.dataset.exAtivo) { await db(supabaseClient.from('sdr_exemplo').update({ ativo: b.dataset.v === '1' }).eq('id', b.dataset.exAtivo), 'alterar'); treinar(container); }
        else if (b.dataset.exApagar) { if (!confirm('Apagar este exemplo?')) return; await db(supabaseClient.from('sdr_exemplo').delete().eq('id', b.dataset.exApagar), 'apagar'); treinar(container); }
      } catch (e) { /* db() já avisou */ }
    });
  }

  // ══════════════════════════ SIMULADOR ═══════════════════════════════
  // Conversa só na memória da página: recarregou, recomeça.
  let sim = { nome: 'Cliente de teste', msgs: [] };

  function simulador(alvo) {
    alvo.innerHTML = topo('SDR · Simulador', 'Converse como se fosse o cliente. Usa o treino, o catálogo e a agenda reais, mas não envia nada e não grava nada.',
      `<button class="btn" id="simNova">Nova conversa</button><button class="btn" data-ir-sub="treinar">Treinar a IA</button>`) + `
      <div class="sim">
        <div class="sim-cab"><label>Nome do cliente <input type="text" id="simNome" value="${esc(sim.nome)}"></label>
          <span class="campo-dica">Cada mensagem gasta uma resposta da IA (Gemini tem cota grátis diária; Claude cobra por uso).</span></div>
        <div class="sim-msgs" id="simMsgs"></div>
        <div class="sim-compor">
          <textarea id="simTexto" rows="2" placeholder="Escreva como o cliente. Ex.: Oi, vocês têm apartamento no Laranjal?"></textarea>
          <button class="btn btn-primario" id="simEnviar">Enviar</button>
        </div>
        <div class="sim-ideias">Ideias para testar: ${['Oi, vi um anúncio de vocês', 'Tem casa com piscina até 1 milhão?', 'Quero visitar amanhã de tarde', 'Qual o endereço exato do prédio?', 'Faz por 300 mil à vista?', 'Quero falar com uma pessoa']
          .map(t => `<button class="sdr-sug" data-ideia="${esc(t)}">${esc(t)}</button>`).join('')}</div>
      </div>`;
    desenharSim();

    const enviar = async () => {
      const ta = alvo.querySelector('#simTexto'); const texto = ta.value.trim();
      if (!texto) return;
      sim.nome = alvo.querySelector('#simNome').value.trim() || 'Cliente de teste';
      sim.msgs.push({ de: 'cliente', texto }); ta.value = '';
      sim.msgs.push({ de: 'pensando' }); desenharSim();
      const btn = alvo.querySelector('#simEnviar'); btn.disabled = true;
      try {
        const r = await chamarFuncao({ simular: true, nome: sim.nome, mensagens: sim.msgs.filter(m => m.de === 'cliente' || m.de === 'ia').map(m => ({ de: m.de, texto: m.texto })) });
        sim.msgs.pop();
        sim.msgs.push({ de: 'ia', texto: r.texto, motor: r.motor, ferramentas: r.ferramentas || [], quali: r.qualificacao || {}, corretor: r.chamou_corretor });
      } catch (e) {
        sim.msgs.pop(); sim.msgs.push({ de: 'erro', texto: e.message });
      }
      btn.disabled = false; desenharSim(); alvo.querySelector('#simTexto').focus();
    };
    alvo.querySelector('#simEnviar').addEventListener('click', enviar);
    alvo.querySelector('#simTexto').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); enviar(); } });
    alvo.querySelector('#simNova').addEventListener('click', () => { sim.msgs = []; desenharSim(); });
    alvo.addEventListener('click', async ev => {
      const b = ev.target.closest('button'); if (!b) return;
      if (b.dataset.ideia) { alvo.querySelector('#simTexto').value = b.dataset.ideia; alvo.querySelector('#simTexto').focus(); }
      if (b.dataset.nota) await avaliar(Number(b.dataset.i), b.dataset.nota);
      if (b.dataset.salvarEx) await salvarExemplo(Number(b.dataset.salvarEx));
    });
  }

  const ROTULO_FERRAMENTA = { buscar_imoveis: 'Consultou o catálogo', registrar_qualificacao: 'Anotou o perfil', horarios_disponiveis: 'Consultou a agenda',
                              pre_agendar_visita: 'Pré-agendou visita', chamar_corretor: 'Chamou o corretor' };

  function desenharSim() {
    const el = document.getElementById('simMsgs'); if (!el) return;
    if (!sim.msgs.length) { el.innerHTML = '<p class="cv-vazio-lista">Escreva a primeira mensagem como se fosse um cliente chegando pelo WhatsApp.</p>'; return; }
    el.innerHTML = sim.msgs.map((m, i) => {
      if (m.de === 'cliente') return `<div class="cv-msg entrada"><span class="cv-msg-quem">${esc(sim.nome)}</span><div class="cv-msg-txt">${esc(m.texto).replace(/\n/g, '<br>')}</div></div>`;
      if (m.de === 'pensando') return `<div class="cv-msg saida ia"><div class="cv-msg-txt"><i>A IA está pensando…</i></div></div>`;
      if (m.de === 'erro') return `<div class="cv-msg saida falhou"><div class="cv-msg-txt">Não respondeu: ${esc(m.texto)}</div></div>`;
      const q = m.quali || {};
      const chips = Object.entries(q).filter(([k]) => !['resumo', 'temperatura'].includes(k))
        .map(([k, v]) => `${CAMPOS[k] || k}: ${Array.isArray(v) ? v.join(', ') : /^valor/.test(k) && Number(v) ? 'R$ ' + Number(v).toLocaleString('pt-BR') : v}`);
      return `<div class="cv-msg saida ia">
        <span class="cv-msg-quem">IA · ${m.motor === 'gemini' ? 'Gemini' : 'Claude'}</span>
        <div class="cv-msg-txt">${esc(m.texto).replace(/\*([^*\n]+)\*/g, '<b>$1</b>').replace(/\n/g, '<br>')}</div>
        ${m.ferramentas.length ? `<div class="sim-rastro">${m.ferramentas.map(f => `<span>${esc(ROTULO_FERRAMENTA[f.ferramenta] || f.ferramenta)} → ${esc(f.resultado)}</span>`).join('')}</div>` : ''}
        ${chips.length || q.temperatura ? `<div class="sim-rastro">${q.temperatura ? `<span class="cv-tag cv-temp-${esc(q.temperatura)}">${esc(q.temperatura)}</span>` : ''}${chips.map(c => `<span>${esc(c)}</span>`).join('')}</div>` : ''}
        ${m.corretor ? `<div class="sim-corretor">Passaria para o corretor: ${esc(m.corretor)}</div>` : ''}
        <div class="sim-nota">${m.nota ? (m.nota === 'boa' ? '👍 avaliada como boa' : '👎 avaliada como ruim') : `
          <button class="btn btn-fantasma" data-nota="boa" data-i="${i}" title="Boa resposta">👍</button>
          <button class="btn btn-fantasma" data-nota="ruim" data-i="${i}" title="Resposta ruim: ensinar como deveria ser">👎</button>`}</div>
        ${m.ensinar ? `<div class="sim-ensinar">
          <label>Como a IA deveria ter respondido?</label>
          <textarea id="simIdeal${i}" rows="3">${esc(m.texto)}</textarea>
          <input type="text" id="simObs${i}" placeholder="Por quê (opcional)">
          <button class="btn btn-primario" data-salvar-ex="${i}">Ensinar</button>
        </div>` : ''}
      </div>`;
    }).join('');
    el.scrollTop = el.scrollHeight;
  }

  async function avaliar(i, nota) {
    const m = sim.msgs[i]; if (!m) return;
    if (nota === 'boa') {
      await db(supabaseClient.from('sdr_avaliacao').insert({ texto_ia: m.texto, nota: 'boa' }), 'avaliar');
      m.nota = 'boa'; avisar('Obrigado! Avaliação registrada.');
    } else { m.ensinar = true; }
    desenharSim();
  }

  async function salvarExemplo(i) {
    const m = sim.msgs[i]; if (!m) return;
    const ideal = document.getElementById('simIdeal' + i).value.trim();
    const obs = document.getElementById('simObs' + i).value.trim();
    const cliente = [...sim.msgs.slice(0, i)].reverse().find(x => x.de === 'cliente');
    if (!ideal) return avisar('Escreva como deveria ser a resposta.');
    await db(supabaseClient.from('sdr_avaliacao').insert({ texto_ia: m.texto, nota: 'ruim', comentario: `Ideal: ${ideal}${obs ? ' | ' + obs : ''}` }), 'avaliar');
    if (souAdmin() && cliente) {
      await db(supabaseClient.from('sdr_exemplo').insert({ mensagem_cliente: cliente.texto, resposta_ideal: ideal, observacao: obs || null, origem: 'simulador', criado_por: Plataforma.perfil.id }), 'salvar exemplo');
      avisar('Ensinado. A IA usa este exemplo a partir da próxima resposta.');
    } else avisar('Avaliação registrada. O administrador pode transformar em exemplo.');
    m.nota = 'ruim'; m.ensinar = false; desenharSim();
  }

  // ══════════════════════════ MONTAGEM ════════════════════════════════
  async function montar(destino, sub) {
    // Contêiner novo a cada abertura (ver mod-conversas: ouvintes no
    // #conteudo se acumulam entre visitas).
    const alvo = document.createElement('div');
    destino.replaceChildren(alvo);
    alvoEl = alvo;
    alvo.addEventListener('click', ev => {
      const b = ev.target.closest('[data-ir-sub]');
      if (b) Plataforma.irPara('sdr', b.dataset.irSub);
    });
    const pagina = sub || 'painel';
    if (pagina === 'conversas') {
      if (window.ModConversas) return window.ModConversas.montar(alvo);
      alvo.innerHTML = '<div class="vazio"><p>O módulo de conversas não carregou.</p></div>'; return;
    }
    if (pagina === 'treinar') await treinar(alvo);
    else if (pagina === 'simulador') simulador(alvo);
    else await painel(alvo);
  }

  Plataforma.registrar('sdr', { titulo: 'SDR · Assistente IA', montar });
})();
