// ══════════════════════════════════════════════════════════════════════
// SELO DE VERSÃO
//
// Era `v1.0` escrito à mão no index.html, sem nenhum JS tocando nele.
// Nunca mudou e nunca ia mudar: número de versão só é verdade enquanto
// alguém lembra de subir na mão, e ninguém lembra.
//
// Passa a mostrar a data em que o sistema no ar foi publicado, lida do
// cabeçalho Last-Modified do próprio app.js. Não precisa de etapa de
// compilação nem de alguém se lembrar de nada: o Pages carimba a data
// sozinho a cada publicação.
//
// De quebra resolve uma confusão que já aconteceu mais de uma vez: o
// servidor local (servidor.py) apaga o Last-Modified de propósito, pra
// nunca responder 304 e sempre servir o arquivo novo. Então a ausência
// do cabeçalho é a assinatura do local, e o selo pode dizer isso. Bate
// o olho no rodapé e sabe se está vendo a sua máquina ou o que está no ar.
// ══════════════════════════════════════════════════════════════════════

(() => {
  'use strict';

  const doisDigitos = n => String(n).padStart(2, '0');

  async function carimbar() {
    const selo = document.getElementById('versao');
    if (!selo) return;

    try {
      // HEAD porque só interessa o cabeçalho. no-store pra não ler a data
      // de uma cópia velha guardada pelo navegador, que é justamente o
      // erro que este selo existe pra não cometer.
      const r = await fetch('app.js', { method: 'HEAD', cache: 'no-store' });
      const quando = r.headers.get('last-modified');

      if (!quando) {                 // sem cabeçalho: é o servidor local
        selo.textContent = 'local';
        selo.title = 'Rodando da sua máquina, não do que está publicado.';
        return;
      }

      const d = new Date(quando);
      if (isNaN(d)) throw new Error('data ilegível');
      selo.textContent = `${doisDigitos(d.getDate())}/${doisDigitos(d.getMonth() + 1)} `
                       + `${doisDigitos(d.getHours())}:${doisDigitos(d.getMinutes())}`;
      selo.title = 'Publicado em ' + d.toLocaleString('pt-BR');
    } catch (e) {
      // Falhar aqui não pode atrapalhar nada: é um selo de rodapé.
      selo.textContent = 'sem data';
      selo.title = 'Não deu pra ler a data da publicação.';
    }
  }

  if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', carimbar);
  else carimbar();
})();
