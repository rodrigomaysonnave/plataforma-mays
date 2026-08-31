// ══════════════════════════════════════════════════════════════════════
// SELO DE VERSÃO
//
// Era `v1.0` escrito à mão no index.html, sem nenhum JS tocando nele.
// Nunca mudou desde o primeiro dia, porque número de versão só é verdade
// enquanto alguém lembra de subir na mão, e ninguém lembra.
//
// Agora são as duas coisas, e cada uma cobre o furo da outra:
//
//   O NÚMERO diz o quanto o sistema andou. Vem do histórico, não de
//   palpite: MAJOR.MINOR.PATCH onde MINOR é capacidade que antes não
//   existia (módulo, tela, integração, comportamento novo) e PATCH é
//   campo, regra, correção, refinamento. Cada MINOR está marcado com
//   uma tag no repositório, então `git describe --tags` responde em que
//   versão estamos sem ninguém precisar recontar.
//
//   A DATA diz quando esse número foi ao ar, lida do cabeçalho
//   Last-Modified do próprio app.js. É a rede de segurança: se um dia
//   eu esquecer de subir o número, a data denuncia na hora.
//
// E o selo ainda diz onde você está. O servidor local apaga o
// Last-Modified de propósito, pra nunca responder 304 e sempre servir o
// arquivo novo, então a ausência do cabeçalho é a assinatura do local.
// Bate o olho no rodapé e sabe se é a sua máquina ou o que está no ar.
// ══════════════════════════════════════════════════════════════════════

(() => {
  'use strict';

  // Sobe junto com a tag. Ver o cabeçalho acima pra regra de quando muda.
  const VERSAO = '1.21.0';

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
        selo.textContent = `v${VERSAO} local`;
        selo.title = `Versão ${VERSAO}, rodando da sua máquina e não do que está publicado.`;
        return;
      }

      const d = new Date(quando);
      if (isNaN(d)) throw new Error('data ilegível');
      selo.textContent = `v${VERSAO}`;
      selo.title = `Versão ${VERSAO}, publicada em ${d.toLocaleString('pt-BR')}.`;
    } catch (e) {
      // Falhar aqui não pode atrapalhar nada: é um selo de rodapé. Mas o
      // número vem do arquivo, não da rede, então ele sobrevive à falha.
      selo.textContent = `v${VERSAO}`;
      selo.title = `Versão ${VERSAO}. Não deu pra ler a data da publicação.`;
    }
  }

  if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', carimbar);
  else carimbar();
})();
