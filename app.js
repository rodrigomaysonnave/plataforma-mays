// ══════════════════════════════════════════════════════════════════════
// PLATAFORMA MAYS — núcleo
//
// Só o que é de todo mundo: entrar, sair, trocar de módulo, e os ajudantes
// que os módulos reaproveitam (consultar o banco, avisar que salvou, escapar
// texto). Regra da casa: MÓDULO NOVO NASCE EM ARQUIVO PRÓPRIO (mod-*.js).
// Este arquivo não deve crescer com funcionalidade de módulo.
//
// Um módulo se registra assim, e o núcleo não precisa conhecê-lo:
//   Plataforma.registrar('configuracoes', { titulo: '…', montar(alvo) {…} });
// ══════════════════════════════════════════════════════════════════════

const Plataforma = (() => {
  'use strict';

  const modulos = {};
  let usuario = null;   // { id, email }
  let perfil  = null;   // linha de public.perfil
  let atual   = null;

  // ── Ajudantes ──────────────────────────────────────────────────────
  const esc = s => String(s ?? '').replace(/[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const $ = id => document.getElementById(id);

  let avisoTimer = null;
  function avisar(texto) {
    let el = document.querySelector('.aviso-salvo');
    if (!el) { el = document.createElement('div'); el.className = 'aviso-salvo'; document.body.appendChild(el); }
    el.textContent = texto;
    clearTimeout(avisoTimer);
    avisoTimer = setTimeout(() => el.remove(), 2200);
  }

  // Envolve as chamadas ao Supabase pra o erro aparecer na tela em vez de
  // morrer no console. Módulo que engole erro em silêncio é o pior de depurar.
  async function db(promessa, oQueEstavaFazendo) {
    const { data, error } = await promessa;
    if (error) {
      console.error(oQueEstavaFazendo, error);
      avisar(`Falhou ao ${oQueEstavaFazendo}: ${error.message}`);
      throw error;
    }
    return data;
  }

  // ── Módulos ────────────────────────────────────────────────────────
  function registrar(nome, def) { modulos[nome] = def; }

  async function irPara(nome, arg) {
    atual = nome;
    document.querySelectorAll('.menu-item').forEach(b =>
      b.classList.toggle('ativo', b.dataset.modulo === nome));
    // Submenu do módulo atual fica aberto; os outros recolhem. Assim a barra
    // não vira uma árvore inteira expandida.
    document.querySelectorAll('.submenu').forEach(s =>
      s.classList.toggle('aberto', s.dataset.de === nome));
    document.querySelectorAll('.menu-sub').forEach(b =>
      b.classList.toggle('ativo', b.dataset.modulo === nome && b.dataset.sub === (arg || '')));

    const botao = document.querySelector(`.menu-item[data-modulo="${nome}"]`);
    const rotulo = botao ? botao.querySelector('.menu-txt').textContent.trim() : nome;
    const subAtivo = document.querySelector(
      `.menu-sub[data-modulo="${nome}"][data-sub="${arg || ''}"]`);
    $('trilhaAtual').textContent = subAtivo ? `${rotulo} › ${subAtivo.textContent.trim()}` : rotulo;
    document.title = `${rotulo} · Plataforma Mays`;
    try { localStorage.setItem('plat_modulo', nome); } catch (e) { /* sem persistência, tudo bem */ }

    const alvo = $('conteudo');
    const mod = modulos[nome];
    if (!mod) {
      alvo.innerHTML = `
        <div class="vazio-modulo">
          <div class="vazio-ico">◎</div>
          <h3>${esc(rotulo)} ainda não foi construído</h3>
          <p>Os módulos entram um por vez, cada um terminado antes do seguinte.
             Ver o desenho da plataforma para a ordem combinada.</p>
        </div>`;
      return;
    }
    alvo.innerHTML = '<div class="vazio"><p>Carregando…</p></div>';
    try {
      await mod.montar(alvo, arg);
    } catch (e) {
      console.error(e);
      alvo.innerHTML = `<div class="vazio"><div class="vazio-ico">!</div>
        <h3>Não consegui montar este módulo</h3><p>${esc(e.message || e)}</p></div>`;
    }
  }

  // ── Entrada e saída ────────────────────────────────────────────────
  function mostrar(tela) {
    $('telaLogin').hidden   = tela !== 'login';
    $('telaEspera').hidden  = tela !== 'espera';
    $('telaConvite').hidden = tela !== 'convite';
    $('app').hidden         = tela !== 'app';
  }

  // ── Convite ─────────────────────────────────────────────────────────
  // O segredo vem no endereço (#convite=…). Criar usuário direto exigiria a
  // chave de serviço do Supabase, que não pode ficar no navegador; por isso o
  // caminho é a pessoa criar a própria conta com um segredo de uso único.
  function segredoDoConvite() {
    const m = location.hash.match(/convite=([0-9a-f-]{36})/i);
    return m ? m[1] : null;
  }

  async function tentarConvite() {
    const segredo = segredoDoConvite();
    if (!segredo) return false;
    const { data, error } = await supabaseClient.rpc('abrir_convite', { p_segredo: segredo });
    const c = data && data[0];
    if (error || !c) {
      // Convite errado, já usado ou vencido: cai no login sem explicar qual
      // dos três, pra não virar ferramenta de adivinhação.
      mostrar('login');
      $('loginErro').textContent = 'Este convite não é mais válido. Peça um novo.';
      history.replaceState(null, '', location.pathname);
      return true;
    }
    $('conviteQuem').innerHTML =
      `<strong>${esc(c.nome)}</strong><br>${esc(c.email)}`;
    mostrar('convite');

    $('btnAceitar').onclick = async () => {
      const s1 = $('conviteSenha').value, s2 = $('conviteSenha2').value;
      const erro = $('conviteErro'), btn = $('btnAceitar');
      erro.textContent = '';
      if (s1.length < 6) { erro.textContent = 'A senha precisa de pelo menos 6 caracteres.'; return; }
      if (s1 !== s2) { erro.textContent = 'As duas senhas estão diferentes.'; return; }

      btn.disabled = true; btn.textContent = 'Criando…';
      const { data: novo, error: e1 } = await supabaseClient.auth.signUp({
        email: c.email, password: s1, options: { data: { nome: c.nome } },
      });
      if (e1) {
        erro.textContent = /already/i.test(e1.message)
          ? 'Já existe conta com este e-mail. Use "Entrar".' : e1.message;
        btn.disabled = false; btn.textContent = 'Criar meu acesso';
        return;
      }
      // O gatilho já criou o perfil. A função copia a ficha que o admin
      // preencheu e aprova o acesso.
      const { data: ok } = await supabaseClient.rpc('aceitar_convite', { p_segredo: segredo });
      history.replaceState(null, '', location.pathname);
      if (!ok) {
        erro.textContent = 'Conta criada, mas o convite não pôde ser aplicado. Fale com o administrador.';
        btn.disabled = false; btn.textContent = 'Criar meu acesso';
        return;
      }
      if (novo.session) aposLogin(novo.session.user);
      else { mostrar('login'); $('loginErro').textContent = 'Acesso criado. Entre com sua senha.'; }
    };
    return true;
  }

  async function aposLogin(sessaoUsuario) {
    usuario = sessaoUsuario;
    const linhas = await db(
      supabaseClient.from('perfil').select('*').eq('id', usuario.id).limit(1),
      'carregar seu perfil');
    perfil = linhas && linhas[0];

    if (!perfil || !perfil.aprovado) { mostrar('espera'); return; }

    $('topoUsuario').textContent =
      `${perfil.nome} · ${perfil.papel === 'admin' ? 'Admin' : 'Corretor'}`;

    // Nome do sistema vem da configuração, não do código: é o primeiro campo
    // que ele consegue mudar sozinho sem pedir nada a ninguém.
    try {
      const cfg = await db(supabaseClient.from('configuracao').select('*').limit(1),
                           'carregar as configurações');
      if (cfg && cfg[0]) {
        $('nomeSistema').textContent = cfg[0].nome_sistema || 'Plataforma Mays';
        $('nomeImobiliaria').textContent = cfg[0].nome_imobiliaria || '';
      }
    } catch (e) { /* segue com o padrão do HTML */ }

    mostrar('app');
    let inicial = 'configuracoes';
    try { inicial = localStorage.getItem('plat_modulo') || inicial; } catch (e) {}
    if (!document.querySelector(`.menu-item[data-modulo="${inicial}"]`)) inicial = 'configuracoes';
    irPara(inicial);
  }

  async function entrar() {
    const email = $('loginEmail').value.trim();
    const senha = $('loginSenha').value;
    const erro  = $('loginErro');
    const btn   = $('btnEntrar');
    erro.textContent = '';
    if (!email || !senha) { erro.textContent = 'Preencha e-mail e senha.'; return; }

    btn.disabled = true; btn.textContent = 'Entrando…';
    const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password: senha });
    btn.disabled = false; btn.textContent = 'Entrar';

    if (error) {
      // Mensagem em português e, quando dá, dizendo a causa real. "Email not
      // confirmed" parece senha errada e faz perder tempo procurando no lugar
      // errado — aconteceu de verdade em 13/08.
      erro.textContent = /not confirmed/i.test(error.message)
        ? 'E-mail ainda não confirmado neste projeto.'
        : /invalid login/i.test(error.message)
        ? 'E-mail ou senha incorretos.'
        : error.message;
      return;
    }
    aposLogin(data.user);
  }

  async function sair() {
    await supabaseClient.auth.signOut();
    usuario = perfil = null;
    mostrar('login');
    $('loginSenha').value = '';
  }

  // ── Recolher a barra lateral ───────────────────────────────────────
  function aplicarRecolhido(recolhido) {
    $('app').classList.toggle('menu-recolhido', recolhido);
    const b = $('alternarMenu');
    b.title = recolhido ? 'Expandir menu' : 'Recolher menu';
    b.setAttribute('aria-label', b.title);
    b.setAttribute('aria-expanded', String(!recolhido));
  }

  // Marca no menu o que ainda não existe. Sem isso ele descobre clicando um
  // por um e o sistema parece quebrado, quando na verdade está incompleto de
  // propósito. Roda no DOMContentLoaded, quando todos os mod-*.js já se
  // registraram.
  function marcarModulosPendentes() {
    document.querySelectorAll('.menu-item').forEach(b => {
      const pronto = !!modulos[b.dataset.modulo];
      b.classList.toggle('nao-pronto', !pronto);
      if (!pronto && !b.querySelector('.menu-breve')) {
        const t = document.createElement('span');
        t.className = 'menu-breve';
        t.textContent = 'em breve';
        b.appendChild(t);
      }
      b.title = pronto ? '' : 'Ainda não construído';
    });
  }

  // ── Início ─────────────────────────────────────────────────────────
  function iniciar() {
    marcarModulosPendentes();
    $('btnEntrar').addEventListener('click', entrar);
    $('loginSenha').addEventListener('keydown', e => { if (e.key === 'Enter') entrar(); });
    $('loginEmail').addEventListener('keydown', e => { if (e.key === 'Enter') $('loginSenha').focus(); });
    $('btnSair').addEventListener('click', sair);
    $('btnSairEspera').addEventListener('click', sair);

    $('menu').addEventListener('click', e => {
      const sub = e.target.closest('.menu-sub');
      if (sub) { irPara(sub.dataset.modulo, sub.dataset.sub); return; }
      const b = e.target.closest('.menu-item');
      if (!b) return;
      // Item com submenu abre no primeiro filho: clicar no pai e não acontecer
      // nada é o tipo de coisa que faz a pessoa achar que travou.
      const filhos = document.querySelector(`.submenu[data-de="${b.dataset.modulo}"]`);
      const primeiro = filhos && filhos.querySelector('.menu-sub');
      irPara(b.dataset.modulo, primeiro ? primeiro.dataset.sub : undefined);
    });

    try { aplicarRecolhido(localStorage.getItem('plat_menu_recolhido') === '1'); } catch (e) {}
    $('alternarMenu').addEventListener('click', () => {
      const r = !$('app').classList.contains('menu-recolhido');
      aplicarRecolhido(r);
      try { localStorage.setItem('plat_menu_recolhido', r ? '1' : '0'); } catch (e) {}
    });

    supabaseClient.auth.getSession().then(async ({ data }) => {
      if (await tentarConvite()) return;
      if (data.session) aposLogin(data.session.user); else mostrar('login');
    });
  }

  document.addEventListener('DOMContentLoaded', iniciar);

  return { registrar, irPara, db, esc, avisar, $, get perfil() { return perfil; } };
})();
