// ══════════════════════════════════════════════════════════════════════
// MÓDULO: CORRETORES
//
// Quem entra no sistema, com qual papel, e quem ainda está esperando.
//
// A aprovação existe por um motivo prático: o cadastro é aberto, então
// qualquer pessoa com o endereço cria conta. Sem a fila de aprovação, um
// estranho entraria direto na base de clientes e imóveis.
//
// Só admin vê e mexe aqui. Corretor que abrir a tela recebe um aviso em vez
// de uma lista de gente para promover.
// ══════════════════════════════════════════════════════════════════════

(() => {
  'use strict';
  const { db, esc, avisar } = Plataforma;

  let alvoEl = null;

  const PAPEIS = [
    ['admin', 'Administrador', 'Vê tudo, aprova gente e mexe nas configurações.'],
    ['corretor', 'Corretor', 'Trabalha imóveis, clientes e negócios.'],
    ['agenciador', 'Agenciador', 'Capta imóvel e acompanha o proprietário. Não conduz a venda.'],
    ['parceiro', 'Parceiro', 'Acesso restrito ao que for compartilhado com ele.'],
  ];

  const data = v => v ? new Date(v).toLocaleDateString('pt-BR') : '—';
  const ESTADO_CIVIL = ['Solteiro(a)', 'Casado(a)', 'Divorciado(a)', 'Viúvo(a)', 'União estável'];

  let editando = null;

  async function montar(alvo, sub) {
    alvoEl = alvo;
    if (sub === 'agenda') return montarAgenda(alvo);
    if (sub === 'modelos') return montarModelos(alvo);
    if (sub === 'convidar') return montarConvite(alvo);
    if (sub && sub !== 'equipe') { editando = sub; return montarFicha(alvo, sub); }

    const eu = Plataforma.perfil;
    if (!eu || eu.papel !== 'admin') {
      alvo.innerHTML = `
        <div class="vazio"><div class="vazio-ico">◎</div>
          <h3>Só administrador acessa esta tela</h3>
          <p>Aqui se aprova quem entra no sistema e se define o papel de cada um.
             Fale com o administrador se precisar de acesso.</p></div>`;
      return;
    }

    const perfis = await db(supabaseClient.from('perfil').select('*')
      .order('aprovado').order('nome'), 'carregar os corretores');

    const esperando = perfis.filter(p => !p.aprovado);
    const ativos = perfis.filter(p => p.aprovado && p.ativo);
    const inativos = perfis.filter(p => p.aprovado && !p.ativo);

    const linha = (p, tipo) => {
      const souEu = p.id === eu.id;
      return `
      <tr data-id="${esc(p.id)}" class="cad-linha">
        <td><div class="cad-end-rua">${esc(p.nome)}${souEu ? ' <span class="cad-selo cad-selo-mural">você</span>' : ''}</div>
            <div class="cad-end-sub">${esc(p.email)}</div></td>
        <td>${esc(p.telefone || '—')}</td>
        <td>${esc(p.creci || '—')}</td>
        <td>
          <select data-papel ${souEu ? 'disabled title="Você não pode mudar o próprio papel"' : ''}>
            ${PAPEIS.map(([v, r]) => `<option value="${v}"${p.papel === v ? ' selected' : ''}>${r}</option>`).join('')}
          </select>
        </td>
        <td class="cad-num">${data(p.created_at)}</td>
        <td class="cad-onde">${
          tipo === 'espera'
            ? '<button class="btn btn-mini btn-primario" data-acao="aprovar">Aprovar</button>' +
              '<button class="btn btn-mini btn-remover" data-acao="recusar">Recusar</button>'
            // Emitir contrato vale para todo mundo, inclusive para si mesmo:
            // a regra de não se desativar não tem nada a ver com documento.
            : tipo === 'ativo'
            ? '<button class="btn btn-mini" data-acao="contrato">Contrato</button>' +
              (souEu ? '' : '<button class="btn btn-mini" data-acao="desativar">Desativar</button>')
            : '<button class="btn btn-mini" data-acao="reativar">Reativar</button>'}</td>
      </tr>`;
    };

    const tabela = (titulo, itens, vazio, tipo) => `
      <section class="ficha-secao">
        <div class="ficha-secao-topo"><h3>${esc(titulo)}<span class="ini-conta">${itens.length}</span></h3></div>
        ${itens.length ? `<div class="cad-tabela-scroll" style="border:none;border-radius:0">
            <table class="cad-tabela">
              <thead><tr><th>Pessoa</th><th>Telefone</th><th>CRECI</th><th>Papel</th><th>Desde</th><th></th></tr></thead>
              <tbody>${itens.map(p => linha(p, tipo)).join('')}</tbody></table></div>`
          : `<p class="ini-vazio" style="padding:18px 20px">${esc(vazio)}</p>`}
      </section>`;

    alvo.innerHTML = `
      <div class="secao-topo">
        <div class="secao-titulo"><div class="ponto"></div>
          <div><h2>Corretores</h2>
          <div class="secao-meta">Quem entra no sistema e com qual papel.</div></div>
        </div>
        <div class="secao-acoes">
          <button class="btn btn-primario" id="crConvidar">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 1v12M1 7h12" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
            Convidar corretor
          </button>
        </div>
      </div>

      <div class="painel-numeros">
        <div class="num${esperando.length ? ' num-alerta' : ''}"><span class="num-v">${esperando.length}</span><span class="num-r">Esperando aprovação</span></div>
        <div class="num"><span class="num-v">${ativos.length}</span><span class="num-r">Ativos</span></div>
        <div class="num"><span class="num-v">${ativos.filter(p => p.papel === 'admin').length}</span><span class="num-r">Administradores</span></div>
      </div>

      ${tabela('Esperando aprovação', esperando,
        'Ninguém na fila. Quem se cadastrar aparece aqui.', 'espera')}
      ${tabela('Ativos', ativos, 'Nenhum corretor ativo.', 'ativo')}
      ${inativos.length ? tabela('Desativados', inativos, '', 'inativo') : ''}

      <div class="ficha-secao">
        <div class="ficha-secao-topo"><h3>O que cada papel enxerga</h3></div>
        <div style="padding:16px 20px">
          <ul class="ini-lista">
            ${PAPEIS.map(([, r, d]) => `<li><span class="ini-hora">${esc(r.slice(0, 13))}</span>
              <span class="ini-txt">${esc(d)}</span></li>`).join('')}
          </ul>
          <p class="campo-dica" style="margin-top:14px">Desativar não apaga: a pessoa perde o
          acesso e tudo o que ela cadastrou continua no lugar, com o nome dela.</p>
        </div>
      </div>`;

    document.getElementById('crConvidar').addEventListener('click', () => montarConvite(alvoEl));

    // ── Ações ────────────────────────────────────────────────────────
    alvo.querySelectorAll('[data-acao]').forEach(b => {
      b.addEventListener('click', async e => {
        const tr = b.closest('tr');
        const id = tr.dataset.id;
        const nome = tr.querySelector('.cad-end-rua').textContent.trim();
        const acao = b.dataset.acao;

        if (acao === 'recusar' &&
            !confirm(`Recusar o acesso de ${nome}? A conta continua existindo, mas sem entrar no sistema.`)) return;
        if (acao === 'desativar' &&
            !confirm(`Desativar ${nome}? Ele perde o acesso, e o que cadastrou continua no lugar.`)) return;

        e.stopPropagation();
        if (acao === 'contrato') {
          const linhas = await db(supabaseClient.from('perfil').select('*').eq('id', id).limit(1), 'abrir');
          if (linhas[0]) await emitirContrato(linhas[0]);
          return;
        }
        const campos = {
          aprovar: { aprovado: true, ativo: true },
          recusar: { aprovado: false },
          desativar: { ativo: false },
          reativar: { ativo: true },
        }[acao];
        await db(supabaseClient.from('perfil').update(campos).eq('id', id), 'alterar o acesso');
        avisar({ aprovar: `${nome} aprovado.`, recusar: 'Acesso recusado.',
                 desativar: `${nome} desativado.`, reativar: `${nome} reativado.` }[acao]);
        await montar(alvoEl);
      });
    });

    // A linha abre a ficha completa. Os controles de dentro param o clique
    // pra não abrir a ficha quando a intenção era aprovar ou mudar o papel.
    alvo.querySelectorAll('tr[data-id]').forEach(tr => {
      tr.addEventListener('click', e => {
        if (e.target.closest('button, select')) return;
        montarFicha(alvoEl, tr.dataset.id);
      });
    });

    alvo.querySelectorAll('[data-papel]').forEach(sel => {
      sel.addEventListener('click', e => e.stopPropagation());
      sel.addEventListener('change', async () => {
        const id = sel.closest('tr').dataset.id;
        await db(supabaseClient.from('perfil').update({ papel: sel.value }).eq('id', id), 'mudar o papel');
        avisar('Papel alterado.');
      });
    });
  }

  // ══════════════════════════════════════════════════════════════════
  // CONVIDAR CORRETOR
  //
  // Criar usuário direto exigiria a chave de serviço do Supabase, e ela não
  // pode ficar no navegador: quem abrisse o código teria acesso total ao
  // banco. Por isso o convite: o admin preenche a ficha, o sistema gera um
  // segredo de uso único, e a pessoa cria a própria senha por aquele link.
  // ══════════════════════════════════════════════════════════════════
  async function montarConvite(alvo, feito) {
    const eu = Plataforma.perfil;
    if (!eu || eu.papel !== 'admin') return montar(alvo, 'equipe');

    if (feito) {
      const url = `${location.origin}${location.pathname}#convite=${feito.segredo}`;
      const msg = `Olá ${feito.nome}, seu acesso ao sistema da Maysonnave Imóveis está pronto. `
        + `Crie sua senha aqui: ${url}`;
      alvo.innerHTML = `
        <div class="secao-topo">
          <div class="secao-titulo"><div class="ponto"></div>
            <div><h2>Convite criado</h2>
            <div class="secao-meta">${esc(feito.nome)} · ${esc(feito.email)}</div></div>
          </div>
          <div class="secao-acoes"><button class="btn" id="cvVoltar">Voltar à equipe</button></div>
        </div>
        <div class="ficha-secao">
          <div class="ficha-secao-topo"><h3>Mande este link para a pessoa</h3>
            <p>Vale 14 dias e serve uma vez só. Quem abrir define a senha e entra já aprovado,
               com a ficha que você preencheu.</p></div>
          <div class="ficha-grade">
            <div class="campo campo-largo"><label for="cvLink">Link do convite</label>
              <input type="text" id="cvLink" value="${esc(url)}" readonly
                     style="font-family:ui-monospace,Menlo,monospace;font-size:12.5px"></div>
          </div>
          <div class="ficha-rodape" style="padding:0 20px 18px">
            <button class="btn" id="cvCopiar">Copiar link</button>
            <a class="btn btn-primario" target="_blank" rel="noopener"
               href="https://wa.me/?text=${encodeURIComponent(msg)}">Mandar no WhatsApp</a>
          </div>
        </div>
        <div class="ficha-secao">
          <div style="padding:16px 20px">
            <p class="campo-dica"><strong>Enquanto a pessoa não abrir</strong>, ela não aparece
            na equipe: a conta só existe depois que a senha for criada. O convite fica guardado
            e você pode gerar outro se este se perder.</p>
          </div>
        </div>`;
      document.getElementById('cvVoltar').addEventListener('click', () => montar(alvoEl, 'equipe'));
      document.getElementById('cvCopiar').addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(url); avisar('Link copiado.'); }
        catch { document.getElementById('cvLink').select(); avisar('Selecionado. Use Cmd+C.'); }
      });
      return;
    }

    const campo = (id, rot, tipo = 'text', ph = '', largo = false, dica = '') => `
      <div class="campo${largo ? ' campo-largo' : ''}">
        <label for="${id}">${rot}</label>
        <input type="${tipo}" id="${id}" placeholder="${esc(ph)}">
        ${dica ? `<p class="campo-dica">${dica}</p>` : ''}
      </div>`;

    alvo.innerHTML = `
      <div class="secao-topo">
        <div class="secao-titulo"><div class="ponto"></div>
          <div><h2>Convidar corretor</h2>
          <div class="secao-meta">Preencha o que já souber. A pessoa completa o resto depois,
            e você pode editar a ficha a qualquer momento.</div></div>
        </div>
        <div class="secao-acoes">
          <button class="btn" id="cvCancelar">Cancelar</button>
          <button class="btn btn-primario" id="cvGerar">Gerar convite</button>
        </div>
      </div>

      <div class="ficha-secao">
        <div class="ficha-secao-topo"><h3>Identificação</h3>
          <p>Nome e e-mail são obrigatórios. O e-mail é por onde a pessoa entra, e o convite
             só funciona se ela criar a conta com ele.</p></div>
        <div class="ficha-grade">
          ${campo('cvNome', 'Nome completo', 'text', '', true)}
          ${campo('cvEmail', 'E-mail', 'email', 'nome@exemplo.com', true)}
          ${campo('cvTelefone', 'Telefone', 'tel', '(53) 9 9999-9999')}
          <div class="campo"><label for="cvPapel">Papel</label>
            <select id="cvPapel">${PAPEIS.map(([v, r]) =>
              `<option value="${v}"${v === 'corretor' ? ' selected' : ''}>${r}</option>`).join('')}</select></div>
        </div>
      </div>

      <div class="ficha-secao">
        <div class="ficha-secao-topo"><h3>Profissional</h3></div>
        <div class="ficha-grade">
          ${campo('cvCreci', 'CRECI', 'text', '61580')}
          ${campo('cvCreciUf', 'UF do CRECI', 'text', 'RS')}
          ${campo('cvComissao', 'Comissão (%)', 'number', '50', false,
            'Quanto cabe a esta pessoa na comissão da imobiliária.')}
          ${campo('cvAdmissao', 'Início na equipe', 'date')}
          ${campo('cvCnpj', 'CNPJ', 'text', '', false, 'Se atua como pessoa jurídica.')}
        </div>
      </div>

      <div class="ficha-secao">
        <div class="ficha-secao-topo"><h3>Endereço</h3>
          <p>Entra no contrato. Se não souber agora, a pessoa completa depois na ficha.</p></div>
        <div class="ficha-grade">
          ${campo('cvCep', 'CEP', 'text', '96010-000')}
          ${campo('cvEndereco', 'Logradouro', 'text', 'Rua, avenida…', true)}
          ${campo('cvNumero', 'Número', 'text')}
          ${campo('cvCompl', 'Complemento', 'text', 'apto, sala…')}
          ${campo('cvBairro', 'Bairro', 'text')}
          ${campo('cvCidade', 'Cidade', 'text', 'Pelotas')}
          ${campo('cvUf', 'Estado', 'text', 'RS')}
        </div>
      </div>

      <div class="ficha-secao">
        <div class="ficha-secao-topo"><h3>Documentos e pagamento</h3>
          <p>Opcional agora. Só faz falta na hora de emitir contrato.</p></div>
        <div class="ficha-grade">
          ${campo('cvCpf', 'CPF', 'text', '000.000.000-00')}
          ${campo('cvRg', 'RG', 'text')}
          ${campo('cvNasc', 'Nascimento', 'date')}
          <div class="campo"><label for="cvEstadoCivil">Estado civil</label>
            <select id="cvEstadoCivil"><option value="">—</option>
              ${ESTADO_CIVIL.map(o => `<option value="${esc(o)}">${esc(o)}</option>`).join('')}
            </select></div>
          ${campo('cvPix', 'Chave PIX', 'text', '', true)}
        </div>
      </div>`;

    document.getElementById('cvCancelar').addEventListener('click', () => montar(alvoEl, 'equipe'));
    document.getElementById('cvGerar').addEventListener('click', async () => {
      const v = i => document.getElementById(i).value.trim();
      const nome = v('cvNome'), email = v('cvEmail').toLowerCase();
      if (!nome) { avisar('O convite precisa do nome.'); document.getElementById('cvNome').focus(); return; }
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
        avisar('E-mail inválido.'); document.getElementById('cvEmail').focus(); return;
      }
      const dados = {};
      for (const [campoId, chave] of [['cvTelefone','telefone'], ['cvCreci','creci'],
        ['cvCreciUf','creci_estado'], ['cvComissao','comissao_pct'], ['cvAdmissao','admissao'],
        ['cvCnpj','cnpj'], ['cvCpf','cpf'], ['cvRg','rg'], ['cvNasc','nascimento'],
        ['cvEstadoCivil','estado_civil'], ['cvPix','pix'],
        ['cvCep','cep'], ['cvEndereco','endereco'], ['cvNumero','numero'],
        ['cvCompl','complemento'], ['cvBairro','bairro'], ['cvCidade','cidade'], ['cvUf','uf']]) {
        if (v(campoId)) dados[chave] = v(campoId);
      }
      const r = await db(supabaseClient.from('convite').insert({
        nome, email, papel: document.getElementById('cvPapel').value,
        dados, criado_por: eu.id,
      }).select(), 'gerar o convite');
      if (r && r[0]) await montarConvite(alvoEl, r[0]);
    });
  }

  // ══════════════════════════════════════════════════════════════════
  // MODELOS DE CONTRATO
  //
  // O texto fica aqui e não no código porque contrato é assunto dele e do
  // advogado. Trocar uma cláusula não pode exigir programador.
  // ══════════════════════════════════════════════════════════════════
  const TIPOS_MODELO = [
    ['corretor', 'Corretor'], ['proprietario', 'Proprietário'],
    ['cliente', 'Cliente'], ['outro', 'Outro'],
  ];

  async function montarModelos(alvo, abrir) {
    const modelos = await db(supabaseClient.from('modelo_contrato').select('*')
      .order('tipo').order('ordem'), 'carregar modelos');

    if (abrir) {
      const m = modelos.find(x => x.id === abrir) || {};
      alvo.innerHTML = `
        <div class="secao-topo">
          <div class="secao-titulo"><div class="ponto"></div>
            <div><h2>${esc(m.nome || 'Novo modelo')}</h2>
            <div class="secao-meta">Use marcadores entre chaves duplas onde os dados devem entrar.</div></div>
          </div>
          <div class="secao-acoes">
            ${m.id ? '<button class="btn btn-remover" id="mdExcluir">Excluir</button>' : ''}
            <button class="btn" id="mdVoltar">Voltar</button>
            <button class="btn btn-primario" id="mdSalvar">Salvar</button>
          </div>
        </div>
        <div class="ficha-secao">
          <div class="ficha-grade">
            <div class="campo"><label for="mdNome">Nome do modelo</label>
              <input type="text" id="mdNome" value="${esc(m.nome ?? '')}"
                     placeholder="Contrato de parceria"></div>
            <div class="campo"><label for="mdTipo">Para quem</label>
              <select id="mdTipo">${TIPOS_MODELO.map(([v, r]) =>
                `<option value="${v}"${m.tipo === v ? ' selected' : ''}>${r}</option>`).join('')}</select></div>
            <div class="campo campo-largo"><label for="mdCorpo">Texto do contrato</label>
              <textarea id="mdCorpo" rows="22" style="font-family:ui-monospace,Menlo,monospace;font-size:13px"
                >${esc(m.corpo ?? '')}</textarea>
              <p class="campo-dica">Linha em branco separa parágrafo. Marcador sem valor na ficha
                sai destacado em amarelo no documento, em vez de sumir.</p></div>
          </div>
        </div>
        <div class="ficha-secao">
          <div class="ficha-secao-topo"><h3>Marcadores</h3></div>
          <div style="padding:14px 20px">
            <div class="chips">${['{{nome}}','{{cpf}}','{{rg}}','{{nascimento}}','{{estado_civil}}',
              '{{nacionalidade}}','{{email}}','{{telefone}}','{{creci}}','{{cnpj}}','{{razao_social}}',
              '{{comissao}}','{{endereco_completo}}','{{pix}}','{{imobiliaria}}',
              '{{creci_imobiliaria}}','{{cidade_hoje}}'].map(x =>
                `<button type="button" class="chip" data-marca="${x}">${x}</button>`).join('')}</div>
            <p class="campo-dica" style="margin-top:10px">Clique num marcador para inserir no texto.</p>
          </div>
        </div>`;

      alvo.querySelectorAll('[data-marca]').forEach(b => b.addEventListener('click', () => {
        const t = document.getElementById('mdCorpo');
        const i = t.selectionStart;
        t.value = t.value.slice(0, i) + b.dataset.marca + t.value.slice(t.selectionEnd);
        t.focus(); t.selectionStart = t.selectionEnd = i + b.dataset.marca.length;
      }));
      document.getElementById('mdVoltar').addEventListener('click', () => montarModelos(alvo));
      document.getElementById('mdSalvar').addEventListener('click', async () => {
        const dados = {
          nome: document.getElementById('mdNome').value.trim(),
          tipo: document.getElementById('mdTipo').value,
          corpo: document.getElementById('mdCorpo').value,
        };
        if (!dados.nome) { avisar('O modelo precisa de nome.'); return; }
        if (m.id) await db(supabaseClient.from('modelo_contrato').update(dados).eq('id', m.id), 'salvar');
        else await db(supabaseClient.from('modelo_contrato').insert(dados), 'criar');
        avisar('Modelo salvo.');
        await montarModelos(alvo);
      });
      const ex = document.getElementById('mdExcluir');
      if (ex) ex.addEventListener('click', async () => {
        if (!confirm(`Excluir o modelo "${m.nome}"?`)) return;
        await db(supabaseClient.from('modelo_contrato').delete().eq('id', m.id), 'excluir');
        avisar('Modelo excluído.');
        await montarModelos(alvo);
      });
      return;
    }

    alvo.innerHTML = `
      <div class="secao-topo">
        <div class="secao-titulo"><div class="ponto"></div>
          <div><h2>Modelos de contrato</h2>
          <div class="secao-meta">O texto fica aqui, não no código. Você e o advogado mudam
            cláusula sem depender de programador.</div></div>
        </div>
        <div class="secao-acoes">
          <button class="btn btn-primario" id="mdNovo">Novo modelo</button>
        </div>
      </div>
      ${modelos.length ? `<div class="cad-tabela-scroll"><table class="cad-tabela">
          <thead><tr><th>Modelo</th><th>Para quem</th><th>Tamanho</th></tr></thead>
          <tbody>${modelos.map(m => `<tr class="cad-linha" data-id="${m.id}">
            <td><div class="cad-end-rua">${esc(m.nome)}</div></td>
            <td>${esc((TIPOS_MODELO.find(t => t[0] === m.tipo) || [, m.tipo])[1])}</td>
            <td class="cad-num">${(m.corpo || '').length} caracteres</td></tr>`).join('')}</tbody>
        </table></div>`
        : `<div class="vazio"><div class="vazio-ico">◎</div>
             <h3>Nenhum modelo ainda</h3>
             <p>Sem modelo, o botão <strong>Emitir contrato</strong> não tem o que gerar.</p></div>`}`;

    document.getElementById('mdNovo').addEventListener('click', () => montarModelos(alvo, 'novo'));
    alvo.querySelectorAll('.cad-linha').forEach(tr =>
      tr.addEventListener('click', () => montarModelos(alvo, tr.dataset.id)));
  }

  // ══════════════════════════════════════════════════════════════════
  // FICHA DO CORRETOR
  //
  // Completa porque é ela que alimenta o contrato. Ficha pela metade produz
  // documento cheio de lacuna, que é pior que documento nenhum.
  // ══════════════════════════════════════════════════════════════════

  async function montarFicha(alvo, id) {
    const eu = Plataforma.perfil;
    if (!eu || eu.papel !== 'admin') { return montar(alvo, 'equipe'); }

    const linhas = await db(supabaseClient.from('perfil').select('*').eq('id', id).limit(1), 'abrir a ficha');
    const c = linhas[0];
    if (!c) return montar(alvo, 'equipe');

    const campo = (id_, rot, val, tipo = 'text', dica = '', largo = false, ph = '') => `
      <div class="campo${largo ? ' campo-largo' : ''}">
        <label for="${id_}">${rot}</label>
        <input type="${tipo}" id="${id_}" value="${esc(val ?? '')}" placeholder="${esc(ph)}">
        ${dica ? `<p class="campo-dica">${dica}</p>` : ''}
      </div>`;

    const sel = (id_, rot, val, opcoes) => `
      <div class="campo"><label for="${id_}">${rot}</label>
        <select id="${id_}"><option value="">—</option>
          ${opcoes.map(o => `<option value="${esc(o)}"${o === val ? ' selected' : ''}>${esc(o)}</option>`).join('')}
        </select></div>`;

    const faltando = ['cpf', 'creci', 'endereco', 'cidade'].filter(k => !c[k]);

    alvo.innerHTML = `
      <div class="secao-topo">
        <div class="secao-titulo"><div class="ponto"></div>
          <div><h2>${esc(c.nome)}</h2>
          <div class="secao-meta">${esc(c.email)} · ${c.aprovado ? 'aprovado' : 'esperando aprovação'}</div></div>
        </div>
        <div class="secao-acoes">
          <button class="btn" id="crContrato">Emitir contrato</button>
          <button class="btn" id="crVoltar">Voltar à equipe</button>
          <button class="btn btn-primario" id="crSalvar">Salvar</button>
        </div>
      </div>

      ${faltando.length ? `<div class="ficha-secao" style="border-color:rgba(212,160,23,.4)">
        <div style="padding:14px 20px">
          <p class="campo-dica" style="color:var(--amarelo)">
            Falta preencher: <strong>${faltando.join(', ')}</strong>.
            O contrato sai com lacuna enquanto isso.</p></div></div>` : ''}

      <div class="ficha-secao">
        <div class="ficha-secao-topo"><h3>Pessoa</h3></div>
        <div class="ficha-grade">
          ${campo('crNome', 'Nome completo', c.nome, 'text', '', true)}
          ${campo('crCpf', 'CPF', c.cpf, 'text', '', false, '000.000.000-00')}
          ${campo('crRg', 'RG', c.rg)}
          ${campo('crNasc', 'Nascimento', c.nascimento, 'date')}
          ${sel('crEstadoCivil', 'Estado civil', c.estado_civil, ESTADO_CIVIL)}
          ${campo('crNacional', 'Nacionalidade', c.nacionalidade)}
        </div>
      </div>

      <div class="ficha-secao">
        <div class="ficha-secao-topo"><h3>Contato</h3></div>
        <div class="ficha-grade">
          ${campo('crEmail', 'E-mail', c.email, 'email', 'É por ele que a pessoa entra no sistema. Mudar aqui não muda o acesso.', true)}
          ${campo('crTelefone', 'Telefone', c.telefone, 'tel', '', false, '(53) 9 9999-9999')}
        </div>
      </div>

      <div class="ficha-secao">
        <div class="ficha-secao-topo"><h3>Profissional</h3></div>
        <div class="ficha-grade">
          ${campo('crCreci', 'CRECI', c.creci, 'text', '', false, '61580')}
          ${campo('crCreciUf', 'UF do CRECI', c.creci_estado)}
          ${campo('crAdmissao', 'Início na equipe', c.admissao, 'date')}
          ${campo('crComissao', 'Comissão (%)', c.comissao_pct, 'number',
             'Quanto cabe a esta pessoa na comissão da imobiliária.')}
          ${campo('crCnpj', 'CNPJ', c.cnpj, 'text',
             'Se preenchido, o contrato sai como prestação de serviço entre empresas.', false, '00.000.000/0001-00')}
          ${campo('crRazao', 'Razão social', c.razao_social, 'text', '', true)}
        </div>
      </div>

      <div class="ficha-secao">
        <div class="ficha-secao-topo"><h3>Endereço</h3></div>
        <div class="ficha-grade">
          ${campo('crCep', 'CEP', c.cep, 'text', '', false, '96010-000')}
          ${campo('crEndereco', 'Logradouro', c.endereco, 'text', '', true)}
          ${campo('crNumero', 'Número', c.numero)}
          ${campo('crCompl', 'Complemento', c.complemento)}
          ${campo('crBairro', 'Bairro', c.bairro)}
          ${campo('crCidade', 'Cidade', c.cidade)}
          ${campo('crUf', 'UF', c.uf)}
        </div>
      </div>

      <div class="ficha-secao">
        <div class="ficha-secao-topo"><h3>Pagamento</h3>
          <p>Para onde vai a comissão desta pessoa.</p></div>
        <div class="ficha-grade">
          ${campo('crPix', 'Chave PIX', c.pix, 'text', '', true)}
          ${campo('crBanco', 'Banco', c.banco)}
          ${campo('crAgencia', 'Agência', c.agencia)}
          ${campo('crConta', 'Conta', c.conta)}
        </div>
      </div>

      <div class="ficha-secao">
        <div class="ficha-secao-topo"><h3>Notas internas</h3></div>
        <div class="ficha-grade">
          <div class="campo campo-largo"><label for="crObs">Observações</label>
            <textarea id="crObs" rows="3">${esc(c.obs ?? '')}</textarea></div>
        </div>
      </div>

      <div class="ficha-rodape">
        <button class="btn" id="crVoltar2">Voltar à equipe</button>
        <button class="btn btn-primario" id="crSalvar2">Salvar</button>
      </div>`;

    ['crVoltar', 'crVoltar2'].forEach(i =>
      document.getElementById(i).addEventListener('click', () => montar(alvoEl, 'equipe')));
    ['crSalvar', 'crSalvar2'].forEach(i =>
      document.getElementById(i).addEventListener('click', salvar));
    document.getElementById('crContrato').addEventListener('click', () => emitirContrato(c));

    async function salvar() {
      const v = i => {
        const el = document.getElementById(i);
        return el.value.trim() === '' ? null : el.value.trim();
      };
      const dados = {
        nome: v('crNome') || c.nome, cpf: v('crCpf'), rg: v('crRg'),
        nascimento: v('crNasc'), estado_civil: v('crEstadoCivil'),
        nacionalidade: v('crNacional'), telefone: v('crTelefone'),
        creci: v('crCreci'), creci_estado: v('crCreciUf'), admissao: v('crAdmissao'),
        comissao_pct: v('crComissao') ? Number(v('crComissao')) : null,
        cnpj: v('crCnpj'), razao_social: v('crRazao'),
        cep: v('crCep'), endereco: v('crEndereco'), numero: v('crNumero'),
        complemento: v('crCompl'), bairro: v('crBairro'), cidade: v('crCidade'), uf: v('crUf'),
        pix: v('crPix'), banco: v('crBanco'), agencia: v('crAgencia'), conta: v('crConta'),
        obs: v('crObs'),
      };
      await db(supabaseClient.from('perfil').update(dados).eq('id', id), 'salvar a ficha');
      avisar('Ficha salva.');
      await montarFicha(alvoEl, id);
    }
  }

  // ── Emitir contrato ─────────────────────────────────────────────────
  // O texto vem de um modelo cadastrado, não do código: contrato é assunto
  // dele e do advogado, e trocar cláusula não pode exigir programador.
  async function emitirContrato(c) {
    const modelos = await db(supabaseClient.from('modelo_contrato').select('*')
      .eq('tipo', 'corretor').eq('ativo', true).order('ordem'), 'carregar modelos');

    const cfgs = await db(supabaseClient.from('configuracao').select('*').limit(1), 'carregar configuração');
    const cfg = cfgs[0] || {};

    // Marcadores disponíveis. Mostrar a lista importa: é o que ele precisa
    // saber para escrever o modelo.
    const marcas = {
      '{{nome}}': c.nome, '{{cpf}}': c.cpf, '{{rg}}': c.rg,
      '{{nascimento}}': c.nascimento ? new Date(c.nascimento + 'T12:00').toLocaleDateString('pt-BR') : null,
      '{{estado_civil}}': c.estado_civil, '{{nacionalidade}}': c.nacionalidade,
      '{{email}}': c.email, '{{telefone}}': c.telefone,
      '{{creci}}': c.creci ? `${c.creci}/${c.creci_estado || 'RS'}` : null,
      '{{cnpj}}': c.cnpj, '{{razao_social}}': c.razao_social,
      '{{comissao}}': c.comissao_pct != null ? `${c.comissao_pct}%` : null,
      '{{endereco_completo}}': [c.endereco, c.numero, c.complemento, c.bairro,
                                c.cidade && `${c.cidade}/${c.uf || 'RS'}`, c.cep]
                                .filter(Boolean).join(', ') || null,
      '{{pix}}': c.pix,
      '{{imobiliaria}}': cfg.nome_imobiliaria, '{{creci_imobiliaria}}': cfg.creci,
      '{{cidade_hoje}}': `${cfg.cidade_padrao || 'Pelotas'}, ${new Date().toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' })}`,
    };

    const listaMarcas = Object.entries(marcas).map(([m, v]) =>
      `<tr><td><code>${esc(m)}</code></td><td>${v ? esc(v) : '<span class="cad-vazio">vazio na ficha</span>'}</td></tr>`).join('');

    const alvo = alvoEl;
    alvo.innerHTML = `
      <div class="secao-topo">
        <div class="secao-titulo"><div class="ponto"></div>
          <div><h2>Emitir contrato</h2>
          <div class="secao-meta">${esc(c.nome)}</div></div>
        </div>
        <div class="secao-acoes">
          <button class="btn" id="ctVoltar">Voltar à ficha</button>
        </div>
      </div>

      ${modelos.length ? `
        <div class="ficha-secao">
          <div class="ficha-secao-topo"><h3>Escolha o modelo</h3></div>
          <div class="ficha-grade">
            <div class="campo campo-largo"><label for="ctModelo">Modelo</label>
              <select id="ctModelo">${modelos.map(m =>
                `<option value="${m.id}">${esc(m.nome)}</option>`).join('')}</select></div>
          </div>
          <div class="ficha-rodape" style="padding:0 20px 18px">
            <button class="btn btn-primario" id="ctGerar">Gerar documento</button>
          </div>
        </div>`
      : `<div class="ficha-secao">
           <div class="ficha-secao-topo"><h3>Nenhum modelo cadastrado ainda</h3>
             <p>O texto do contrato fica num modelo, não no código, para você e o advogado
                mudarem cláusula sem depender de programador.</p></div>
           <div style="padding:0 20px 18px">
             <button class="btn btn-primario" id="ctNovoModelo">Criar o primeiro modelo</button>
           </div>
         </div>`}

      <div class="ficha-secao">
        <div class="ficha-secao-topo"><h3>Marcadores disponíveis</h3>
          <p>Escreva o modelo usando estes marcadores. Na emissão eles viram os dados reais.
             O que estiver vazio na ficha aparece destacado no documento, em vez de sumir:
             lacuna invisível em contrato é armadilha.</p></div>
        <div class="cad-tabela-scroll" style="border:none;border-radius:0">
          <table class="cad-tabela">
            <thead><tr><th>Marcador</th><th>Valor nesta ficha</th></tr></thead>
            <tbody>${listaMarcas}</tbody></table>
        </div>
      </div>`;

    document.getElementById('ctVoltar').addEventListener('click', () => montarFicha(alvoEl, c.id));
    const btNovo = document.getElementById('ctNovoModelo');
    if (btNovo) btNovo.addEventListener('click', () => novoModelo(c));
    const btGerar = document.getElementById('ctGerar');
    if (btGerar) btGerar.addEventListener('click', () => {
      const m = modelos.find(x => x.id === document.getElementById('ctModelo').value);
      gerarDocumento(m, marcas, c);
    });
  }

  async function novoModelo(c) {
    const nome = prompt('Nome do modelo (ex.: Contrato de parceria)');
    if (!nome) return;
    await db(supabaseClient.from('modelo_contrato').insert({
      nome, tipo: 'corretor',
      corpo: 'Escreva aqui o texto do contrato.\n\nUse marcadores como {{nome}}, {{cpf}}, '
           + '{{creci}} e {{comissao}} onde os dados devem entrar.\n\n{{cidade_hoje}}',
    }), 'criar o modelo');
    avisar('Modelo criado. O texto se edita em Corretores → Modelos de contrato.');
    await emitirContrato(c);
  }

  function gerarDocumento(modelo, marcas, c) {
    if (!modelo) { avisar('Escolha um modelo.'); return; }
    let texto = modelo.corpo || '';
    let lacunas = 0;
    for (const [m, v] of Object.entries(marcas)) {
      if (texto.includes(m)) {
        if (v) texto = texto.split(m).join(v);
        else { texto = texto.split(m).join('«PREENCHER»'); lacunas++; }
      }
    }
    const paragrafos = texto.split(/\n\s*\n/).map(b =>
      '<p>' + esc(b.trim()).replace(/\n/g, '<br>') + '</p>').join('');

    const w = window.open('', '_blank');
    w.document.write(`<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8">
      <title>${esc(modelo.nome)} — ${esc(c.nome)}</title>
      <style>
        @page{size:A4 portrait;margin:22mm 20mm}
        body{font-family:Georgia,'Times New Roman',serif;font-size:11.5pt;line-height:1.7;
          color:#1a1a1a;max-width:780px;margin:0 auto;padding:24px}
        h1{font-size:15pt;text-align:center;margin-bottom:28px;letter-spacing:.5px}
        p{margin-bottom:13px;text-align:justify}
        .lacuna{background:#ffe9a8;padding:0 3px;font-weight:700}
        .assinaturas{margin-top:64px;display:flex;gap:48px;justify-content:space-between}
        .assinaturas div{flex:1;border-top:1px solid #333;padding-top:7px;text-align:center;font-size:10pt}
        @media print{.aviso{display:none}}
        .aviso{background:#fff4d6;border:1px solid #e0c060;padding:10px 14px;
          border-radius:5px;font-family:system-ui;font-size:10pt;margin-bottom:24px}
      </style></head><body>
      ${lacunas ? `<div class="aviso"><strong>${lacunas} lacuna${lacunas > 1 ? 's' : ''}</strong>
        no documento, destacada${lacunas > 1 ? 's' : ''} em amarelo. Complete a ficha e emita de novo.</div>` : ''}
      <h1>${esc(modelo.nome)}</h1>
      ${paragrafos.split('«PREENCHER»').join('<span class="lacuna">«PREENCHER»</span>')}
      <div class="assinaturas">
        <div>${esc(c.nome)}</div>
        <div>Maysonnave Imóveis</div>
      </div>
      </body></html>`);
    w.document.close();
    avisar(lacunas ? `Documento gerado com ${lacunas} lacuna(s).` : 'Documento gerado.');
  }

  // ══════════════════════════════════════════════════════════════════
  // AGENDA DO GOOGLE
  // ══════════════════════════════════════════════════════════════════
  async function montarAgenda(alvo) {
    const eu = Plataforma.perfil;
    const linhas = await db(supabaseClient.from('integracao_google')
      .select('*').eq('perfil_id', eu.id).limit(1), 'carregar a integração');
    const meu = linhas[0] || {};
    const cfgs = await db(supabaseClient.from('configuracao').select('*').limit(1), 'carregar configuração');
    const cfg = cfgs[0] || {};

    alvo.innerHTML = `
      <div class="secao-topo">
        <div class="secao-titulo"><div class="ponto"></div>
          <div><h2>Agenda do Google</h2>
          <div class="secao-meta">A conexão é por corretor: cada um liga a própria conta,
            como você definiu.</div></div>
        </div>
      </div>

      <div class="ficha-secao">
        <div class="ficha-secao-topo">
          <h3>Funcionando hoje, sem configurar nada</h3>
          <p>Todo compromisso da Agenda tem o botão <strong>Adicionar ao Google Agenda</strong>.
             Ele abre o Google já preenchido com título, data, hora e local, e você confirma.
             Funciona no computador e no celular, sem login e sem token.</p>
        </div>
        <div style="padding:16px 20px">
          <p class="campo-dica">Serve para a maioria dos casos. O que ele não faz é trazer de
          volta o que você marcou direto no Google, nem apagar lá o que você cancelar aqui.</p>
        </div>
      </div>

      <div class="ficha-secao">
        <div class="ficha-secao-topo">
          <h3>Sincronia de mão dupla</h3>
          <p>Para o compromisso nascer no Google sozinho e o cancelamento sumir dos dois lados,
             o Google exige autorização por conta, e isso depende de um projeto no Google Cloud.</p>
        </div>
        <div class="ficha-grade">
          <div class="campo campo-largo">
            <label for="agClientId">ID do cliente OAuth</label>
            <input type="text" id="agClientId" value="${esc(cfg.google_client_id ?? '')}"
                   placeholder="000000000000-xxxxxxxx.apps.googleusercontent.com">
            <p class="campo-dica">Google Cloud → APIs e serviços → Credenciais → Criar credenciais
              → ID do cliente OAuth. Ative a Google Calendar API no mesmo projeto.</p>
          </div>
          <div class="campo campo-largo">
            <label for="agCalendario">Sua agenda</label>
            <input type="text" id="agCalendario" value="${esc(meu.calendar_id ?? '')}"
                   placeholder="${esc(eu.email)}">
            <p class="campo-dica">Em branco usa a agenda principal da sua conta.</p>
          </div>
          <div class="campo campo-largo">
            <div class="check" style="cursor:default">
              <span><strong>Situação:</strong>
                <em>${meu.conectado_em
                  ? 'Conectado em ' + data(meu.conectado_em)
                  : 'Não conectado. Falta o ID do cliente para o botão de conectar aparecer.'}</em></span>
            </div>
          </div>
        </div>
        <div class="ficha-rodape" style="padding:0 20px 18px">
          <button class="btn btn-primario" id="agSalvar">Salvar</button>
        </div>
      </div>

      <div class="ficha-secao">
        <div class="ficha-secao-topo"><h3>O que falta para ligar de vez</h3></div>
        <div style="padding:16px 20px">
          <ol class="passos">
            <li><h3>Criar o projeto no Google Cloud</h3>
              <p>Gratuito. Ativar a Google Calendar API e criar um ID de cliente OAuth.</p></li>
            <li><h3>Publicar a plataforma em HTTPS</h3>
              <p>O Google só aceita retorno de endereço seguro. Enquanto ela roda em
                 <code>localhost</code>, funciona para teste, mas não para a equipe.</p></li>
            <li><h3>Autorizar, cada um na própria conta</h3>
              <p>Você, o Marcos e cada parceiro clicam em conectar uma vez. A partir daí o
                 compromisso criado aqui aparece na agenda de cada um.</p></li>
          </ol>
          <p class="campo-dica" style="margin-top:14px">Os campos do banco já existem
          (<code>google_event_id</code> em cada compromisso), então ligar isso depois não
          exige mudar estrutura nenhuma.</p>
        </div>
      </div>`;

    document.getElementById('agSalvar').addEventListener('click', async () => {
      const cal = document.getElementById('agCalendario').value.trim() || null;
      const cid = document.getElementById('agClientId').value.trim() || null;
      await db(supabaseClient.from('integracao_google')
        .upsert({ perfil_id: eu.id, calendar_id: cal }, { onConflict: 'perfil_id' }),
        'salvar a agenda');
      await db(supabaseClient.from('configuracao')
        .update({ google_client_id: cid }).eq('id', true), 'salvar o ID do cliente');
      avisar('Salvo.');
    });
  }

  Plataforma.registrar('corretores', { titulo: 'Corretores', montar });
})();
