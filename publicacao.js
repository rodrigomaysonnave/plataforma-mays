// ══════════════════════════════════════════════════════════════════════
// PUBLICAÇÃO — salvar já publica no site
//
// O site é HTML estático: mudar o cadastro muda o banco na hora, mas a
// página no ar continua igual até alguém regerar. Isso vivia dando a
// impressão de bug ("salvo mas não atualiza no site") — a alteração estava
// certa, só não tinha sido publicada. Agora salvar dispara a publicação
// junto, e o botão de publicar em Site e portais fica como reserva, pra
// quem quiser forçar sem alterar nada.
//
// POR QUE DISPARAR DIRETO, SEM ESPERAR JUNTAR AS ALTERAÇÕES
// ---------------------------------------------------------
// O GitHub já agrupa sozinho: o workflow tem `concurrency` com grupo fixo,
// então fica no máximo uma execução rodando e uma esperando, e uma nova na
// fila descarta a anterior. Dez salvamentos seguidos viram uma publicação
// rodando e uma na fila, não dez. Segurar aqui no navegador seria pior:
// fechar a aba antes do tempo perderia a publicação.
//
// O que NÃO dispara: cliente, funil, agenda, financeiro, contrato. Nada
// disso aparece no site, e cada disparo é uma corrida de verdade no
// GitHub — publicar a cada telefone de cliente editado gastaria a cota
// à toa.
// ══════════════════════════════════════════════════════════════════════

const Publicacao = (() => {
  'use strict';
  const { avisar } = Plataforma;

  // Janela pra não repetir o pedido quando um salvamento só já mexe em
  // várias tabelas (ficha do imóvel grava dados, características e fotos).
  const JANELA = 5000;
  let ultimo = 0, agendado = null, avisadoErro = false;

  async function disparar() {
    const { data, error } = await supabaseClient.functions.invoke(
      'publicar-site', { body: { acao: 'disparar' } });
    let motivo = (error && error.message) || (data && data.error);
    if (error && error.context && typeof error.context.json === 'function') {
      try { const c = await error.context.json(); if (c && c.error) motivo = c.error; } catch (e) {}
    }
    if (motivo) throw new Error(motivo);
    return data;
  }

  async function enviar() {
    try {
      await disparar();
      avisadoErro = false;
    } catch (e) {
      // Falhar em publicar não pode parecer que o salvamento falhou — o dado
      // está guardado de qualquer jeito. Avisa uma vez e não fica repetindo
      // o mesmo erro a cada tecla.
      if (!avisadoErro) {
        avisadoErro = true;
        avisar(`Salvo, mas não consegui publicar: ${e.message}`);
      }
      console.error('publicar-site', e);
    }
  }

  /** Chamar depois de qualquer alteração que aparece no site. */
  function pedir() {
    const agora = Date.now();
    if (agora - ultimo >= JANELA) {
      ultimo = agora;
      enviar();
      return;
    }
    // Alteração dentro da janela: garante uma última publicação depois dela,
    // senão a mudança mais recente ficaria de fora da que já foi disparada.
    if (agendado) return;
    agendado = setTimeout(() => {
      agendado = null;
      ultimo = Date.now();
      enviar();
    }, JANELA - (agora - ultimo));
  }

  return { pedir, disparar };
})();
