#!/usr/bin/env python3
"""Gerador do site público da Maysonnave Imóveis.

Lê o Supabase da Plataforma e escreve HTML estático em `publico/`.

POR QUE ESTÁTICO
----------------
A vitrine é destino de tráfego pago e de link no WhatsApp. Página montada no
navegador (o caso do site atual dele) marca 58 de performance no celular, com
LCP de 5,4s e 1,3MB de JavaScript. HTML pronto entrega o conteúdo na primeira
resposta e o Google indexa sem depender de execução.

POR QUE AS FOTOS SÃO BAIXADAS, E NÃO APONTADAS
----------------------------------------------
Seria mais fácil deixar o `<img src>` apontando pro Storage do Supabase. Mas
tráfego de saída do Supabase é medido, e o plano gratuito tem 5GB. Um site com
tráfego pago servindo foto de lá queima essa cota em dias — foi exatamente o
que aconteceu no sistema anterior, 4,3GB num mês. Aqui as imagens entram no
repositório e são servidas pelo GitHub Pages, onde a banda não é medida.

Uso:
    python3 gerar.py            gera em publico/
    python3 gerar.py --abrir    gera e abre no navegador
"""
import html
import json
import os
import re
import shutil
import subprocess
import sys
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

AQUI = Path(__file__).resolve().parent
SAIDA = AQUI / "publico"
CONF = Path.home() / ".config/mays-dashboard/plataforma.env"


# ── Acesso ao banco ────────────────────────────────────────────────────
def ler_env():
    # Numa esteira automática (GitHub Actions) não existe arquivo de
    # configuração no disco: as duas chaves chegam como variável de ambiente,
    # postas ali pelo workflow. No Mac dele, sem essas variáveis, cai no
    # arquivo de sempre, e nada muda no uso manual.
    if os.environ.get("PLAT_URL") and os.environ.get("PLAT_ANON_KEY"):
        return {"PLAT_URL": os.environ["PLAT_URL"], "PLAT_ANON_KEY": os.environ["PLAT_ANON_KEY"]}
    if not CONF.exists():
        sys.exit(f"Falta {CONF}")
    d = {}
    for l in CONF.read_text().splitlines():
        l = l.strip()
        if l and not l.startswith("#") and "=" in l:
            k, v = l.split("=", 1)
            d[k.strip()] = v.strip().strip("\"'")
    return d


ENV = ler_env()
URL, CHAVE = ENV["PLAT_URL"], ENV["PLAT_ANON_KEY"]


def curl_json(caminho):
    """A API fica atrás de Cloudflare, que recusa a assinatura do urllib."""
    saida = subprocess.run(
        ["curl", "-sS", "--max-time", "60", f"{URL}/rest/v1/{caminho}",
         "-H", f"apikey: {CHAVE}", "-H", f"Authorization: Bearer {CHAVE}"],
        capture_output=True, text=True)
    if saida.returncode != 0:
        sys.exit(f"curl falhou: {saida.stderr[:200]}")
    return json.loads(saida.stdout)


# ── Formatação ─────────────────────────────────────────────────────────
def e(s):
    return html.escape(str(s if s is not None else ""), quote=True)


def brl(v, finalidade=None):
    if v is None:
        return "Consulte"
    valor = "R$ " + f"{float(v):,.0f}".replace(",", ".")
    # Sem o "/mês", aluguel de R$ 2.000 fica lado a lado com venda de
    # R$ 1.690.000 e parece um apartamento de dois mil reais.
    return valor + "<small> /mês</small>" if finalidade == "aluguel" else valor


def medida(v, sufixo="m²"):
    if v is None:
        return None
    n = float(v)
    txt = f"{n:,.0f}".replace(",", ".") if n == int(n) else f"{n:,.1f}".replace(",", "X").replace(".", ",").replace("X", ".")
    return f"{txt} {sufixo}"


def cam(raiz, caminho):
    """Caminho do arquivo relativo à página que está sendo escrita."""
    if not caminho:
        return caminho
    return caminho if raiz in (".", "") else f"{raiz}/{caminho}"


def zap(cfg, imovel=None, msg=None):
    numero = (cfg.get("whatsapp") or "").strip()
    if not numero:
        return None
    if msg is None:
        msg = (f"Olá Rodrigo, vi o imóvel {imovel['codigo']} no site e gostaria de saber mais."
               if imovel else
               "Olá Rodrigo, cheguei pelo site e gostaria de falar sobre imóveis.")
    return f"https://wa.me/{numero}?text={urllib.parse.quote(msg)}"


# ── Imagens ────────────────────────────────────────────────────────────
def converter_webp(origem, largura):
    """JPEG vira WebP na largura pedida.

    A capa decide o LCP e era servida igual pro celular e pro monitor: 1600px
    em JPEG. Em WebP cai à metade, e com srcset o telefone baixa a de 480px.
    """
    destino = origem.with_name(origem.stem + f"-{largura}.webp")
    if destino.exists() and destino.stat().st_size > 0:
        return destino
    try:
        from PIL import Image
        img = Image.open(origem)
        if img.mode in ("RGBA", "P", "LA"):
            img = img.convert("RGB")
        if img.width > largura:
            img = img.resize((largura, round(img.height * largura / img.width)), Image.LANCZOS)
        img.save(destino, "WEBP", quality=80, method=4)
        return destino
    except Exception:
        return None


def baixar_foto(url, destino):
    """Baixa uma vez. Se já existe, reaproveita: gerar de novo não rebaixa tudo.

    `--connect-timeout` separado do `--max-time` porque foi exatamente a
    conexão que ficou presa (preso em SYN_SENT) numa geração — o vídeo de um
    reel do Instagram. O timeout do próprio `subprocess.run` é o último
    cinto de segurança, caso o curl não se mate sozinho."""
    if destino.exists() and destino.stat().st_size > 0:
        return True
    destino.parent.mkdir(parents=True, exist_ok=True)
    try:
        r = subprocess.run(
            ["curl", "-sS", "--connect-timeout", "15", "--max-time", "90", "-o", str(destino), url],
            capture_output=True, text=True, timeout=100)
    except subprocess.TimeoutExpired:
        print(f"      download travou (mais de 100s): {url[:80]}")
        return False
    return r.returncode == 0 and destino.exists() and destino.stat().st_size > 0


# ── Ícones de rede (SVG embutido — nada de fonte de ícone externa) ──────
ICONE_INSTAGRAM = ('<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" '
                   'stroke-width="1.8"><rect x="3" y="3" width="18" height="18" rx="5"/>'
                   '<circle cx="12" cy="12" r="4.2"/><circle cx="17.3" cy="6.7" r="1.1" fill="currentColor" stroke="none"/></svg>')
ICONE_YOUTUBE = ('<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" '
                 'stroke-width="1.8"><rect x="2.5" y="5.5" width="19" height="13" rx="4"/>'
                 '<path d="M10.5 9.5l5 2.5-5 2.5z" fill="currentColor" stroke="none"/></svg>')
ICONE_FACEBOOK = ('<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" '
                  'stroke-width="1.8"><circle cx="12" cy="12" r="9.5"/>'
                  '<path d="M14 8.5h-1.5c-.9 0-1.5.6-1.5 1.5v2h3l-.4 3h-2.6v6.3" stroke-linecap="round" stroke-linejoin="round"/></svg>')


# ── Estilo ─────────────────────────────────────────────────────────────
# Paleta do design guide dele. O caramelo #9B7B5A reprova contraste como texto
# (3,44:1 sobre o off-white), então texto, link e botão usam o par fechado
# #7D5F41. Sem isso a acessibilidade trava em 95.
CSS = """
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --tinta:#241C14;--tinta-2:#5C4E42;--tinta-3:#6F6155;--sobre-escuro:#A79684;
  --fundo:#FAF7F3;--superficie:#fff;--superficie-2:#F3EEE7;
  --linha:#E3DAD0;--marca:#7D5F41;--marca-clara:#9B7B5A;--escuro:#241C14;
}
html{scroll-behavior:smooth}
body{background:var(--fundo);color:var(--tinta);
  font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif;
  font-size:15px;line-height:1.6;-webkit-font-smoothing:antialiased}
img{max-width:100%;display:block}
/* Sem isto o filtro não esconde nada: `display:flex` do cartão vence o
   display:none padrão do atributo hidden, e a busca só atualiza o contador. */
[hidden]{display:none !important}
a{color:var(--marca)}
/* Medido no site de referência: o contêiner dele salta em degraus
   (1170 → 1380 → 1620) e para em 1620px, não em 1400. Em monitor de 1920
   a diferença é de 220px de cada lado, que é onde a página parecia estreita.
   min() dá o mesmo efeito sem depender de ponto de quebra. */
.env{width:min(92%,1620px);margin:0 auto}

/* Cabeçalho */
.cabeca{background:var(--superficie);border-bottom:1px solid var(--linha);position:sticky;top:0;z-index:50}
.cabeca .env{display:flex;align-items:center;gap:24px;padding-top:16px;padding-bottom:16px}
.marca{text-decoration:none;color:var(--tinta);flex-shrink:0;display:flex;align-items:center}
.marca-logo{display:block;height:52px;width:auto}
.nav{display:flex;align-items:center;gap:30px;margin-left:auto;flex-wrap:wrap}
.nav-item{color:var(--tinta-2);text-decoration:none;font-size:15px;font-weight:600;
  letter-spacing:.09em;text-transform:uppercase}
.nav-item:hover{color:var(--marca)}

/* Capa */
.capa{position:relative;background:var(--escuro);color:#fff;overflow:hidden}
.capa-foto{position:absolute;inset:0;object-fit:cover;width:100%;height:100%;opacity:.42}
.capa .env{position:relative;padding-top:96px;padding-bottom:120px}
.capa h1{font-family:Georgia,serif;font-weight:400;font-size:clamp(30px,5vw,50px);
  line-height:1.12;max-width:19ch;text-wrap:balance}
.capa p{margin-top:16px;font-size:18px;color:rgba(255,255,255,.86);max-width:52ch}
.capa-creci{font-size:12px;letter-spacing:.14em;text-transform:uppercase;
  color:var(--marca-clara);margin-bottom:18px}

/* Busca */
.busca{background:var(--superficie);border:1px solid var(--linha);border-radius:6px;
  box-shadow:0 12px 40px -20px rgba(36,28,20,.45);margin-top:-56px;position:relative;z-index:10}
.busca-topo{background:var(--escuro);color:#fff;padding:12px 20px;font-size:14px;
  font-weight:600;letter-spacing:.04em;border-radius:6px 6px 0 0}
.busca-campos{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;padding:18px 20px}
.busca-campos label{display:block;font-size:10.5px;font-weight:700;letter-spacing:.09em;
  text-transform:uppercase;color:var(--tinta-3);margin-bottom:5px}
.busca-campos select,.busca-campos input{width:100%;padding:10px 12px;font-size:14px;
  border:1px solid var(--linha);border-radius:4px;background:var(--fundo);
  color:var(--tinta);font-family:inherit}
.busca-campos select:focus,.busca-campos input:focus{outline:2px solid var(--marca);outline-offset:1px}

/* Seções */
.secao{margin:56px 0}
.secao-barra{background:var(--escuro);color:#fff;padding:13px 20px;border-radius:4px;
  display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap}
.secao-barra h2{font-family:Georgia,serif;font-weight:400;font-size:21px}
.secao-barra span{font-size:12.5px;color:rgba(255,255,255,.7)}

/* Cartões */
/* Quatro colunas fixas, como no site de referência. Com auto-fill o número
   de cartões mudava conforme a tela (5 em 1920), e a grade perdia o ritmo. */
.grade{display:grid;grid-template-columns:repeat(4,1fr);gap:20px;margin-top:20px}
@media(max-width:1180px){.grade{grid-template-columns:repeat(3,1fr)}}
@media(max-width:880px){.grade{grid-template-columns:repeat(2,1fr);gap:14px}}
@media(max-width:560px){.grade{grid-template-columns:1fr}}
.cartao{background:var(--superficie);border:1px solid var(--linha);border-radius:5px;
  overflow:hidden;display:flex;flex-direction:column;text-decoration:none;color:inherit;
  transition:box-shadow .18s,transform .18s}
.cartao:hover{box-shadow:0 14px 36px -22px rgba(36,28,20,.5);transform:translateY(-2px)}
.cartao-foto{position:relative;aspect-ratio:3/2;background:var(--superficie-2);overflow:hidden}
.cartao-foto img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.cartao-selo{position:absolute;top:14px;right:56px;background:rgba(36,28,20,.86);color:#fff;
  font-size:10.5px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;padding:4px 9px;border-radius:3px}
.cartao-corpo{padding:14px 16px 16px;display:flex;flex-direction:column;gap:8px;flex:1}
.cartao-local{font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--marca)}
.cartao-titulo{display:flex;align-items:baseline;justify-content:space-between;gap:10px}
.cartao-titulo h3{font-size:14.5px;font-weight:600;line-height:1.35}
.cartao-ref{font-size:11px;color:var(--tinta-3);font-variant-numeric:tabular-nums;flex-shrink:0}
.cartao-itens{display:flex;flex-wrap:wrap;gap:12px;font-size:12.5px;color:var(--tinta-2);
  padding-top:4px;border-top:1px solid var(--linha)}
.cartao-itens b{font-weight:700;font-variant-numeric:tabular-nums}
.cartao-preco{margin-top:auto;padding-top:10px;border-top:1px solid var(--linha);
  font-size:19px;font-weight:700;color:var(--tinta);font-variant-numeric:tabular-nums}

/* Ficha */
.ficha-capa{position:relative;aspect-ratio:16/9;background:var(--superficie-2);
  border-radius:6px;overflow:hidden;margin-bottom:12px}
/* Fundo borrado: preenche a sobra quando a foto não tem a proporção da
   moldura, em vez de deixar faixa cinza. A imagem some atrás do desfoque,
   então não compete com a foto de frente. */
.ficha-capa::before{content:"";position:absolute;inset:-8%;background-image:var(--fundo);
  background-size:cover;background-position:center;filter:blur(26px) saturate(1.15);
  transform:scale(1.08);opacity:.6}
.ficha-capa img{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;z-index:1}
.galeria{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px}
.galeria a{display:block}
.galeria img{aspect-ratio:4/3;object-fit:cover;border-radius:4px;width:100%}
.ficha{display:grid;grid-template-columns:minmax(0,1.7fr) minmax(280px,1fr);gap:32px;align-items:start;margin:32px 0 56px}
.ficha h1{font-family:Georgia,serif;font-weight:400;font-size:clamp(24px,3.6vw,34px);line-height:1.2;margin-bottom:8px}
.ficha-local{font-size:12.5px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--marca);margin-bottom:20px}
.ficha-desc{margin:24px 0;color:var(--tinta-2);line-height:1.7}
.ficha-desc p,.prose p{margin-bottom:1.1em}
.ficha-desc p:last-child,.prose p:last-child{margin-bottom:0}
.dados{display:grid;grid-template-columns:repeat(auto-fit,minmax(128px,1fr));gap:1px;
  background:var(--linha);border:1px solid var(--linha);border-radius:5px;overflow:hidden;margin:24px 0}
.dados div{background:var(--superficie);padding:13px 15px}
.dados dt{font-size:10.5px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--tinta-3)}
.dados dd{font-size:16px;font-weight:600;margin-top:3px;font-variant-numeric:tabular-nums}
.lateral{position:sticky;top:96px;background:var(--superficie);border:1px solid var(--linha);border-radius:6px;padding:22px}
.lateral-preco{font-family:Georgia,serif;font-size:29px;font-variant-numeric:tabular-nums}
.lateral-ref{font-size:12px;color:var(--tinta-3);margin-top:4px}
.lateral-empreendimento{font-size:12.5px;color:var(--tinta-3);margin-top:10px}
.lateral-empreendimento a{color:var(--marca);font-weight:600;text-decoration:underline}
.cond-resumo{margin-top:36px;padding-top:28px;border-top:1px solid var(--linha)}
.cond-resumo h2{font-family:Georgia,serif;font-weight:400;font-size:19px;margin-bottom:12px}
.cond-fotos-link{display:inline-block;margin-top:10px;font-size:13.5px;font-weight:600;color:var(--marca)}
.lateral-agenciador{display:flex;flex-direction:column;align-items:center;text-align:center;gap:10px;
  margin-top:20px;padding-top:18px;border-top:1px solid var(--linha)}
.ag-foto img,.ag-iniciais{width:130px;height:130px;border-radius:50%;object-fit:cover;flex-shrink:0}
.ag-iniciais{display:flex;align-items:center;justify-content:center;background:var(--superficie-2);
  color:var(--marca);font-family:Georgia,serif;font-size:44px}
.ag-corpo{min-width:0}
.ag-rot{display:block;font-size:11px;color:var(--tinta-3);text-transform:uppercase;letter-spacing:.04em}
.ag-corpo strong{display:block;font-size:14.5px;margin-top:2px}
.ag-creci{display:block;font-size:12px;color:var(--tinta-3);margin-top:1px}
.ag-bio{font-size:12.5px;color:var(--tinta-2);line-height:1.55;margin-top:6px}
.botao{display:flex;align-items:center;justify-content:center;gap:8px;width:100%;
  padding:13px 18px;border-radius:5px;font-size:14.5px;font-weight:700;text-decoration:none;
  margin-top:12px;border:1px solid var(--marca);color:var(--marca);background:transparent}
.botao-cheio{background:var(--marca);color:#fff}
.botao:hover{filter:brightness(1.08)}
.extras{display:flex;flex-wrap:wrap;gap:8px;margin:20px 0}
.extra{font-size:12.5px;padding:5px 11px;border:1px solid var(--linha);border-radius:20px;color:var(--tinta-2)}

/* Rodapé */
.rodape{background:var(--escuro);color:#C9BEB1;margin-top:64px;padding:44px 0 32px;font-size:13.5px}
.rodape .env{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:28px}
.rodape strong{color:#fff;display:block;margin-bottom:9px;font-size:14px}
.rodape a{color:#C9BEB1;text-decoration:none}
.rodape a:hover{color:var(--marca-clara)}
.rodape-fim{border-top:1px solid rgba(255,255,255,.12);margin-top:30px;padding-top:18px;
  font-size:12px;color:var(--sobre-escuro);text-align:center}
.rodape-redes{display:flex;gap:10px;margin-top:2px}
.rodape-rede{display:inline-flex;align-items:center;justify-content:center;width:34px;height:34px;
  border:1px solid rgba(255,255,255,.22);border-radius:50%;transition:background .15s,border-color .15s}
.rodape-rede:hover{background:rgba(255,255,255,.14);border-color:transparent;color:var(--marca-clara)}
.vazio-site{text-align:center;padding:70px 20px;color:var(--tinta-3)}

.cartao-preco small{font-size:12.5px;font-weight:400;color:var(--tinta-3)}
.lateral-preco small{font-size:15px;color:var(--tinta-3)}
.cartao-fin-selo{position:absolute;top:10px;left:10px;background:var(--marca);color:#fff;
  font-size:10.5px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;
  padding:4px 9px;border-radius:3px}

/* Semelhantes */
.semelhantes{background:var(--escuro);color:#fff;padding:44px 0 52px;margin-top:52px}
.semelhantes h2{font-family:Georgia,serif;font-weight:400;font-size:24px;margin-bottom:6px}
.semelhantes .cartao{background:var(--superficie);color:var(--tinta)}

/* Condomínio */
.cond-capa{aspect-ratio:16/7;border-radius:4px;overflow:hidden;margin-top:18px}
.cond-capa img{width:100%;height:100%;object-fit:cover;display:block}
.cond-galeria{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));
  gap:10px;margin-top:16px}
.cond-galeria img{width:100%;aspect-ratio:3/2;object-fit:cover;border-radius:3px;display:block}

/* Formulário de lead */
.form-lead{background:var(--superficie-2);padding:48px 0}
.form-caixa{max-width:620px;margin:0 auto;background:var(--superficie);
  border:1px solid var(--linha);border-radius:8px;padding:30px}
.form-caixa h2{font-family:Georgia,serif;font-weight:400;font-size:23px}
.form-caixa > p{color:var(--tinta-2);font-size:14px;margin:6px 0 20px}
.form-caixa label{display:block;font-size:11px;font-weight:700;letter-spacing:.08em;
  text-transform:uppercase;color:var(--tinta-3);margin:14px 0 5px}
.form-caixa label span{color:var(--marca);margin-left:3px}
.form-caixa input,.form-caixa textarea{width:100%;padding:11px 13px;font-size:15px;
  border:1px solid var(--linha);border-radius:5px;background:var(--fundo);
  color:var(--tinta);font-family:inherit}
.form-caixa input:focus,.form-caixa textarea:focus{outline:2px solid var(--marca);outline-offset:1px}
.form-dupla{display:grid;grid-template-columns:1fr 1fr;gap:14px}
.form-caixa .botao{margin-top:20px;border:none}
.form-aviso{font-size:13.5px;margin-top:12px;min-height:19px;color:var(--tinta-2)}
.form-aviso.erro{color:#A32E22}
.form-ok{font-size:16px;color:var(--marca);padding:26px 0;text-align:center}
@media(max-width:560px){.form-dupla{grid-template-columns:1fr}}

/* Trilha */
.trilha-site{display:flex;flex-wrap:wrap;align-items:center;gap:7px;font-size:12.5px;
  color:var(--tinta-3);padding:18px 0 4px}
.trilha-site a{color:var(--tinta-2);text-decoration:none}
.trilha-site a:hover{color:var(--marca)}
.trilha-site i{font-style:normal;opacity:.5}
.trilha-site span{color:var(--tinta);font-weight:600}

/* Palco: foto grande + tira de miniaturas ao lado */
.palco{display:grid;grid-template-columns:minmax(0,1fr) 96px;gap:10px}
.palco .ficha-capa{margin-bottom:0;cursor:zoom-in}
/* A coluna da tira estica até a altura da foto (comportamento padrão do grid),
   e a tira, absoluta dentro dela, rola por dentro. Sem isso a lista de 19
   miniaturas empurrava a página para baixo da foto. */
.palco-tira{position:relative}
.tira{position:absolute;inset:0;display:flex;flex-direction:column;gap:8px;
  overflow-y:auto;scrollbar-width:thin}
.tira-item{padding:0;border:1px solid var(--linha);background:none;cursor:pointer;
  border-radius:4px;overflow:hidden;aspect-ratio:4/3;position:relative;flex-shrink:0}
.tira-item img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.tira-item:hover,.tira-item:focus-visible{border-color:var(--marca);outline:none}

/* Lista de ícones da lateral */
.lateral-local{font-family:Georgia,serif;font-size:21px;margin-bottom:14px}
.lista-icones{list-style:none;display:flex;flex-direction:column;gap:9px;
  margin-bottom:18px;padding-bottom:16px;border-bottom:1px solid var(--linha)}
.lista-icones li{font-size:14px;color:var(--tinta-2);padding-left:26px;position:relative}
.lista-icones li::before{position:absolute;left:0;top:0;font-size:13px;opacity:.75}
.ic-dorm::before{content:"🛏"}
.ic-vaga::before{content:"🚗"}
.ic-banho::before{content:"🚿"}
.ic-util::before{content:"◱"}
.ic-total::before{content:"▦"}
.ic-ano::before{content:"📅"}

@media(max-width:820px){
  .palco{grid-template-columns:minmax(0,1fr)}
  .palco-tira{position:static;height:88px}
  .tira{position:static;flex-direction:row;overflow-x:auto;overflow-y:hidden}
  .tira-item{width:112px;flex-shrink:0}
}

/* Setas dentro da miniatura */
.cartao-seta{position:absolute;top:50%;transform:translateY(-50%);z-index:3;
  width:30px;height:46px;border:none;cursor:pointer;color:#fff;font-size:24px;line-height:1;
  background:rgba(36,28,20,.42);display:flex;align-items:center;justify-content:center;
  opacity:0;transition:opacity .15s,background .15s}
.cartao-ant{left:0;border-radius:0 4px 4px 0}
.cartao-prox{right:0;border-radius:4px 0 0 4px}
.cartao-foto:hover .cartao-seta,.cartao-seta:focus-visible{opacity:1}
.cartao-seta:hover{background:rgba(36,28,20,.74)}
.cartao-pontos{position:absolute;bottom:8px;left:50%;transform:translateX(-50%);z-index:3;
  display:flex;gap:5px}
.cartao-pontos i{width:5px;height:5px;border-radius:50%;background:rgba(255,255,255,.5)}
.cartao-pontos i.on{background:#fff}
@media(hover:none){.cartao-seta{opacity:.85}}

/* Vídeos e reels */
.secao-botao{background:rgba(255,255,255,.14);border:1px solid rgba(255,255,255,.28);
  color:#fff;text-decoration:none;font-size:12.5px;font-weight:600;padding:6px 14px;border-radius:4px}
.secao-botao:hover{background:rgba(255,255,255,.24)}
/* Carrossel: fila única, rola na horizontal só quando passa da largura —
   três vídeos cabem sem barra, o quarto em diante vira scroll. */
.video-grade{display:flex;gap:18px;margin-top:20px;overflow-x:auto;padding-bottom:6px;
  scroll-snap-type:x proximity}
.video-cartao{text-decoration:none;color:inherit;flex:0 0 300px;scroll-snap-align:start;
  background:none;border:none;padding:0;font:inherit;text-align:left;cursor:pointer;display:block}
.video-capa{position:relative;aspect-ratio:16/9;background:var(--superficie-2);
  border-radius:5px;overflow:hidden;border:1px solid var(--linha)}
button.video-capa{display:block;width:100%;padding:0;font:inherit;cursor:pointer}
.video-capa img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.video-capa iframe{position:absolute;inset:0;width:100%;height:100%;border:0}
.ficha-video{margin:28px 0}
.ficha-video h2{font-family:Georgia,serif;font-weight:400;font-size:19px;margin-bottom:12px}
.ficha-video .video-capa{aspect-ratio:16/9;border-radius:5px;overflow:hidden;border:1px solid var(--linha);
  max-width:640px;cursor:pointer}
.video-sem-capa{position:absolute;inset:0;background:var(--escuro)}
.video-play{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);
  width:52px;height:52px;border-radius:50%;background:rgba(36,28,20,.72);color:#fff;
  display:flex;align-items:center;justify-content:center;font-size:19px;padding-left:4px}
.video-cartao:hover .video-play,.reel-cartao:hover .video-play{background:var(--marca)}
.video-tit{margin-top:10px;font-size:14px;font-weight:600;line-height:1.4}
/* Mesmo carrossel dos vídeos: fila única, só rola quando não cabe. */
.reel-fita{display:flex;gap:14px;margin-top:20px;overflow-x:auto;padding-bottom:6px;
  scroll-snap-type:x proximity}

/* ── Favoritos, dentro do menu horizontal ────────────────────────── */
.nav-favoritos{display:inline-flex;align-items:center;gap:5px}
/* O contador só ganha cor quando há o que contar. Estrela acesa com zero
   dentro é promessa vazia. */
.nav-favoritos b{background:var(--superficie-2);border-radius:9px;padding:0 6px;font-size:11px;
  color:var(--tinta-2);font-weight:700}
.nav-favoritos.tem{color:var(--marca)}
.nav-favoritos.tem b{background:var(--marca);color:#fff}

/* ── Menu grande ─────────────────────────────────────────────────── */
.nav-mm{position:relative}
.nav-seta{font-size:11px;opacity:.6;margin-left:2px}
.mm-caixa{position:absolute;left:50%;transform:translateX(-50%);top:100%;
  margin-top:14px;width:min(94vw,var(--mm-larg,700px));background:var(--superficie);
  border:1px solid var(--linha);border-radius:4px;box-shadow:0 22px 60px rgba(0,0,0,.16);
  opacity:0;visibility:hidden;transition:opacity .16s,visibility .16s;z-index:60}
/* O espaço entre o link e a caixa engoliria o hover e o menu piscaria. Esta
   ponte invisível cobre a distância e mantém ele aberto na travessia. */
.mm-caixa::before{content:'';position:absolute;top:-18px;left:0;right:0;height:18px}
.nav-mm:hover .mm-caixa,.nav-mm:focus-within .mm-caixa{opacity:1;visibility:visible}
.nav-mm.direita .mm-caixa{left:auto;right:0;transform:none}
.mm-env{padding:26px 30px}
.mm-grade{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:26px}
.mm-col h4{font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--tinta-3);
  margin:0 0 12px;padding-bottom:9px;border-bottom:1px solid var(--linha);font-weight:700}
.mm-col a{display:flex;align-items:center;justify-content:space-between;gap:10px;
  padding:8px 0;color:var(--tinta-2);text-decoration:none;font-size:14.5px;
  border-bottom:1px solid rgba(0,0,0,.04)}
.mm-col-larga a{display:block}
.mm-col a:hover{color:var(--marca)}
.mm-col a b{font-size:11px;font-weight:600;color:var(--tinta-3);
  background:var(--superficie-2);border-radius:9px;padding:1px 7px;min-width:22px;text-align:center}
.mm-col a:hover b{background:var(--marca);color:#fff}
.mm-todos{font-weight:700;color:var(--marca)!important}
/* Lupa e busca por texto: quem chega sabendo o código ou a rua não quer
   preencher quatro seletores para achar o que já sabe que existe. */
.nav-lupa{background:none;border:0;cursor:pointer;font-size:22px;line-height:1;
  color:var(--tinta-2);padding:0 2px;font-family:inherit}
.nav-lupa:hover{color:var(--marca)}
.busca-texto{border-bottom:1px solid var(--linha);background:var(--superficie);
  max-height:0;overflow:hidden;transition:max-height .2s}
.busca-texto.aberta{max-height:90px}
.busca-texto .env{padding:14px 0}
.busca-texto input{width:100%;border:1px solid var(--linha);border-radius:3px;
  padding:12px 14px;font-size:15px;font-family:inherit;color:var(--tinta)}
.busca-texto input:focus{outline:none;border-color:var(--marca)}
/* Busca só de condomínios, dentro da própria queda: digitar filtra ali,
   sem precisar de página de resultado à parte. */
.mm-col-busca{display:flex;flex-direction:column}
.mm-busca-campo{border:1px solid var(--linha);border-radius:3px;padding:9px 11px;
  font-size:13.5px;font-family:inherit;color:var(--tinta);margin-bottom:8px}
.mm-busca-campo:focus{outline:none;border-color:var(--marca)}
.mm-busca-resultado{display:flex;flex-direction:column;max-height:180px;overflow-y:auto}
.mm-busca-resultado a{padding:6px 0;color:var(--tinta-2);text-decoration:none;font-size:13.5px}
.mm-busca-resultado a:hover{color:var(--marca)}
.mm-busca-vazio{font-size:12.5px;color:var(--tinta-3);margin:4px 0 0}
@media(max-width:980px){.mm-caixa{display:none}}

/* ── Favoritos ───────────────────────────────────────────────────── */
.cartao-caixa{position:relative}
.cartao-fav{position:absolute;top:12px;right:12px;z-index:3;width:36px;height:36px;
  display:flex;align-items:center;justify-content:center;cursor:pointer;
  border:0;border-radius:50%;background:rgba(255,255,255,.9);color:var(--tinta-3);
  font-size:17px;line-height:1;backdrop-filter:blur(4px);
  transition:transform .14s,color .14s,background .14s}
.cartao-fav:hover{transform:scale(1.1);color:#c0392b}
.cartao-fav.on{color:#c0392b;background:#fff}
.fav-vazio{text-align:center;padding:56px 20px;color:var(--tinta-2)}
.fav-vazio p:first-child{font-size:42px;color:var(--linha);margin:0 0 10px}
.fav-vazio h3{font-family:Georgia,serif;font-weight:400;font-size:22px;margin:0 0 8px;color:var(--tinta)}
.fav-acoes{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:22px}
.btn-site{display:inline-block;background:var(--marca);color:#fff;text-decoration:none;
  border:1px solid var(--marca);padding:11px 22px;border-radius:3px;font-size:13.5px;
  font-weight:600;cursor:pointer;font-family:inherit}
.btn-site:hover{filter:brightness(1.08)}
.btn-site-vazado{background:transparent;color:var(--tinta-2);border-color:var(--linha)}
.btn-limpar{margin-left:auto;background:none;border:1px solid rgba(255,255,255,.3);
  color:#fff;padding:5px 13px;border-radius:3px;font-size:12px;cursor:pointer;
  font-family:inherit;font-weight:600}
.btn-limpar:hover{background:rgba(255,255,255,.12)}

/* ── Buscas populares ────────────────────────────────────────────── */
.buscas-pop-barra{background:var(--escuro);padding:14px 24px;border-radius:3px 3px 0 0}
.buscas-pop-barra h2{color:#fff;font-family:inherit;font-size:15px;font-weight:700;
  letter-spacing:.02em;margin:0}
.buscas-pop-grade{border:1px solid var(--linha);border-top:0;
  columns:2;column-gap:0;padding:6px 24px}
@media(max-width:760px){.buscas-pop-grade{columns:1}}
.buscas-pop-grade a{display:flex;align-items:center;gap:8px;padding:9px 0;
  color:var(--tinta-2);text-decoration:none;font-size:13.5px;
  border-bottom:1px solid rgba(0,0,0,.05);break-inside:avoid}
.buscas-pop-grade a:hover{color:var(--marca)}
.buscas-pop-grade a span{color:var(--tinta-3);font-size:11px}
.buscas-pop-grade a b{margin-left:auto;font-size:11px;font-weight:600;color:var(--tinta-3);
  background:var(--superficie-2);border-radius:9px;padding:1px 8px}

/* ── Três atalhos de saída ───────────────────────────────────────── */
.atalhos-grade{display:grid;grid-template-columns:repeat(3,1fr);gap:1px;
  background:var(--linha);border:1px solid var(--linha)}
@media(max-width:760px){.atalhos-grade{grid-template-columns:1fr}}
.atalho{display:flex;flex-direction:column;justify-content:center;gap:5px;
  background:var(--escuro);color:#fff;text-decoration:none;padding:22px 26px;
  min-height:78px;transition:background .15s}
.atalho:hover{background:#000}
.atalho strong{font-size:14.5px;font-weight:700}
.atalho span{font-size:12.5px;color:rgba(255,255,255,.65)}

.btn-site-vazado:hover{filter:none;border-color:var(--tinta-3);color:var(--tinta)}

.reel-cartao{text-decoration:none;color:inherit;flex:0 0 200px;scroll-snap-align:start}
.reel-capa{position:relative;aspect-ratio:9/16;background:var(--escuro);border-radius:6px;
  overflow:hidden;display:flex;align-items:center;justify-content:center}
.reel-capa img,.reel-video{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.reel-som{position:absolute;bottom:8px;right:8px;z-index:2;width:30px;height:30px;
  border-radius:50%;border:none;cursor:pointer;background:rgba(20,15,10,.6);
  color:#fff;font-size:13px;display:flex;align-items:center;justify-content:center}
.reel-som:hover{background:rgba(20,15,10,.85)}
.reel-link{display:block;margin-top:7px;font-size:12px;color:var(--tinta-3);text-decoration:none}
.reel-link:hover{color:var(--marca)}
.reel-marca{color:var(--marca-clara);font-family:Georgia,serif;font-size:19px;letter-spacing:.1em}
.reel-tit{margin-top:9px;font-size:13.5px;font-weight:600;line-height:1.4}
@media(max-width:640px){.video-cartao{flex-basis:240px}.reel-cartao{flex-basis:160px}}

/* Visualizador de fotos */
.galeria-item{padding:0;border:none;background:none;cursor:zoom-in;display:block;width:100%}
.galeria-item:focus-visible{outline:2px solid var(--marca);outline-offset:2px;border-radius:4px}
.visor{position:fixed;inset:0;z-index:200;background:rgba(20,15,10,.94);
  display:flex;align-items:center;justify-content:center;padding:20px}
.visor[hidden]{display:none}
.visor-palco{max-width:min(1200px,94vw);max-height:88vh;margin:0}
.visor-palco img{max-width:100%;max-height:88vh;width:auto;height:auto;
  border-radius:4px;object-fit:contain}
.visor-fechar,.visor-seta{position:absolute;background:rgba(255,255,255,.12);
  border:1px solid rgba(255,255,255,.25);color:#fff;cursor:pointer;border-radius:50%;
  display:flex;align-items:center;justify-content:center;font-size:20px;line-height:1}
.visor-fechar{top:18px;right:18px;width:42px;height:42px;font-size:16px}
.visor-seta{top:50%;transform:translateY(-50%);width:48px;height:48px;font-size:26px}
.visor-ant{left:16px}.visor-prox{right:16px}
.visor-fechar:hover,.visor-seta:hover{background:rgba(255,255,255,.24)}
.visor-fechar:focus-visible,.visor-seta:focus-visible{outline:2px solid #fff;outline-offset:2px}
.visor-conta{position:absolute;bottom:20px;left:50%;transform:translateX(-50%);
  color:rgba(255,255,255,.85);font-size:13px;font-variant-numeric:tabular-nums;
  background:rgba(0,0,0,.4);padding:5px 14px;border-radius:20px}
@media(max-width:640px){.visor-seta{width:40px;height:40px;font-size:22px}
  .visor-ant{left:6px}.visor-prox{right:6px}}

/* Blog */
.pagina-topo{padding:44px 0 8px}
.pagina-topo h1{font-family:Georgia,serif;font-weight:400;font-size:clamp(28px,4vw,40px)}
.pagina-topo p{color:var(--tinta-2);margin-top:8px}
.post-cartao .cartao-corpo{gap:6px}
.post-capa{position:relative;aspect-ratio:16/9;background:var(--superficie-2);overflow:hidden}
.post-capa img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.post-titulo{font-family:Georgia,serif;font-weight:400;font-size:18px;line-height:1.3}
.post-resumo{font-size:13.5px;color:var(--tinta-2);line-height:1.55}
.artigo{max-width:720px;margin:0 auto;padding:44px 0 24px}
.artigo-data{font-size:12px;letter-spacing:.1em;text-transform:uppercase;color:var(--marca);margin-bottom:12px}
.artigo h1{font-family:Georgia,serif;font-weight:400;font-size:clamp(27px,4.2vw,40px);line-height:1.18;text-wrap:balance}
.artigo-resumo{font-size:18.5px;color:var(--tinta-2);margin-top:16px;line-height:1.55}
.artigo-capa{position:relative;margin:28px 0;border-radius:6px;overflow:hidden;aspect-ratio:2/1;background:var(--superficie-2)}
.artigo-capa img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.artigo-corpo{margin-top:28px;font-size:17px;line-height:1.75}
.artigo-corpo p{margin-bottom:20px}
.artigo-chamada{background:var(--superficie-2);border-radius:6px;padding:24px;margin:36px 0 20px;text-align:center}
.artigo-chamada p{font-size:16px;margin-bottom:4px}
.artigo-chamada .botao{max-width:300px;margin:12px auto 0}
.artigo-assina{font-size:12.5px;color:var(--tinta-3);border-top:1px solid var(--linha);padding-top:18px}

@media(max-width:820px){
  .ficha{grid-template-columns:minmax(0,1fr)}
  .lateral{position:static}
  .nav{display:none}
  .capa .env{padding-top:56px;padding-bottom:88px}
}
"""


# ── Catálogo do menu ───────────────────────────────────────────────────
# O menu grande sai do que EXISTE na carteira, não de uma lista escrita à mão.
# Categoria vazia não aparece, então o menu encolhe e cresce sozinho conforme
# ele cadastra. Menu com "Coberturas (0)" é pior que menu sem coberturas.
MENU = {}
POSTS = []
EMPREENDIMENTOS = []
CORRETORES = []

# Contagem ao lado de cada categoria. Vale a pena quando os números impressionam
# e atrapalha quando denunciam carteira pequena. Uma linha para desligar.
MOSTRAR_CONTAGEM = True


def montar_menu(imoveis):
    def contar(chave, filtro=None):
        c = {}
        for i in imoveis:
            if filtro and not filtro(i):
                continue
            v = i.get(chave)
            if v:
                c[v] = c.get(v, 0) + 1
        return sorted(c.items(), key=lambda x: (-x[1], x[0]))

    venda   = lambda i: (i.get("finalidade") or "venda") != "aluguel"
    aluguel = lambda i: (i.get("finalidade") or "") == "aluguel"

    dorms = []
    for n in (1, 2, 3, 4):
        # "3 ou mais" e não "exatamente 3": é assim que a pessoa procura, e
        # evita a faixa de 4 dormitórios aparecer vazia por falta de um item.
        q = sum(1 for i in imoveis if (i.get("dormitorios") or 0) >= n)
        if q:
            rot = f"{n} ou mais"
            dorms.append((rot, q, str(n)))

    def dorms_de(filtro):
        saida = []
        for n in (1, 2, 3, 4):
            q = sum(1 for i in imoveis if filtro(i) and (i.get("dormitorios") or 0) >= n)
            if q:
                saida.append((f"{n} ou mais", q, str(n)))
        return saida

    MENU.clear()
    MENU.update({
        "venda":   contar("_tipo", venda),
        "aluguel": contar("_tipo", aluguel),
        "bairro":  contar("_bairro"),
        "bairro_venda":   contar("_bairro", venda),
        "bairro_aluguel": contar("_bairro", aluguel),
        "dorm":       dorms,
        "dorm_venda": dorms_de(venda),
        "total_venda":   sum(1 for i in imoveis if venda(i)),
        "total_aluguel": sum(1 for i in imoveis if aluguel(i)),
    })


def _conta(n):
    return f'<b>{n}</b>' if MOSTRAR_CONTAGEM else ""


def _coluna(titulo, itens, param, raiz, extra=""):
    """Uma coluna do menu. `extra` fixa a finalidade, para o link de Vendas
    nunca trazer imóvel de aluguel junto."""
    if not itens:
        return ""
    linhas = []
    for item in itens:
        rot, n = item[0], item[1]
        valor = item[2] if len(item) > 2 else rot
        alvo = raiz + "/?" + extra + param + "=" + urllib.parse.quote(str(valor)) + "#imoveis"
        linhas.append(f'<a href="{e(alvo)}">{e(rot)} {_conta(n)}</a>')
    return f'<div class="mm-col"><h4>{e(titulo)}</h4>{"".join(linhas)}</div>'


def _coluna_condominios(raiz):
    """Até 6 favoritos escolhidos por ele, mais um campo de busca pros
    demais — nome e slug de TODOS os empreendimentos ativos entram embutidos
    como JSON, e o filtro roda no navegador. Site estático não tem como
    buscar no banco a cada letra digitada, então a lista inteira já vai
    junto; são dezenas de linhas, não milhares."""
    favoritos = sorted((c for c in EMPREENDIMENTOS if c.get("favorito") and c.get("slug")),
                        key=lambda c: (c.get("ordem_favorito") or 0, c["nome"]))[:6]
    col_favoritos = ""
    if favoritos:
        links = "".join(f'<a href="{e(raiz)}/condominio/{e(c["slug"])}/">{e(c["nome"])}</a>'
                        for c in favoritos)
        col_favoritos = f'<div class="mm-col"><h4>Em destaque</h4>{links}</div>'

    todos = [{"nome": c["nome"], "slug": c["slug"]} for c in EMPREENDIMENTOS if c.get("slug")]
    if not todos:
        return [col_favoritos] if col_favoritos else []

    busca_html = f"""<div class="mm-col mm-col-busca">
      <h4>Buscar</h4>
      <input type="search" class="mm-busca-campo" id="buscaCondominios"
             placeholder="Nome do condomínio…" autocomplete="off">
      <div class="mm-busca-resultado" id="resultadoCondominios"></div>
    </div>
    <script>
    (function () {{
      var RAIZ_COND = {json.dumps(raiz)}, LISTA = {json.dumps(todos)};
      var campo = document.getElementById('buscaCondominios'),
          alvo = document.getElementById('resultadoCondominios');
      if (!campo) return;
      campo.addEventListener('input', function () {{
        var q = campo.value.trim().toLowerCase();
        alvo.innerHTML = '';
        if (!q) return;
        var achados = LISTA.filter(function (c) {{
          return c.nome.toLowerCase().indexOf(q) !== -1;
        }}).slice(0, 8);
        if (!achados.length) {{
          var p = document.createElement('p');
          p.className = 'mm-busca-vazio'; p.textContent = 'Nenhum encontrado.';
          alvo.appendChild(p);
          return;
        }}
        achados.forEach(function (c) {{
          var a = document.createElement('a');
          a.href = RAIZ_COND + '/condominio/' + c.slug + '/';
          a.textContent = c.nome;
          alvo.appendChild(a);
        }});
      }});
    }})();
    </script>"""
    return [col_favoritos, busca_html] if col_favoritos else [busca_html]


def _queda(rotulo, href, colunas, raiz, direita=False, largura=None):
    """Um item do topo com a sua queda. Sem colunas, vira link simples."""
    corpo = "".join(colunas)
    seta = '<span class="nav-seta" aria-hidden="true">⌄</span>' if corpo else ""
    if not corpo:
        return f'<a class="nav-item" href="{e(href)}">{e(rotulo)}</a>'
    est = f' style="--mm-larg:{largura}px"' if largura else ""
    return (f'<div class="nav-mm{" direita" if direita else ""}">'
            f'<a class="nav-item nav-mm-alvo" href="{e(href)}">{e(rotulo)}{seta}</a>'
            f'<div class="mm-caixa"{est}><div class="mm-env"><div class="mm-grade">'
            + corpo + '</div></div></div></div>')


def menus_html(cfg, raiz):
    """A barra inteira: Vendas, Aluguel, Blog e Contato, cada um com a sua
    queda. Antes era um menu só chamado Imóveis, e ele pediu separado, que é
    também como o mercado faz: quem quer alugar não deveria passar por dentro
    de um menu de venda para chegar lá."""
    itens = []

    venda = [
        _coluna("Tipo de imóvel", MENU.get("venda", []), "tipo", raiz, "fin=venda&"),
        _coluna("Por bairro", MENU.get("bairro_venda", []), "bairro", raiz, "fin=venda&"),
        _coluna("Por dormitórios", MENU.get("dorm_venda", []), "dorm", raiz, "fin=venda&"),
    ]
    if any(venda):
        itens.append(_queda("Vendas", raiz + "/?fin=venda#imoveis", venda, raiz, largura=700))

    aluguel = [
        _coluna("Tipo de imóvel", MENU.get("aluguel", []), "tipo", raiz, "fin=aluguel&"),
        _coluna("Por bairro", MENU.get("bairro_aluguel", []), "bairro", raiz, "fin=aluguel&"),
    ]
    if any(aluguel):
        itens.append(_queda("Aluguel", raiz + "/?fin=aluguel#imoveis", aluguel, raiz, largura=470))

    if EMPREENDIMENTOS:
        itens.append(_queda("Condomínios", raiz + "/#destaques", _coluna_condominios(raiz), raiz, largura=460))

    itens.append(_queda("Destaques", raiz + "/#destaques", [], raiz))

    # Blog com os artigos recentes na queda, como no site que ele mostrou.
    if POSTS:
        links = "".join(
            f'<a href="{e(raiz)}/blog/{e(x["slug"])}/">{e(x.get("titulo") or "Artigo")}</a>'
            for x in POSTS[:4])
        col = f'<div class="mm-col mm-col-larga"><h4>Últimos artigos</h4>{links}</div>'
        itens.append(_queda("Blog", raiz + "/blog/", [col], raiz, direita=True, largura=340))
    else:
        itens.append(_queda("Blog", raiz + "/blog/", [], raiz))

    # Contato: o que a pessoa procura quando clica em contato é como falar.
    link_zap = zap(cfg)
    contato = []
    if link_zap:
        contato.append(f'<a href="{e(link_zap)}" target="_blank" rel="noopener">Falar no WhatsApp</a>')
    if cfg.get("email_contato"):
        contato.append(f'<a href="mailto:{e(cfg["email_contato"])}">{e(cfg["email_contato"])}</a>')
    if cfg.get("endereco"):
        contato.append(f'<a href="{e(raiz)}/#contato">{e(cfg["endereco"])}</a>')
    if contato:
        col = '<div class="mm-col mm-col-larga"><h4>Fale com o corretor</h4>' + "".join(contato) + '</div>'
        itens.append(_queda("Contato", raiz + "/#contato", [col], raiz, direita=True, largura=330))

    # Favoritos morava na tarja escura de cima, que saiu — o menu horizontal
    # branco é o único lugar de navegação que sobrou.
    favoritos = (f'<a class="nav-item nav-favoritos" href="{raiz}/favoritos.html">'
                 f'<span aria-hidden="true">★</span> Favoritos <b id="favConta">0</b></a>')
    itens.append(favoritos)

    # A lupa abre uma caixa de busca por texto. É o jeito de quem chega
    # sabendo o que quer, por código ou por rua, em vez de filtrar por partes.
    busca = ('<button type="button" class="nav-lupa" id="btnBusca" '
             'aria-label="Buscar imóvel" title="Buscar imóvel">⌕</button>')

    return '<nav class="nav">' + "".join(itens) + busca + '</nav>'


def bloco_medicao(cfg):
    """Pixel do Meta, GA4, GTM e verificação do Search Console.

    Virou função porque as landing pages passaram a usar o mesmo bloco. Antes
    cada LP era um site solto, sem pixel nenhum, então quem visitava uma delas
    não virava público para anúncio. Com todas sob o mesmo domínio e o mesmo
    pixel, visita de LP e visita de site são a mesma audiência.
    """
    medicao = ""
    if cfg.get("search_console"):
        medicao += f'<meta name="google-site-verification" content="{e(cfg["search_console"])}">'
    if cfg.get("ga4_id"):
        g = e(cfg["ga4_id"])
        medicao += ('<script async src="https://www.googletagmanager.com/gtag/js?id=' + g + '"></script>'
                    '<script>window.dataLayer=window.dataLayer||[];'
                    'function gtag(){dataLayer.push(arguments)}gtag("js",new Date());'
                    'gtag("config","' + g + '")</script>')
    if cfg.get("gtm_id"):
        t = e(cfg["gtm_id"])
        medicao += ('<script>(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({"gtm.start":'
                    'new Date().getTime(),event:"gtm.js"});var f=d.getElementsByTagName(s)[0],'
                    'j=d.createElement(s);j.async=true;j.src='
                    '"https://www.googletagmanager.com/gtm.js?id="+i;f.parentNode.insertBefore(j,f);'
                    '})(window,document,"script","dataLayer","' + t + '");</script>')
    if cfg.get("meta_pixel"):
        px = e(cfg["meta_pixel"])
        medicao += ('<script>!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){'
                    'n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};'
                    'if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version="2.0";n.queue=[];'
                    't=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];'
                    's.parentNode.insertBefore(t,s)}(window,document,"script",'
                    '"https://connect.facebook.net/en_US/fbevents.js");'
                    'fbq("init","' + px + '");fbq("track","PageView");</script>')
    return medicao


def copiar_lps(cfg, base):
    """Traz as landing pages para dentro do site, sob o mesmo domínio.

    Antes cada LP era uma ilha num endereço do GitHub. Trazendo para
    maysimoveis.com/lp/<nome>/ três coisas mudam: o link que ele manda no
    WhatsApp carrega a marca dele, a visita conta para a autoridade de um
    domínio só, e o pixel passa a ser o mesmo do site, o que transforma quem
    viu a LP em público para anúncio.

    Os arquivos das LPs continuam morando onde sempre moraram. Aqui eles são
    apenas copiados a cada geração, então editar a LP segue sendo editar a
    pasta dela.
    """
    origem = AQUI.parent.parent / "lp"
    if not origem.is_dir():
        return []

    medicao = bloco_medicao(cfg)
    publicadas = []

    for pasta in sorted(x for x in origem.iterdir() if x.is_dir()):
        dentro = pasta / "lp"
        if not (dentro / "index.html").exists():
            continue
        destino = SAIDA / "lp" / pasta.name
        destino.mkdir(parents=True, exist_ok=True)

        for arq in dentro.rglob("*"):
            # O .git da LP não pode entrar: repositório dentro de repositório
            # faz o Git tratar a pasta como submódulo e não sobe arquivo nenhum.
            if ".git" in arq.parts or arq.is_dir():
                continue
            alvo = destino / arq.relative_to(dentro)
            alvo.parent.mkdir(parents=True, exist_ok=True)
            if alvo.exists() and alvo.stat().st_size == arq.stat().st_size \
                    and alvo.stat().st_mtime >= arq.stat().st_mtime:
                continue
            alvo.write_bytes(arq.read_bytes())

        # Medição e canônico entram na cópia, nunca no original: assim o
        # arquivo que ele edita continua limpo, e trocar o pixel é trocar um
        # campo na configuração e gerar de novo.
        pagina = destino / "index.html"
        html = pagina.read_text(encoding="utf-8", errors="ignore")
        url = base.rstrip("/") + "/lp/" + pasta.name + "/"
        # A LP original também recebe um canônico apontando para cá, para o
        # Google saber qual endereço vale. Tirar o que já existe evita a página
        # sair com dois, que é pior que nenhum: o Google ignora os dois.
        html = re.sub(r'<link[^>]+rel="canonical"[^>]*>', "", html, flags=re.I)
        extra = f'<link rel="canonical" href="{e(url)}">' + medicao
        if "</head>" in html:
            html = html.replace("</head>", extra + "</head>", 1)
        else:
            html = extra + html
        pagina.write_text(html, encoding="utf-8")
        publicadas.append((pasta.name, url))

    return publicadas


# ── Blocos de HTML ─────────────────────────────────────────────────────
def cabeca_html(cfg, titulo, descricao, canonica, imagem=None, jsonld=None, raiz="."):
    og_img = f'<meta property="og:image" content="{e(imagem)}">' if imagem else ""
    ld = f'<script type="application/ld+json">{json.dumps(jsonld, ensure_ascii=False)}</script>' if jsonld else ""

    # Ferramentas de medição. Cada uma é uma requisição a domínio externo e só
    # sai se ele preencheu o campo: o padrão é o site não pedir nada pra fora.
    medicao = bloco_medicao(cfg)

    menu_grande = menus_html(cfg, raiz)
    # A caixa da lupa fica fora da f-string: chave de JavaScript dentro de
    # f-string é lida como campo a substituir, e o arquivo nem compila.
    busca_bloco = (
        '<script>const RAIZ_SITE = ' + json.dumps(raiz) + ';</script>'
        '<div class="busca-texto" id="buscaTexto"><div class="env">'
        '<input type="search" id="qTexto" aria-label="Buscar imóvel" '
        'placeholder="Buscar por código, rua, bairro ou título"></div></div>'
        '<script>'
        '(function () {'
        '  var b = document.getElementById("btnBusca"),'
        '      cx = document.getElementById("buscaTexto"),'
        '      campo = document.getElementById("qTexto");'
        '  if (!b) return;'
        '  b.addEventListener("click", function () {'
        '    cx.classList.toggle("aberta");'
        '    if (cx.classList.contains("aberta")) campo.focus();'
        '  });'
        '  campo.addEventListener("keydown", function (ev) {'
        '    if (ev.key !== "Enter") return;'
        '    var q = campo.value.trim();'
        '    if (!q) return;'
        # Na home o filtro é imediato; fora dela, manda para a home já buscando,
        # senão a lupa viraria um botão que não faz nada nas páginas internas.
        '    if (typeof window.buscarTexto === "function") window.buscarTexto(q);'
        '    else location.href = RAIZ_SITE + "/?q=" + encodeURIComponent(q) + "#imoveis";'
        '  });'
        '})();'
        '</script>')
    return f"""<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>{e(titulo)}</title>
<meta name="description" content="{e(descricao)}">
<link rel="canonical" href="{e(canonica)}">
<meta property="og:type" content="website">
<meta property="og:title" content="{e(titulo)}">
<meta property="og:description" content="{e(descricao)}">
<meta property="og:url" content="{e(canonica)}">
{og_img}
<meta name="twitter:card" content="summary_large_image">
<link rel="stylesheet" href="{raiz}/estilo.css">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='6' fill='%23241C14'/%3E%3Ctext x='16' y='22' font-family='Georgia,serif' font-size='15' font-weight='700' fill='%239B7B5A' text-anchor='middle'%3EM%3C/text%3E%3C/svg%3E">
{ld}
{medicao}
</head>
<body>
<header class="cabeca"><div class="env">
  <a class="marca" href="{raiz}/">
    <img src="{raiz}/logo.png" alt="{e(cfg.get('nome_imobiliaria') or 'Maysonnave Imóveis')}" class="marca-logo" width="140" height="74">
  </a>
  {menu_grande}
</div></header>
{busca_bloco}
"""


def rodape_html(cfg, raiz="."):
    ano = datetime.now().year
    link_zap = zap(cfg)
    email = cfg.get("email_contato")
    zap_pe = f'<a href="{e(link_zap)}" target="_blank" rel="noopener">Falar no WhatsApp</a><br>' if link_zap else ""
    itens_rede = "".join(
        f'<a class="rodape-rede" href="{e(cfg[k])}" target="_blank" rel="noopener" title="{r}" aria-label="{r}">{ico}</a>'
        for k, r, ico in (("instagram", "Instagram", ICONE_INSTAGRAM),
                          ("youtube", "YouTube", ICONE_YOUTUBE),
                          ("facebook", "Facebook", ICONE_FACEBOOK))
        if cfg.get(k))
    redes_pe = f'<div><strong>Redes</strong><div class="rodape-redes">{itens_rede}</div></div>' if itens_rede else ""
    email_pe = f'<a href="mailto:{e(email)}">{e(email)}</a>' if email else ""
    # Endereço físico no rodapé: além de o cliente precisar dele, é o sinal que
    # o Google usa para entender que existe um negócio de verdade num lugar de
    # verdade. Sai da configuração, não do código.
    endereco_pe = (e(cfg["endereco"]) + "<br>") if cfg.get("endereco") else ""
    return f"""
<footer class="rodape"><div class="env">
  <div>
    <strong>{e(cfg.get('nome_imobiliaria') or 'Maysonnave Imóveis')}</strong>
    {e(cfg.get('creci') or '')}<br>{endereco_pe}Pelotas, Rio Grande do Sul
  </div>
  <div id="contato">
    <strong>Contato</strong>
    {zap_pe}
    {email_pe}
  </div>
  <div>
    <strong>Atuação</strong>
    Compra, venda e avaliação de imóveis<br>
    Comercial, residencial e rural
  </div>
  {redes_pe}
</div>
<div class="rodape-fim env">© {ano} {e(cfg.get('nome_imobiliaria') or 'Maysonnave Imóveis')} · {e(cfg.get('creci') or '')}</div>
</footer>
{script_favoritos()}
{script_video_embutido()}
</body></html>"""


def script_video_embutido():
    """Clique no vídeo — do YouTube ou da home — troca a capa por um
    iframe e toca ali mesmo, sem sair do site. `youtube-nocookie` não
    planta cookie de rastreio antes do play."""
    return """
<script>
document.addEventListener('click', function (ev) {
  var b = ev.target.closest('[data-youtube]');
  if (!b) return;
  var id = b.dataset.youtube;
  if (!id) return;
  var capa = b.querySelector('.video-capa') || b.closest('.video-capa');
  if (!capa) return;
  capa.innerHTML = '<iframe src="https://www.youtube-nocookie.com/embed/' + id +
    '?autoplay=1&rel=0" title="Vídeo" allow="autoplay; encrypted-media; picture-in-picture" ' +
    'allowfullscreen></iframe>';
});
</script>"""


def script_favoritos():
    """Favoritos sem cadastro e sem servidor.

    A lista mora no próprio navegador da pessoa. Pedir login para guardar um
    imóvel espantaria a maioria, e um site estático não tem onde gravar de
    qualquer forma. O preço é a lista não acompanhar quem troca de aparelho,
    e é por isso que existe o botão de mandar tudo no WhatsApp: é ali que a
    lista vira algo que o corretor enxerga.
    """
    return """
<script>
(function () {
  var CHAVE = 'mays_favoritos';
  function ler() {
    try { var v = JSON.parse(localStorage.getItem(CHAVE) || '[]'); return Array.isArray(v) ? v : []; }
    catch (e) { return []; }
  }
  function gravar(v) {
    try { localStorage.setItem(CHAVE, JSON.stringify(v)); } catch (e) {}
  }
  function pintar() {
    var favs = ler();
    var conta = document.getElementById('favConta');
    if (conta) conta.textContent = favs.length;
    var topo = document.querySelector('.nav-favoritos');
    if (topo) topo.classList.toggle('tem', favs.length > 0);
    document.querySelectorAll('[data-fav]').forEach(function (b) {
      var on = favs.indexOf(b.dataset.fav) >= 0;
      b.classList.toggle('on', on);
      b.title = on ? 'Tirar dos favoritos' : 'Guardar nos favoritos';
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    document.dispatchEvent(new CustomEvent('favoritos', { detail: favs }));
  }
  document.addEventListener('click', function (ev) {
    var b = ev.target.closest('[data-fav]');
    if (!b) return;
    // O coração costuma ficar sobre o cartão, que é um link inteiro.
    ev.preventDefault(); ev.stopPropagation();
    var favs = ler(), i = favs.indexOf(b.dataset.fav);
    if (i >= 0) favs.splice(i, 1); else favs.push(b.dataset.fav);
    gravar(favs); pintar();
  });
  // Duas abas abertas: favoritar numa atualiza a outra sem recarregar.
  window.addEventListener('storage', function (ev) { if (ev.key === CHAVE) pintar(); });
  document.addEventListener('DOMContentLoaded', pintar);
  window.MaysFavoritos = { ler: ler, pintar: pintar };
})();
</script>"""


def cartao_html(im, raiz="."):
    itens = []
    if im.get("dormitorios"): itens.append(f"<span><b>{im['dormitorios']}</b> dorm</span>")
    if im.get("suites"):      itens.append(f"<span><b>{im['suites']}</b> suíte{'s' if im['suites']>1 else ''}</span>")
    if im.get("banheiros"):   itens.append(f"<span><b>{im['banheiros']}</b> banh</span>")
    if im.get("vagas"):       itens.append(f"<span><b>{im['vagas']}</b> vaga{'s' if im['vagas']>1 else ''}</span>")
    if im.get("area_util"):   itens.append(f"<span><b>{medida(im['area_util'])}</b></span>")
    elif im.get("area_total"): itens.append(f"<span><b>{medida(im['area_total'])}</b> terreno</span>")

    foto = cam(raiz, im.get("_capa_thumb") or im.get("_capa"))
    # A grade usa a WebP de 480px. Antes usava a miniatura JPEG, e vinte
    # cartões somavam quase o dobro do peso na home.
    # Carrossel dentro da moldura: dá pra ver várias fotos sem sair da
    # grade. Só a primeira entra como <img>; as outras ficam num data e são
    # trocadas no clique, senão vinte cartões baixariam cem imagens de uma
    # vez só para o caso de alguém querer olhar.
    img_html = ""
    if foto:
        cset = [(cam(raiz, c), w) for c, w in (im.get("_capa_set") or [])]
        primeira = cset[0][0] if cset else foto
        outras = [cam(raiz, m) for m in (im.get("_miniaturas") or [])[1:6]]
        dados = (' data-fotos="' + e("|".join(outras)) + '"') if outras else ""
        setas = ""
        if outras:
            setas = ('<button type="button" class="cartao-seta cartao-ant" aria-label="Foto anterior">&#8249;</button>' + '<button type="button" class="cartao-seta cartao-prox" aria-label="Próxima foto">&#8250;</button>' +
                     '<span class="cartao-pontos" aria-hidden="true">' +
                     "".join('<i></i>' for _ in range(len(outras) + 1)) + '</span>')
        img_html = ('<img src="' + e(primeira) + '"' + dados + ' alt="' +
                    e(im.get("titulo") or "Imóvel") +
                    '" loading="lazy" width="480" height="320">' + setas)
    selo_html = ('<span class="cartao-selo">' + e(im["selo"]) + '</span>') if im.get("selo") else ""
    if im.get("finalidade") == "aluguel":
        selo_html += '<span class="cartao-fin-selo">Aluguel</span>'
    itens_html = ('<div class="cartao-itens">' + "".join(itens) + '</div>') if itens else ""
    local = e(im.get("_bairro") or "")
    if im.get("_cidade"):
        local += " · " + e(im["_cidade"])
    # Guarda o essencial do imóvel no próprio botão: a página de favoritos é
    # estática e não tem banco para consultar, então o cartão viaja junto.
    fav = ('<button type="button" class="cartao-fav" data-fav="' + e(im["slug"]) + '"'
           + ' data-cod="' + e(im.get("codigo") or "") + '"'
           + ' title="Guardar nos favoritos" aria-label="Guardar nos favoritos">'
           + '<span aria-hidden="true">♥</span></button>')

    return f"""
    <div class="cartao-caixa">
    {fav}
    <a class="cartao" href="{raiz}/imovel/{e(im['slug'])}/">
      <div class="cartao-foto">
        {img_html}
        {selo_html}
      </div>
      <div class="cartao-corpo">
        <div class="cartao-local">{local}</div>
        <div class="cartao-titulo">
          <h3>{e(im.get('titulo') or im.get('_tipo') or 'Imóvel')}</h3>
          <span class="cartao-ref">{e(im.get('codigo') or '')}</span>
        </div>
        {itens_html}
        <div class="cartao-preco">{brl(im.get('valor'), im.get('finalidade'))}</div>
      </div>
    </a>
    </div>"""


# ── Páginas ────────────────────────────────────────────────────────────
def pagina_favoritos(cfg, imoveis, base):
    """A página traz TODOS os cartões escondidos e mostra só os favoritados.

    Parece desperdício, mas é o que permite a página existir num site estático:
    não há servidor para perguntar quais imóveis a pessoa guardou. E o custo é
    baixo porque as fotos são preguiçosas: cartão escondido não baixa imagem.
    """
    cartoes = "".join(cartao_html(i, raiz=".") for i in imoveis)
    link_zap = zap(cfg)
    numero = "".join(ch for ch in (cfg.get("whatsapp") or "") if ch.isdigit())
    site = (cfg.get("site_url") or "").rstrip("/")

    corpo = f"""
<div class="env">
  <section class="secao">
    <div class="secao-barra"><h2>Meus favoritos</h2>
      <span id="favResumo">nenhum imóvel guardado</span></div>

    <div class="fav-vazio" id="favVazio">
      <p><span aria-hidden="true">♥</span></p>
      <h3>Você ainda não guardou nenhum imóvel</h3>
      <p>Clique no coração de qualquer imóvel para guardá-lo aqui. A lista fica
         neste navegador, sem cadastro.</p>
      <a class="btn-site" href="./#imoveis">Ver os imóveis</a>
    </div>

    <div class="fav-acoes" id="favAcoes" hidden>
      <a class="btn-site" id="favEnviar" href="#" target="_blank" rel="noopener">
        Enviar minha lista no WhatsApp</a>
      <button type="button" class="btn-site btn-site-vazado" id="favLimpar">Limpar a lista</button>
    </div>

    <div class="grade" id="favGrade">{cartoes}</div>
  </section>
</div>

<script>
(function () {{
  var numero = {json.dumps(numero)};
  var site = {json.dumps(site)};
  function atualizar() {{
    var favs = window.MaysFavoritos ? window.MaysFavoritos.ler() : [];
    var itens = [];
    document.querySelectorAll('#favGrade .cartao-caixa').forEach(function (caixa) {{
      var b = caixa.querySelector('[data-fav]');
      var on = b && favs.indexOf(b.dataset.fav) >= 0;
      caixa.hidden = !on;
      if (on) itens.push({{ cod: b.dataset.cod, slug: b.dataset.fav }});
    }});
    document.getElementById('favVazio').hidden = itens.length > 0;
    document.getElementById('favAcoes').hidden = itens.length === 0;
    document.getElementById('favResumo').textContent =
      itens.length === 0 ? 'nenhum imóvel guardado'
      : itens.length === 1 ? '1 imóvel guardado' : itens.length + ' imóveis guardados';

    if (itens.length && numero) {{
      var linhas = itens.map(function (x) {{
        return '· ' + (x.cod || '') + ' ' + site + '/imovel/' + x.slug + '/';
      }});
      var NL = String.fromCharCode(10);
      var texto = 'Olá Rodrigo, separei estes imóveis no site e gostaria de falar sobre eles:'
                + NL + NL + linhas.join(NL);
      document.getElementById('favEnviar').href =
        'https://wa.me/' + numero + '?text=' + encodeURIComponent(texto);
    }}
  }}
  document.addEventListener('favoritos', atualizar);
  document.addEventListener('DOMContentLoaded', atualizar);
  document.addEventListener('click', function (ev) {{
    if (ev.target.id !== 'favLimpar') return;
    if (!confirm('Tirar todos os imóveis da sua lista?')) return;
    try {{ localStorage.removeItem('mays_favoritos'); }} catch (e) {{}}
    if (window.MaysFavoritos) window.MaysFavoritos.pintar();
  }});
}})();
</script>"""

    return (cabeca_html(cfg, "Meus favoritos · " + (cfg.get("nome_imobiliaria") or "Maysonnave Imóveis"),
                        "Os imóveis que você guardou.", base.rstrip("/") + "/favoritos.html",
                        raiz=".")
            + corpo + rodape_html(cfg, raiz="."))



def buscas_populares_html(itens):
    if not itens:
        return ""
    linhas = "".join(
        f'<a href="{e(href)}"><span>»</span>{e(rot)}<b>{n}</b></a>'
        for rot, n, href in itens)
    return f"""
<section class="secao buscas-pop">
  <div class="buscas-pop-barra"><h2>Buscas populares</h2></div>
  <div class="buscas-pop-grade">{linhas}</div>
</section>"""


def atalhos_html(cfg):
    """Três atalhos de saída. Cada um resolve uma intenção que não é
    "quero ver imóvel": vender, não achou, ou voltar pro que já separou."""
    link_vender = zap(cfg, msg="Olá Rodrigo, gostaria de agendar uma avaliação do meu imóvel.")
    link_contato = zap(cfg) or "#contato"

    cartoes = []
    if link_vender:
        cartoes.append(('vender', link_vender, True, 'Quer vender seu imóvel?',
                        'Peça uma avaliação com laudo de perito'))
    cartoes.append(('contato', link_contato, bool(zap(cfg)), 'Não encontrou o que procurava?',
                    'Fale direto comigo'))
    cartoes.append(('favoritos', 'favoritos.html', False, 'Meus imóveis favoritos',
                    'Veja a lista que você separou'))

    def cartao(icone, href, externo, titulo, sub):
        attrs = ' target="_blank" rel="noopener"' if externo else ""
        return (f'<a class="atalho atalho-{icone}" href="{e(href)}"{attrs}>'
                f'<strong>{e(titulo)}</strong><span>{e(sub)}</span></a>')

    return f"""
<section class="secao atalhos-grade">
  {''.join(cartao(*c) for c in cartoes)}
</section>"""


def pagina_home(cfg, imoveis, bairros, tipos, base, videos=None, reels=None):
    destaques = [i for i in imoveis if i.get("destaque")]
    nome = cfg.get("nome_imobiliaria") or "Maysonnave Imóveis"
    # Campo vazio significa "usa o automático": é o que garante que a home
    # nunca fique sem resumo, que é o defeito do site atual dele.
    titulo = cfg.get("site_titulo") or f"{nome} · Imóveis em Pelotas/RS"
    desc = cfg.get("site_descricao") or (
        "Compra, venda e avaliação de imóveis em Pelotas e região. "
        f"{len(imoveis)} imóveis disponíveis, com laudo de perito avaliador. "
        f"{cfg.get('creci') or ''}").strip()

    capa = imoveis[0].get("_capa") if imoveis else None
    jsonld = {
        "@context": "https://schema.org", "@type": "RealEstateAgent",
        "name": nome, "url": base,
        "areaServed": {"@type": "City", "name": "Pelotas", "addressRegion": "RS"},
    }
    if cfg.get("whatsapp"):
        jsonld["telephone"] = "+" + cfg["whatsapp"]
    # sameAs é como o Google liga o site aos perfis dele nas redes.
    redes = [cfg.get(k) for k in ("instagram", "youtube", "facebook") if cfg.get(k)]
    if redes:
        jsonld["sameAs"] = redes

    def secao(t, sub, itens):
        if not itens:
            return ""
        return f"""
        <section class="secao vitrine">
          <div class="secao-barra"><h2>{e(t)}</h2><span>{e(sub)}</span></div>
          <div class="grade">{''.join(cartao_html(i) for i in itens)}</div>
        </section>"""

    # ── As vitrines da home ────────────────────────────────────────────
    # Home é vitrine, não catálogo — cada seção só leva quem foi marcado
    # pra ela ("Onde este imóvel aparece" na ficha). Antes eram calculadas
    # (tipo, subtipo, região) e um imóvel só aparecia em até 5 seções
    # diferentes, sem controle nenhum. A lista completa continua existindo:
    # é a busca, que já ficava escondida até alguém filtrar.
    #
    # Vitrine vazia não é desenhada — é o que deixa "Lançamentos" existir
    # hoje sem aparecer, e passar a aparecer sozinha no dia em que ele
    # marcar o primeiro imóvel assim.
    def plural(n, um, muitos):
        return f"{n} {um if n == 1 else muitos}"

    blocos = [
        secao("Novidade", plural(len(destaques), "selecionado", "selecionados"), destaques),
        secao("Alto padrão", plural(sum(1 for i in imoveis if i.get("alto_padrao")), "imóvel", "imóveis"),
              [i for i in imoveis if i.get("alto_padrao")]),
        secao("Casas em condomínio", plural(sum(1 for i in imoveis if i.get("vitrine_condominio")), "imóvel", "imóveis"),
              [i for i in imoveis if i.get("vitrine_condominio")]),
        secao("Apartamentos selecionados", plural(sum(1 for i in imoveis if i.get("vitrine_apartamento")), "imóvel", "imóveis"),
              [i for i in imoveis if i.get("vitrine_apartamento")]),
        secao("Lançamentos", plural(sum(1 for i in imoveis if i.get("vitrine_lancamento")), "imóvel", "imóveis"),
              [i for i in imoveis if i.get("vitrine_lancamento")]),
        secao("Imóveis em SC", plural(sum(1 for i in imoveis if i.get("vitrine_sc")), "imóvel", "imóveis"),
              [i for i in imoveis if i.get("vitrine_sc")]),
    ]
    vitrines = "".join(b for b in blocos if b)

    # Usada só pelas buscas populares logo abaixo.
    venda = [i for i in imoveis if (i.get("finalidade") or "venda") != "aluguel"]

    # ── Buscas populares ────────────────────────────────────────────────
    # A mesma ideia dos portais grandes: link com âncora que já casa com o
    # que a pessoa digita no Google ("apartamento no centro"), e que aponta
    # direto pro resultado filtrado. Só entra combinação que existe de
    # verdade, então a lista cresce sozinha conforme a carteira cresce.
    def contagem_combo(a, b):
        c = {}
        for i in venda:
            va, vb = i.get(a), i.get(b)
            if va and vb:
                c[(va, vb)] = c.get((va, vb), 0) + 1
        return c

    combos_tipo_bairro = sorted(contagem_combo("_tipo", "_bairro").items(),
                                key=lambda x: -x[1])[:8]
    buscas_pop = [(f"{t}s em {b}",
                   n, f"?tipo={urllib.parse.quote(t)}&bairro={urllib.parse.quote(b)}#imoveis")
                  for (t, b), n in combos_tipo_bairro]

    # Nível de cidade só entra quando existe mais de uma: com um destino só,
    # "Imóveis em Pelotas: 18" é a lista inteira com outro nome.
    cidades_com_imovel = {}
    for i in imoveis:
        c = i.get("_cidade")
        if c:
            cidades_com_imovel[c] = cidades_com_imovel.get(c, 0) + 1
    if len(cidades_com_imovel) > 1:
        for c, n in sorted(cidades_com_imovel.items(), key=lambda x: -x[1]):
            buscas_pop.insert(0, (f"Imóveis em {c}", n, f"?cidade={urllib.parse.quote(c)}#imoveis"))


    opts_b = "".join(f'<option value="{e(b["nome"])}">{e(b["nome"])}</option>' for b in bairros)
    opts_t = "".join(f'<option value="{e(t["nome"])}">{e(t["nome"])}</option>' for t in tipos)

    cset = imoveis[0].get("_capa_set") if imoveis else None
    atr = ""
    if cset:
        atr = ' srcset="' + ", ".join(f"{c} {w}w" for c, w in cset) + '" sizes="100vw"'
        capa = cset[-1][0]
    capa_html = ('<img class="capa-foto" src="' + e(capa) + '"' + atr +
                 ' alt="" aria-hidden="true" fetchpriority="high" width="1400" height="788">'
                 if capa else "")
    corpo = f"""
<section class="capa">
  {capa_html}
  <div class="env">
    <div class="capa-creci">{e(cfg.get('creci') or '')}</div>
    <h1>Casas e apartamentos de alto padrão para comprar e alugar em Pelotas.</h1>
    <p>Compra, venda e avaliação de imóveis comerciais, residenciais e rurais.
       Cada imóvel analisado por perito avaliador antes de chegar até você.</p>
  </div>
</section>

<div class="env">
  <form class="busca" id="imoveis" onsubmit="return filtrar(event)">
    <div class="busca-topo">Encontre seu imóvel</div>
    <div class="busca-campos">
      <div><label for="fTipo">Tipo</label>
        <select id="fTipo"><option value="">Todos</option>{opts_t}</select></div>
      <div><label for="fBairro">Bairro</label>
        <select id="fBairro"><option value="">Todos</option>{opts_b}</select></div>
      <div><label for="fMax">Valor até</label>
        <select id="fMax"><option value="">Sem limite</option>
          <option value="300000">R$ 300 mil</option><option value="600000">R$ 600 mil</option>
          <option value="1000000">R$ 1 milhão</option><option value="3000000">R$ 3 milhões</option>
          <option value="99000000">Acima de R$ 3 milhões</option></select></div>
      <div><label for="fDorm">Dormitórios</label>
        <select id="fDorm"><option value="">Qualquer</option>
          <option value="1">1+</option><option value="2">2+</option>
          <option value="3">3+</option><option value="4">4+</option></select></div>
      <div><label for="fFin">Negócio</label>
        <select id="fFin"><option value="">Comprar ou alugar</option>
          <option value="venda">Comprar</option>
          <option value="aluguel">Alugar</option></select></div>
    </div>
  </form>

  <div id="vitrines">{vitrines}</div>

  <!-- Resultado da busca. Fica escondido até alguém filtrar ou pesquisar: a
       home é uma seleção, e a lista completa é o que se pede quando a seleção
       não bastou. Ele pediu justamente para tirar a lista da frente. -->
  <section class="secao" id="destaques" hidden>
    <div class="secao-barra"><h2>Resultado da busca</h2>
      <span id="conta">{len(imoveis)} {'disponível' if len(imoveis)==1 else 'disponíveis'}</span>
      <button type="button" class="btn-limpar" id="btnLimpar">Limpar busca</button></div>
    <div class="grade" id="grade">{''.join(cartao_html(i) for i in imoveis)}</div>
    <div class="vazio-site" id="semResultado" hidden>
      <p>Nenhum imóvel com esses filtros. Ajuste a busca acima.</p></div>
  </section>

  {secao_videos(cfg, videos or [])}
  {secao_reels(cfg, reels or [])}

  {buscas_populares_html(buscas_pop)}
  {atalhos_html(cfg)}
</div>

<script>
// Filtro no próprio HTML: os dados já estão na página, então não há requisição
// nenhuma. É o que permite a busca funcionar num site estático.
const dados = {json.dumps([{
    'slug': i['slug'], 'tipo': i.get('_tipo') or '', 'bairro': i.get('_bairro') or '',
    'valor': float(i['valor']) if i.get('valor') else 0,
    'fin': i.get('finalidade') or 'venda',
    'dorm': i.get('dormitorios') or 0,
    'cidade': i.get('_cidade') or '',
    'txt': ' '.join(str(x) for x in [i.get('codigo'), i.get('titulo'), i.get('_bairro'),
                                     i.get('_cidade'), i.get('endereco'), i.get('_tipo')] if x).lower()}
    for i in imoveis], ensure_ascii=False)};
let termoBusca = '';
let cidadeAtiva = '';
function filtrar(ev) {{
  if (ev) ev.preventDefault();
  const t = fTipo.value, b = fBairro.value, m = Number(fMax.value||0),
        d = Number(fDorm.value||0), f = fFin.value;
  // Busca por texto: cada palavra precisa aparecer em algum campo do imóvel,
  // então "casa laranjal" encontra a casa do Laranjal e não tudo que é casa.
  const palavras = termoBusca.split(/\s+/).filter(Boolean);
  let visiveis = 0;
  // Esconde a CAIXA e não o cartão: o coração fica fora do link, então
  // esconder só o cartão deixaria corações soltos na grade.
  document.querySelectorAll('#grade .cartao-caixa').forEach((el, idx) => {{
    const x = dados[idx];
    const ok = (!t || x.tipo===t) && (!b || x.bairro===b) && (!f || x.fin===f) &&
               (!m || (x.valor && x.valor<=m)) && (!d || x.dorm>=d) &&
               (!cidadeAtiva || x.cidade===cidadeAtiva) &&
               palavras.every(w => x.txt.includes(w));
    el.hidden = !ok; if (ok) visiveis++;
  }});
  conta.textContent = visiveis + (visiveis===1 ? ' disponível' : ' disponíveis');
  semResultado.hidden = visiveis > 0;

  // Buscando, a home vira lista de resultado. Sem busca, ela volta a ser a
  // seleção. Mostrar as duas coisas ao mesmo tempo faria a pessoa rolar por
  // vitrines que não têm nada a ver com o que ela acabou de pedir.
  const buscando = !!(t || b || m || d || f || cidadeAtiva || palavras.length);
  document.getElementById('vitrines').hidden = buscando;
  document.getElementById('destaques').hidden = !buscando;
  return false;
}}

function limparBusca() {{
  ['fTipo','fBairro','fMax','fDorm','fFin'].forEach(i => document.getElementById(i).value = '');
  termoBusca = '';
  cidadeAtiva = '';
  const campo = document.getElementById('qTexto');
  if (campo) campo.value = '';
  history.replaceState(null, '', location.pathname);
  filtrar();
}}
['fTipo','fBairro','fMax','fDorm','fFin'].forEach(i =>
  document.getElementById(i).addEventListener('change', () => filtrar()));
document.getElementById('btnLimpar').addEventListener('click', limparBusca);

// O menu grande manda o filtro pelo endereço (?tipo=Casa#imoveis). Aqui ele é
// lido e aplicado, para o link do menu já cair na lista certa em vez de na
// lista inteira com o trabalho todo por fazer.
(function () {{
  const q = new URLSearchParams(location.search);
  const de = {{ tipo: 'fTipo', bairro: 'fBairro', dorm: 'fDorm', fin: 'fFin', max: 'fMax' }};
  let mudou = false;
  for (const [chave, campo] of Object.entries(de)) {{
    const v = q.get(chave);
    if (!v) continue;
    const el = document.getElementById(campo);
    if (!el) continue;
    // Só aceita valor que existe no seletor: endereço editado à mão não pode
    // deixar a busca num estado que a tela não sabe mostrar.
    if ([...el.options].some(o => o.value === v)) {{ el.value = v; mudou = true; }}
  }}
  const cid = q.get('cidade');
  if (cid) {{ cidadeAtiva = cid; mudou = true; }}

  const termo = q.get('q');
  if (termo) {{
    termoBusca = termo.toLowerCase();
    const campo = document.getElementById('qTexto');
    if (campo) {{ campo.value = termo; document.getElementById('buscaTexto').classList.add('aberta'); }}
    mudou = true;
  }}
  if (mudou) {{
    filtrar();
    // Veio de um link do menu: leva direto ao resultado, senão a pessoa cai
    // no topo da home sem entender que o filtro já foi aplicado.
    requestAnimationFrame(() => document.getElementById('imoveis').scrollIntoView());
  }}
}})();

// A lupa chama isto quando a busca acontece na própria home, sem recarregar.
window.buscarTexto = function (q) {{
  termoBusca = (q || '').toLowerCase();
  filtrar();
  document.getElementById('imoveis').scrollIntoView({{ behavior: 'smooth' }});
}};

// Carrossel da miniatura. A seta vive DENTRO do link do cartão, então sem
// preventDefault o clique abriria o imóvel em vez de trocar a foto.
document.querySelectorAll('.cartao-foto').forEach(moldura => {{
  const img = moldura.querySelector('img');
  if (!img || !img.dataset.fotos) return;
  const fotos = [img.getAttribute('src')].concat(img.dataset.fotos.split('|'));
  const pontos = moldura.querySelectorAll('.cartao-pontos i');
  let i = 0;
  const ir = passo => {{
    i = (i + passo + fotos.length) % fotos.length;
    img.src = fotos[i];
    pontos.forEach((p, k) => p.classList.toggle('on', k === i));
  }};
  pontos.forEach((p, k) => p.classList.toggle('on', k === 0));
  moldura.querySelector('.cartao-ant').addEventListener('click', ev => {{
    ev.preventDefault(); ev.stopPropagation(); ir(-1);
  }});
  moldura.querySelector('.cartao-prox').addEventListener('click', ev => {{
    ev.preventDefault(); ev.stopPropagation(); ir(1);
  }});
}});
</script>"""

    return (cabeca_html(cfg, titulo, desc, base + "/", capa, jsonld, raiz=".")
            + corpo + rodape_html(cfg, raiz="."))


def pagina_imovel(cfg, im, base, todos=None):
    raiz = "../.."
    acao_titulo = "para alugar" if im.get("finalidade") == "aluguel" else "à venda"
    emp = next((c for c in EMPREENDIMENTOS if c["id"] == im.get("empreendimento_id")), None)
    # Quem procura um condomínio específico digita o nome dele, não o
    # bairro — o resumo automático (só entra quando o campo está em
    # branco) busca melhor assim.
    local_seo = (emp["nome"] if emp else None) or im.get("_bairro") or "Pelotas"
    titulo = im.get("meta_titulo") or f"{im.get('_tipo') or 'Imóvel'} {acao_titulo} em {local_seo}, Pelotas/RS · {cfg.get('nome_imobiliaria')}"
    desc = im.get("meta_descricao") or (im.get("descricao_publica") or titulo)[:158]
    url = f"{base}/imovel/{im['slug']}/"

    jsonld = {
        "@context": "https://schema.org", "@type": "Product",
        "name": im.get("titulo") or titulo, "sku": im.get("codigo"),
        "description": desc, "url": url,
    }
    if im.get("_capa"):
        jsonld["image"] = base + "/" + im["_capa"].lstrip("./")
    if im.get("valor"):
        jsonld["offers"] = {"@type": "Offer", "price": int(float(im["valor"])),
                            "priceCurrency": "BRL", "availability": "https://schema.org/InStock"}

    dados = []
    for rot, val in [("Dormitórios", im.get("dormitorios")), ("Suítes", im.get("suites")),
                     ("Banheiros", im.get("banheiros")), ("Vagas", im.get("vagas")),
                     ("Área útil", medida(im.get("area_util"))),
                     ("Área total", medida(im.get("area_total"))),
                     ("Testada", medida(im.get("testada"), "m")),
                     ("Ano", im.get("ano_construcao")),
                     ("IPTU", brl(im["iptu"]) if im.get("iptu") else None),
                     ("Condomínio", brl(im["condominio"]) if im.get("condominio") else None)]:
        if val:
            dados.append(f"<div><dt>{e(rot)}</dt><dd>{e(val)}</dd></div>")

    extras = []
    if im.get("aceita_financiamento"): extras.append("Aceita financiamento")
    if im.get("aceita_permuta"):       extras.append("Aceita permuta")
    for c in im.get("_caracteristicas", []):
        extras.append(c)

    fotos_imovel = [cam(raiz, f) for f in im.get("_fotos", [])]
    minis_imovel = [cam(raiz, m) for m in (im.get("_miniaturas") or [])] or fotos_imovel
    # Área comum é do condomínio, não da unidade, mas quem procura
    # apartamento quer ver a piscina e a portaria também — junto na mesma
    # galeria, fotos do imóvel primeiro e do condomínio na sequência.
    fotos_condominio = [cam(raiz, f) for f in (emp.get("_fotos") or [])] if emp else []
    fotos = fotos_imovel + fotos_condominio
    # Condomínio não tem miniatura própria (a capa dele não é LCP de venda
    # de unidade), reaproveita a foto cheia como se fosse a miniatura dela.
    minis = minis_imovel + fotos_condominio

    # Tudo montado fora da f-string. Além de compilar no Python 3.9, fica bem
    # mais legível que HTML aninhado dentro de expressão.
    capa_html = ""
    if im.get("_capa"):
        cset = [(cam(raiz, c), w) for c, w in (im.get("_capa_set") or [])]
        atr = ""
        principal = cam(raiz, im["_capa"])
        if cset:
            atr = (' srcset="' + ", ".join(f"{c} {w}w" for c, w in cset) + '"'
                   ' sizes="(max-width:820px) 100vw, 62vw"')
            principal = cset[-1][0]
        # Foto em pé numa moldura deitada deixaria faixa vazia dos dois lados.
        # A mesma imagem, borrada e ampliada, preenche o vazio: a foto aparece
        # inteira (contain) sem buraco na composição.
        fundo = cset[0][0] if cset else principal
        capa_html = ('<div class="ficha-capa" style="--fundo:url(&quot;' + e(fundo) + '&quot;)">'
                     '<img src="' + e(principal) + '"' + atr +
                     ' alt="' + e(im.get("titulo") or "Imóvel") +
                     '" width="1400" height="788" fetchpriority="high"></div>')
    galeria_html = ""
    # Miniaturas em coluna ao lado da foto grande, como na referência. Em grade
    # embaixo, a pessoa precisa rolar para ver que existem mais fotos.
    tiras = ""
    if len(fotos) > 1:
        tiras = ('<div class="palco-tira"><div class="tira">' + "".join(
            '<button type="button" class="tira-item" data-i="' + str(i) + '"'
            ' aria-label="Ver foto ' + str(i + 1) + '">'
            '<img src="' + e(minis[i] if i < len(minis) else g) + '"'
            ' alt="" loading="lazy" width="120" height="90"></button>'
            for i, g in enumerate(fotos)) + '</div></div>')
    if False:
        # Miniatura na grade, foto grande no visualizador. Antes cada clique
        # abria uma aba nova do navegador, o que tirava a pessoa do site e
        # obrigava a fechar aba por aba para ver as fotos.
        itens_g = "".join(
            '<button type="button" class="galeria-item" data-i="' + str(i) + '"'
            ' aria-label="Ver foto ' + str(i + 1) + '">'
            '<img src="' + e(minis[i] if i < len(minis) else g) + '"'
            ' alt="Foto ' + str(i + 1) + ' do imóvel" loading="lazy"'
            ' width="300" height="225"></button>'
            for i, g in enumerate(fotos))
        galeria_html = '<div class="galeria">' + itens_g + '</div>'
    dados_html = '<dl class="dados">' + "".join(dados) + '</dl>' if dados else ""
    desc_html = ('<div class="ficha-desc">' + paragrafos_import(im["descricao_publica"]) + '</div>'
                 if im.get("descricao_publica") else "")
    extras_html = ""
    if extras:
        extras_html = ('<div class="extras">' +
                       "".join('<span class="extra">' + e(x) + '</span>' for x in extras) +
                       '</div>')
    link_zap = zap(cfg, im)
    botoes = ""
    if link_zap:
        botoes += ('<a class="botao botao-cheio" href="' + e(link_zap) +
                   '" target="_blank" rel="noopener">Falar sobre este imóvel</a>')
    for campo, rot in [("link_tour360", "Tour 360°"), ("link_lp", "Página do empreendimento")]:
        if im.get(campo):
            botoes += ('<a class="botao" href="' + e(im[campo]) +
                       '" target="_blank" rel="noopener">' + rot + '</a>')

    # Vídeo toca dentro da ficha, abaixo da descrição — sair pro YouTube
    # pra ver um vídeo de 40s tira a pessoa bem no meio da visita.
    video_html = ""
    vid_imovel = id_youtube(im.get("link_video"))
    if vid_imovel:
        capa_video = capa_youtube(vid_imovel)
        img_video = (f'<img src="{cam(raiz, capa_video)}" alt="" loading="lazy" width="640" height="360">'
                     if capa_video else '<div class="video-sem-capa"></div>')
        video_html = (
            f'<div class="ficha-video"><h2>Vídeo</h2>'
            f'<button type="button" class="video-capa" data-youtube="{e(vid_imovel)}">'
            f'{img_video}<span class="video-play" aria-hidden="true">&#9654;</span></button></div>')
    local_html = e(im.get("_bairro") or "")
    if im.get("_cidade"):
        local_html += " · " + e(im["_cidade"])

    # Unidade que pertence a um condomínio cadastrado leva pra ficha dele —
    # sem isso o vínculo existe só no banco, ninguém vê. As fotos do
    # condomínio já entraram na galeria principal (fotos_condominio, acima);
    # aqui fica só o resumo em texto, no fim da ficha.
    emp_html = ""
    emp_resumo_html = ""
    if emp and emp.get("slug"):
        emp_html = (f'<div class="lateral-empreendimento">Unidade no '
                    f'<a href="{raiz}/condominio/{e(emp["slug"])}/">{e(emp["nome"])}</a></div>')
        if emp.get("descricao"):
            emp_resumo_html = (
                f'<div class="cond-resumo"><h2>Sobre o {e(emp["nome"])}</h2>'
                f'<div class="ficha-desc">{paragrafos_import(emp["descricao"])}</div>'
                f'<a class="cond-fotos-link" href="{raiz}/condominio/{e(emp["slug"])}/">'
                f'Ver a ficha completa de {e(emp["nome"])} →</a></div>')

    # Quem agenciou este imóvel — rosto por trás do anúncio, não só o
    # WhatsApp da imobiliária.
    agenciador_html = ""
    ag = next((c for c in CORRETORES if c["id"] == im.get("agenciador_id")), None)
    if ag:
        foto = (f'<img src="{e(ag["foto_url"])}" alt="{e(ag["nome"])}">' if ag.get("foto_url")
                else f'<span class="ag-iniciais">{e((ag["nome"] or "?")[:1])}</span>')
        creci = f'<span class="ag-creci">CRECI {e(ag["creci"])}{"/" + e(ag["creci_estado"]) if ag.get("creci_estado") else ""}</span>' if ag.get("creci") else ""
        bio = f'<p class="ag-bio">{e(ag["bio"])}</p>' if ag.get("bio") else ""
        agenciador_html = (
            f'<div class="lateral-agenciador"><div class="ag-foto">{foto}</div>'
            f'<div class="ag-corpo"><span class="ag-rot">Agenciado por</span>'
            f'<strong>{e(ag["nome"])}</strong>{creci}{bio}</div></div>')

    # Trilha: ajuda a navegar e é sinal de estrutura para o buscador.
    migalhas = ['<a href="' + raiz + '/">Início</a>']
    if im.get("_tipo"):
        migalhas.append(e(im["_tipo"]))
    if im.get("_bairro"):
        migalhas.append(e(im["_bairro"]))
    migalhas.append("<span>" + e(im.get("codigo") or "") + "</span>")
    trilha_html = ('<nav class="trilha-site" aria-label="Você está em">' +
                   ' <i>›</i> '.join(migalhas) + '</nav>')

    # Lista de ícones na lateral: mais fácil de bater o olho que tabela.
    linhas_icone = []
    for rot, val in [
        ("dorm", (f"{im['dormitorios']} dormitório" + ("s" if (im.get("dormitorios") or 0) > 1 else "") +
                  (f" ({im['suites']} suíte" + ("s)" if im["suites"] > 1 else ")") if im.get("suites") else ""))
                 if im.get("dormitorios") else None),
        ("vaga", (f"{im['vagas']} vaga" + ("s" if im["vagas"] > 1 else "")) if im.get("vagas") else None),
        ("banho", (f"{im['banheiros']} banheiro" + ("s" if im["banheiros"] > 1 else "")) if im.get("banheiros") else None),
        ("util", (medida(im["area_util"]) + " de área privativa") if im.get("area_util") else None),
        ("total", (medida(im["area_total"]) + " de área total") if im.get("area_total") else None),
        ("ano", (f"Construído em {im['ano_construcao']}") if im.get("ano_construcao") else None),
    ]:
        if val:
            linhas_icone.append('<li class="ic ic-' + rot + '">' + e(val) + '</li>')
    icones_html = ('<ul class="lista-icones">' + "".join(linhas_icone) + '</ul>') if linhas_icone else ""

    corpo = f"""
<div class="env">
  {trilha_html}
  <div class="ficha">
    <div>
      <div class="palco">
        {capa_html}
        {tiras}
      </div>

      <h1 style="margin-top:28px">{e(im.get('titulo') or titulo)}</h1>
      <div class="ficha-local">{local_html}</div>

      {dados_html}
      {desc_html}
      {video_html}
      {extras_html}
      {emp_resumo_html}
    </div>

    <aside class="lateral">
      <div class="lateral-local">{local_html}</div>
      {icones_html}
      <div class="lateral-preco">{brl(im.get('valor'), im.get('finalidade'))}</div>
      <div class="lateral-ref">Referência {e(im.get('codigo') or '')}</div>
      {emp_html}
      {botoes}
      {agenciador_html}
      <p style="font-size:12.5px;color:var(--tinta-3);margin-top:18px;line-height:1.55">
        Avaliação técnica por perito. {e(cfg.get('creci') or '')}</p>
    </aside>
  </div>
</div>"""

    # ── Imóveis semelhantes ────────────────────────────────────────
    # Tipo tem que bater sempre — é o que faz terreno nunca aparecer como
    # "semelhante" de sobrado, por mais que dividam bairro e faixa de preço.
    # Bairro e preço parecido só entram depois, pra ordenar entre quem já
    # passou no corte do tipo. Venda e aluguel também nunca se misturam.
    # Tipo em branco nos dois lados (None == None) não conta como bater —
    # sem essa guarda, dois imóveis sem tipo cadastrado se achavam "iguais".
    semelhantes_html = ""
    if todos:
        def parecido(o):
            if o["id"] == im["id"] or not o.get("slug"):
                return -1
            if (o.get("finalidade") or "venda") != (im.get("finalidade") or "venda"):
                return -1
            mesmo_tipo = bool(o.get("tipo_imovel_id")) and o.get("tipo_imovel_id") == im.get("tipo_imovel_id")
            if not mesmo_tipo:
                return -1
            nota = 5
            if o.get("bairro_id") and o["bairro_id"] == im.get("bairro_id"):
                nota += 3
            v1, v2 = im.get("valor"), o.get("valor")
            if v1 and v2 and 0.6 <= float(v2) / float(v1) <= 1.6:
                nota += 2
            return nota
        candidatos = sorted((o for o in todos if parecido(o) > 0),
                            key=parecido, reverse=True)[:4]
        if candidatos:
            semelhantes_html = ("""
  <section class="semelhantes">
    <div class="env">
      <h2>Imóveis semelhantes</h2>
      <div class="grade">""" +
                "".join(cartao_html(o, raiz=raiz) for o in candidatos) +
                "</div></div></section>")

    # ── Formulário ─────────────────────────────────────────────────────
    # Grava direto na plataforma pela API pública, que só aceita INSERT nesta
    # tabela. Hoje ele não tem nenhum canal digital: o lead entra presencial ou
    # por indicação. Este é o primeiro que cai no CRM sozinho.
    msg_padrao = (f"Olá Rodrigo, tenho interesse no imóvel {im.get('codigo','')} "
                  f"({im.get('titulo') or ''}). Aguardo o contato.")
    formulario = f"""
<section class="form-lead" id="falar">
  <div class="env">
    <div class="form-caixa">
      <h2>Mais informações sobre este imóvel</h2>
      <p>Respondo pessoalmente. Sem robô e sem corrente de e-mail.</p>
      <form id="formLead" novalidate>
        <label for="lNome">Nome<span aria-hidden="true">*</span></label>
        <input type="text" id="lNome" name="nome" required autocomplete="name">
        <div class="form-dupla">
          <div><label for="lTel">Telefone<span aria-hidden="true">*</span></label>
            <input type="tel" id="lTel" name="telefone" required autocomplete="tel"
                   placeholder="(53) 9 9999-9999"></div>
          <div><label for="lEmail">E-mail</label>
            <input type="email" id="lEmail" name="email" autocomplete="email"></div>
        </div>
        <label for="lMsg">Mensagem</label>
        <textarea id="lMsg" name="mensagem" rows="3">{e(msg_padrao)}</textarea>
        <button type="submit" class="botao botao-cheio" id="lEnviar">Enviar</button>
        <p class="form-aviso" id="lAviso" role="status"></p>
      </form>
    </div>
  </div>
</section>
<script>
(() => {{
  const f = document.getElementById('formLead');
  const aviso = document.getElementById('lAviso');
  const btn = document.getElementById('lEnviar');
  f.addEventListener('submit', async ev => {{
    ev.preventDefault();
    const nome = lNome.value.trim(), tel = lTel.value.trim();
    if (!nome || !tel) {{
      aviso.textContent = 'Preencha nome e telefone para eu conseguir responder.';
      aviso.className = 'form-aviso erro';
      (nome ? lTel : lNome).focus();
      return;
    }}
    btn.disabled = true; btn.textContent = 'Enviando…';
    try {{
      const r = await fetch('{URL}/rest/v1/lead_site', {{
        method: 'POST',
        headers: {{ 'apikey': '{CHAVE}', 'Content-Type': 'application/json' }},
        body: JSON.stringify({{
          nome, telefone: tel, email: lEmail.value.trim() || null,
          mensagem: lMsg.value.trim() || null,
          imovel_id: '{im["id"]}', imovel_ref: '{e(im.get("codigo") or "")}',
          pagina: location.pathname, origem: 'Ficha do imóvel'
        }})
      }});
      if (!r.ok) throw new Error(r.status);
      f.innerHTML = '<p class="form-ok">Recebido. Retorno em breve no telefone que você deixou.</p>';
    }} catch (erro) {{
      aviso.textContent = 'Não consegui enviar agora. Chame no WhatsApp que eu respondo na hora.';
      aviso.className = 'form-aviso erro';
      btn.disabled = false; btn.textContent = 'Enviar';
    }}
  }});
}})();
</script>"""

    # Visualizador embutido. Vanilla, sem biblioteca: são 30 linhas e mantém
    # a página em zero requisição externa, que é o que segura o 100 de
    # performance.
    visualizador = ""
    if fotos:
        visualizador = f"""
<div class="visor" id="visor" hidden role="dialog" aria-modal="true" aria-label="Fotos do imóvel">
  <button class="visor-fechar" id="visorFechar" aria-label="Fechar">&#x2715;</button>
  <button class="visor-seta visor-ant" id="visorAnt" aria-label="Foto anterior">&#x2039;</button>
  <figure class="visor-palco"><img id="visorImg" alt=""></figure>
  <button class="visor-seta visor-prox" id="visorProx" aria-label="Próxima foto">&#x203a;</button>
  <div class="visor-conta" id="visorConta"></div>
</div>
<script>
(() => {{
  const fotos = {json.dumps(fotos, ensure_ascii=False)};
  const visor = document.getElementById('visor');
  const img = document.getElementById('visorImg');
  const conta = document.getElementById('visorConta');
  let atual = 0, ultimoFoco = null;

  function mostrar(i) {{
    atual = (i + fotos.length) % fotos.length;
    img.src = fotos[atual];
    img.alt = 'Foto ' + (atual + 1) + ' de ' + fotos.length;
    conta.textContent = (atual + 1) + ' / ' + fotos.length;
  }}
  function abrir(i) {{
    ultimoFoco = document.activeElement;
    mostrar(i);
    visor.hidden = false;
    document.body.style.overflow = 'hidden';
    document.getElementById('visorFechar').focus();
  }}
  function fechar() {{
    visor.hidden = true;
    document.body.style.overflow = '';
    if (ultimoFoco) ultimoFoco.focus();
  }}
  document.querySelectorAll('.tira-item').forEach(b =>
    b.addEventListener('click', () => abrir(Number(b.dataset.i))));
  const capa = document.querySelector('.ficha-capa');
  if (capa) {{ capa.style.cursor = 'zoom-in'; capa.addEventListener('click', () => abrir(0)); }}
  document.getElementById('visorFechar').addEventListener('click', fechar);
  document.getElementById('visorAnt').addEventListener('click', () => mostrar(atual - 1));
  document.getElementById('visorProx').addEventListener('click', () => mostrar(atual + 1));
  visor.addEventListener('click', ev => {{ if (ev.target === visor) fechar(); }});
  document.addEventListener('keydown', ev => {{
    if (visor.hidden) return;
    if (ev.key === 'Escape') fechar();
    if (ev.key === 'ArrowLeft') mostrar(atual - 1);
    if (ev.key === 'ArrowRight') mostrar(atual + 1);
  }});
  // Arrastar o dedo no celular
  let x0 = null;
  visor.addEventListener('touchstart', ev => {{ x0 = ev.touches[0].clientX; }}, {{passive: true}});
  visor.addEventListener('touchend', ev => {{
    if (x0 === null) return;
    const d = ev.changedTouches[0].clientX - x0;
    if (Math.abs(d) > 45) mostrar(atual + (d < 0 ? 1 : -1));
    x0 = null;
  }}, {{passive: true}});
}})();
</script>"""

    return (cabeca_html(cfg, titulo, desc, url, cam(raiz, im.get("_capa")), jsonld, raiz=raiz)
            + corpo + semelhantes_html + visualizador + formulario + rodape_html(cfg, raiz=raiz))


# ── Condomínio ───────────────────────────────────────────────────────────
def pagina_condominio(cfg, emp, unidades, base):
    """Ficha do empreendimento: mesma casca do imóvel (cabeça, rodapé,
    grade de cartões), sem o aparato de negociação de uma unidade só — quem
    chega aqui está escolhendo entre várias."""
    raiz = "../.."
    cidade_emp = emp.get("_cidade") or "Pelotas"
    estado_emp = emp.get("estado") or "RS"
    titulo = f"{emp['nome']} — Condomínio em {emp.get('_bairro') or cidade_emp}, {cidade_emp}/{estado_emp} · {cfg.get('nome_imobiliaria')}"
    desc = (emp.get("descricao") or titulo)[:158]
    url = f"{base}/condominio/{emp['slug']}/"

    jsonld = {"@context": "https://schema.org", "@type": "ApartmentComplex",
              "name": emp["nome"], "description": desc, "url": url}
    if emp.get("_capa"):
        jsonld["image"] = base + "/" + emp["_capa"].lstrip("./")

    local = e(emp.get("_bairro") or "")
    endereco_completo = ", ".join(p for p in (emp.get("endereco"), emp.get("numero")) if p)
    if endereco_completo:
        local += (" · " if local else "") + e(endereco_completo)
    local += (" · " if local else "") + e(f"{cidade_emp}/{estado_emp}")

    capa_html = ""
    if emp.get("_capa"):
        capa_html = (f'<div class="cond-capa"><img src="{cam(raiz, emp["_capa"])}" '
                     f'alt="{e(emp["nome"])}" loading="eager" width="1400" height="700"></div>')

    outras = [cam(raiz, f) for f in (emp.get("_fotos") or [])[1:]]
    galeria_html = ('<div class="cond-galeria">' +
                     "".join(f'<img src="{o}" alt="" loading="lazy" width="360" height="240">' for o in outras) +
                     "</div>") if outras else ""

    desc_html = f'<div class="prose">{paragrafos_import(emp["descricao"])}</div>' if emp.get("descricao") else ""

    video_html = ""
    vid_emp = id_youtube(emp.get("link_video"))
    if vid_emp:
        capa_video = capa_youtube(vid_emp)
        img_video = (f'<img src="{cam(raiz, capa_video)}" alt="" loading="lazy" width="640" height="360">'
                     if capa_video else '<div class="video-sem-capa"></div>')
        video_html = (
            f'<div class="ficha-video"><h2>Vídeo</h2>'
            f'<button type="button" class="video-capa" data-youtube="{e(vid_emp)}">'
            f'{img_video}<span class="video-play" aria-hidden="true">&#9654;</span></button></div>')

    link_zap = zap(cfg, msg=f"Olá Rodrigo, tenho interesse no {emp['nome']} e gostaria de saber mais.")
    botao = (f'<a class="botao botao-cheio" href="{e(link_zap)}" target="_blank" rel="noopener">'
              'Falar sobre este empreendimento</a>') if link_zap else ""

    unidades_html = ""
    if unidades:
        unidades_html = f"""
<section class="semelhantes">
  <div class="env">
    <h2>Unidades disponíveis</h2>
    <div class="grade">{"".join(cartao_html(u, raiz=raiz) for u in unidades)}</div>
  </div>
</section>"""

    corpo = f"""
<div class="env">
  <nav class="trilha-site" aria-label="Você está em">
    <a href="{raiz}/">Início</a> <i>›</i> <span>{e(emp['nome'])}</span></nav>
  {capa_html}
  <h1 style="margin-top:22px">{e(emp['nome'])}</h1>
  <div class="ficha-local">{local}{(" · " + e(emp["_construtora"])) if emp.get("_construtora") else ""}</div>
  {galeria_html}
  {desc_html}
  {video_html}
  {botao}
</div>"""

    return (cabeca_html(cfg, titulo, desc, url, cam(raiz, emp.get("_capa")), jsonld, raiz=raiz)
            + corpo + unidades_html + rodape_html(cfg, raiz=raiz))


# ── Blog ───────────────────────────────────────────────────────────────
def paragrafos(texto):
    """Linha em branco separa parágrafo. Escapa tudo: o texto vem do editor
    sem HTML de propósito, e confiar nele abriria a porta pra marcação
    quebrada vinda de copiar e colar."""
    if not texto:
        return ""
    blocos = [b.strip() for b in texto.replace("\r\n", "\n").split("\n\n") if b.strip()]
    return "".join("<p>" + e(b).replace("\n", "<br>") + "</p>" for b in blocos)


def paragrafos_import(texto):
    """Descrição vinda do backup da Tecimob: sem quebra de parágrafo
    nenhuma, frase grudada na frase seguinte — às vezes nem sobrou o ponto
    final, era um subtítulo que virou parede de texto ("sofisticadosAo
    entrar"). Recoloca a quebra onde uma frase gruda na próxima (ponto
    seguido de maiúscula sem espaço, ou minúscula seguida direto de
    maiúscula) antes de passar pro `paragrafos()` de sempre. Texto que já
    tem `\\n\\n` de verdade passa direto, sem mexer."""
    if not texto or "\n\n" in texto:
        return paragrafos(texto)
    junto = re.sub(r"([.!?])(?=[A-ZÀ-Ý])", r"\1\n\n", texto)
    junto = re.sub(r"(?<=[a-zà-ý])(?=[A-ZÀ-Ý][a-zà-ý])", "\n\n", junto)
    return paragrafos(junto)


def data_br(iso):
    if not iso:
        return ""
    a, m, d = iso[:10].split("-")
    meses = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho",
             "agosto", "setembro", "outubro", "novembro", "dezembro"]
    return f"{int(d)} de {meses[int(m)-1]} de {a}"


def cartao_post(post, raiz="."):
    capa = ""
    if post.get("capa_url"):
        capa = ('<div class="post-capa"><img src="' + e(post["capa_url"]) +
                '" alt="" loading="lazy" width="400" height="225"></div>')
    return f"""
    <a class="cartao post-cartao" href="{raiz}/blog/{e(post['slug'])}/">
      {capa}
      <div class="cartao-corpo">
        <div class="cartao-local">{e(data_br(post.get('publicado_em')))}</div>
        <h2 class="post-titulo">{e(post['titulo'])}</h2>
        <p class="post-resumo">{e((post.get('resumo') or '')[:160])}</p>
      </div>
    </a>"""


def pagina_blog(cfg, posts, base):
    titulo = f"Blog · {cfg.get('nome_imobiliaria') or 'Maysonnave Imóveis'}"
    desc = ("Análise de mercado imobiliário em Pelotas por perito avaliador. "
            "Investimento, avaliação e o que os números dizem sobre a cidade.")
    corpo = f"""
<div class="env">
  <div class="pagina-topo">
    <h1>Blog</h1>
    <p>Análise de mercado por quem avalia. {len(posts)} artigo{'s' if len(posts) != 1 else ''}.</p>
  </div>
  {'<div class="grade">' + "".join(cartao_post(p, raiz="..") for p in posts) + '</div>'
   if posts else '<div class="vazio-site"><p>Nenhum artigo publicado ainda.</p></div>'}
</div>"""
    return (cabeca_html(cfg, titulo, desc, base + "/blog/", None, None, raiz="..")
            + corpo + rodape_html(cfg, raiz=".."))


def pagina_post(cfg, post, base):
    raiz = "../.."
    titulo = post.get("meta_titulo") or post["titulo"][:60]
    desc = post.get("meta_descricao") or (post.get("resumo") or post.get("conteudo") or "")[:158]
    url = f"{base}/blog/{post['slug']}/"
    jsonld = {
        "@context": "https://schema.org", "@type": "Article",
        "headline": post["titulo"], "description": desc, "url": url,
        "author": {"@type": "Person", "name": "Rodrigo Maysonnave"},
        "publisher": {"@type": "Organization",
                      "name": cfg.get("nome_imobiliaria") or "Maysonnave Imóveis"},
    }
    if post.get("publicado_em"):
        jsonld["datePublished"] = post["publicado_em"]
    if post.get("capa_url"):
        jsonld["image"] = post["capa_url"]

    capa = ""
    if post.get("capa_url"):
        capa = ('<div class="artigo-capa"><img src="' + e(post["capa_url"]) +
                '" alt="" width="1200" height="600"></div>')
    link_zap = zap(cfg)
    chamada = ""
    if link_zap:
        chamada = ('<div class="artigo-chamada"><p>Quer conversar sobre um imóvel '
                   'específico?</p><a class="botao botao-cheio" href="' + e(link_zap) +
                   '" target="_blank" rel="noopener">Falar com o Rodrigo</a></div>')

    corpo = f"""
<div class="env">
  <article class="artigo">
    <div class="artigo-data">{e(data_br(post.get('publicado_em')))}</div>
    <h1>{e(post['titulo'])}</h1>
    {'<p class="artigo-resumo">' + e(post['resumo']) + '</p>' if post.get('resumo') else ''}
    {capa}
    <div class="artigo-corpo">{paragrafos(post.get('conteudo'))}</div>
    {chamada}
    <p class="artigo-assina">{e(cfg.get('creci') or '')}</p>
  </article>
</div>"""
    return (cabeca_html(cfg, titulo, desc, url, post.get("capa_url"), jsonld, raiz=raiz)
            + corpo + rodape_html(cfg, raiz=raiz))



# ── Vídeos e reels ─────────────────────────────────────────────────────
def id_youtube(url):
    """Extrai o identificador de qualquer formato de link do YouTube."""
    m = re.search(r"(?:v=|youtu\.be/|/embed/|/shorts/)([A-Za-z0-9_-]{11})", url or "")
    return m.group(1) if m else None


def capa_youtube(vid):
    """Baixa a capa do YouTube na geração.

    Apontar direto para img.ytimg.com funcionaria, mas seria requisição a
    domínio externo em toda visita: mais lento e um rastreador a mais. Baixando
    aqui, o site continua sem pedir nada para fora.
    """
    destino = SAIDA / "fotos" / f"yt-{vid}.jpg"
    for qual in ("maxresdefault", "hqdefault"):
        if baixar_foto(f"https://img.youtube.com/vi/{vid}/{qual}.jpg", destino):
            if destino.stat().st_size > 3000:      # 404 do YouTube vem como imagem cinza pequena
                v = converter_webp(destino, 640)
                return f"fotos/{v.name}" if v else f"fotos/{destino.name}"
            destino.unlink(missing_ok=True)
    return None


# O binário em ferramentas/ é compilado para o Mac dele. Numa máquina Linux
# (a esteira automática) ele não roda, "Exec format error". FFMPEG_BIN
# permite apontar para o ffmpeg instalado por lá, sem mexer no uso local.
FFMPEG = Path(os.environ["FFMPEG_BIN"]) if os.environ.get("FFMPEG_BIN") \
    else AQUI.parent / "ferramentas" / "ffmpeg"


SEGUNDOS_REEL = 15   # quanto do reel toca em laço na home


def comprimir_video(origem, largura=400):
    """Recomprime o vídeo para o tamanho em que ele realmente aparece.

    O Instagram entrega o reel em qualidade de tela cheia: 8 a 20 MB cada. No
    site ele aparece num cartão de 234px de largura. Sem recomprimir, rolar até
    a seção baixava 19,5 MB de uma vez, o que em 4G é hostil.

    O ffmpeg fica em `ferramentas/`, como arquivo único: nada instalado no
    sistema, e apagar é deletar o arquivo. Se ele não estiver lá, o vídeo
    original é mantido e o site continua funcionando.
    """
    if not FFMPEG.exists():
        return origem
    destino = origem.with_name(origem.stem + "-p.mp4")
    if destino.exists() and destino.stat().st_size > 10000:
        return destino
    # Corta nos primeiros segundos. Os reels dele têm de 40s a 2 minutos, e o
    # cartão da home é um chamariz, não o lugar de assistir: quem se interessar
    # clica em "Ver no Instagram" e vê inteiro. Sem o corte, rolar até a seção
    # baixava 19,5 MB.
    r = subprocess.run([
        str(FFMPEG), "-y", "-loglevel", "error", "-i", str(origem),
        "-t", str(SEGUNDOS_REEL),
        "-vf", f"scale={largura}:-2,fps=24",
        "-c:v", "libx264", "-preset", "slow", "-crf", "32",
        "-profile:v", "main", "-pix_fmt", "yuv420p",
        # Som fora: o vídeo toca mudo por padrão e o botão de som é enfeite
        # que ninguém usa numa vitrine. Tirar corta um terço do arquivo.
        "-an",
        # Move o índice pro começo: sem isto o navegador precisa baixar o
        # arquivo inteiro antes de exibir o primeiro quadro.
        "-movflags", "+faststart",
        str(destino)], capture_output=True, text=True)
    if r.returncode != 0 or not destino.exists():
        print(f"      compressão falhou: {r.stderr[:110]}")
        return origem
    antes = origem.stat().st_size / 1024 / 1024
    depois = destino.stat().st_size / 1024 / 1024
    print(f"      {origem.name}: {antes:.1f} MB → {depois:.1f} MB")
    origem.unlink(missing_ok=True)
    return destino


def id_reel(url):
    m = re.search(r"/(?:reel|reels|p)/([A-Za-z0-9_-]+)", url or "")
    return m.group(1) if m else None


def baixar_reel(url):
    """Baixa o vídeo e a capa de um reel a partir do link.

    O Instagram não entrega nada para um servidor: pedir a página por curl
    devolve muro de login. Mas o endereço /embed/ renderiza normalmente num
    NAVEGADOR, e ali o <video> tem endereço direto do CDN.

    Então a extração acontece aqui, uma vez, na geração do site. Depois disso
    o arquivo é local: toca sozinho, carrega rápido e o site não faz nenhum
    pedido ao Instagram quando alguém visita.

    Se o navegador não estiver disponível, devolve nada e o cartão vira
    imagem estática. O site não quebra por causa disso.
    """
    rid = id_reel(url)
    if not rid:
        return None, None
    mp4 = SAIDA / "midia" / f"reel-{rid}.mp4"
    jpg = SAIDA / "midia" / f"reel-{rid}.jpg"
    pronto = mp4.with_name(mp4.stem + "-p.mp4")
    capa = None
    if jpg.exists():
        w = converter_webp(jpg, 400)
        capa = f"midia/{w.name}" if w else f"midia/{jpg.name}"
    if pronto.exists() and pronto.stat().st_size > 10000:
        return f"midia/{pronto.name}", capa
    if mp4.exists() and mp4.stat().st_size > 10000:
        return f"midia/{comprimir_video(mp4).name}", capa

    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("      (playwright não instalado: reel fica como cartão estático)")
        return None, None

    mp4.parent.mkdir(parents=True, exist_ok=True)
    try:
        with sync_playwright() as pw:
            nav = pw.chromium.launch()
            pag = nav.new_page(viewport={"width": 420, "height": 760})
            pag.goto(f"https://www.instagram.com/reel/{rid}/embed/",
                     wait_until="networkidle", timeout=45000)
            pag.wait_for_timeout(2500)
            info = pag.evaluate("""() => {
              const v = document.querySelector('video');
              return v ? {src: v.currentSrc || v.src, poster: v.poster} : null;
            }""")
            nav.close()
    except Exception as erro:
        print(f"      reel {rid}: não consegui abrir ({erro})")
        return None, None

    if not info or not info.get("src") or info["src"].startswith("blob:"):
        print(f"      reel {rid}: o Instagram não entregou o vídeo")
        return None, None

    if not baixar_foto(info["src"], mp4):
        print(f"      reel {rid}: falhou ao baixar o vídeo")
        return None, None
    if info.get("poster"):
        baixar_foto(info["poster"], jpg)
    final = comprimir_video(mp4)
    # A capa vem do Instagram em tamanho cheio. Sem converter, três posters
    # em JPEG pesavam mais que os três vídeos comprimidos juntos.
    capa = None
    if jpg.exists():
        w = converter_webp(jpg, 400)
        capa = f"midia/{w.name}" if w else f"midia/{jpg.name}"
    return f"midia/{final.name}", capa


def secao_videos(cfg, videos):
    if not videos:
        return ""
    cartoes = []
    for v in videos:
        vid = id_youtube(v["url"])
        capa = v.get("_capa")
        img = (f'<img src="{e(capa)}" alt="" loading="lazy" width="640" height="360">'
               if capa else '<div class="video-sem-capa"></div>')
        # Toca dentro do site — sair pro YouTube pra ver um vídeo de 40s é
        # exatamente o tipo de saída que perde a pessoa no meio da visita.
        cartoes.append(
            f'<button type="button" class="video-cartao" data-youtube="{e(vid or "")}">'
            f'<div class="video-capa">{img}<span class="video-play" aria-hidden="true">&#9654;</span></div>'
            f'<div class="video-tit">{e(v.get("titulo") or "Ver vídeo")}</div></button>')
    canal = cfg.get("youtube_url")
    botao = (f'<a class="secao-botao" href="{e(canal)}" target="_blank" rel="noopener">Ver o canal</a>'
             if canal else "")
    return f"""
    <section class="secao">
      <div class="secao-barra"><h2>{e(cfg.get('titulo_videos') or 'Vídeos em destaque')}</h2>{botao}</div>
      <div class="video-grade">{''.join(cartoes)}</div>
    </section>"""


def secao_reels(cfg, reels):
    if not reels:
        return ""
    cartoes = []
    for r in reels:
        capa = r.get("_capa")
        video = r.get("_video")
        if video:
            # Toca sozinho, sem som e em laço, como no Instagram. `preload`
            # nenhum e play só quando entra na tela: quatro vídeos carregando
            # de uma vez derrubariam a página.
            interno = ('<video class="reel-video" muted loop playsinline preload="none"'
                       + (f' poster="{e(capa)}"' if capa else "")
                       + f' data-src="{e(video)}" aria-label="'
                       + e(r.get("titulo") or "Reel") + '"></video>'
                       '<button type="button" class="reel-som" aria-label="Ligar o som">'
                       '<span aria-hidden="true">&#128263;</span></button>')
        elif capa:
            interno = f'<img src="{e(capa)}" alt="" loading="lazy" width="400" height="711">'
        else:
            interno = '<span class="reel-marca">Reel</span>'
        tit = ('<div class="reel-tit">' + e(r["titulo"]) + '</div>') if r.get("titulo") else ""
        alvo = ('<a class="reel-cartao" href="' + e(r["url"]) + '" target="_blank" rel="noopener">'
                if not video else '<div class="reel-cartao">')
        fim = "</a>" if not video else "</div>"
        play = "" if video else '<span class="video-play" aria-hidden="true">&#9654;</span>'
        link = ("" if not video else
                '<a class="reel-link" href="' + e(r["url"]) + '" target="_blank" rel="noopener">'
                'Ver no Instagram</a>')
        cartoes.append(alvo + '<div class="reel-capa">' + interno + play + '</div>' +
                       tit + link + fim)
    perfil = cfg.get("instagram_url")
    botao = (f'<a class="secao-botao" href="{e(perfil)}" target="_blank" rel="noopener">Ver perfil</a>'
             if perfil else "")
    return f"""
    <section class="secao">
      <div class="secao-barra">
        <div><h2>{e(cfg.get('titulo_reels') or 'Reels do Instagram')}</h2>
          <span>{e(cfg.get('sub_reels') or '')}</span></div>{botao}
      </div>
      <div class="reel-fita">{''.join(cartoes)}</div>
    </section>
<script>
(() => {{
  const videos = document.querySelectorAll('.reel-video');
  if (!videos.length) return;
  // Só carrega e toca o que está na tela. Sem isso, seis vídeos baixariam
  // juntos no carregamento e a página ficaria pesada à toa.
  const olho = new IntersectionObserver(entradas => {{
    entradas.forEach(en => {{
      const v = en.target;
      if (en.isIntersecting) {{
        if (!v.src && v.dataset.src) v.src = v.dataset.src;
        v.play().catch(() => {{}});
      }} else {{
        v.pause();
      }}
    }});
  }}, {{ threshold: 0.35 }});
  videos.forEach(v => olho.observe(v));

  // Respeita quem pediu menos animação no sistema.
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {{
    olho.disconnect();
    videos.forEach(v => {{ if (v.dataset.src) v.src = v.dataset.src; v.controls = true; }});
  }}

  document.querySelectorAll('.reel-som').forEach(b => {{
    b.addEventListener('click', ev => {{
      ev.preventDefault();
      const v = b.previousElementSibling;
      v.muted = !v.muted;
      b.querySelector('span').innerHTML = v.muted ? '&#128263;' : '&#128266;';
      b.setAttribute('aria-label', v.muted ? 'Ligar o som' : 'Desligar o som');
      if (!v.muted) v.play().catch(() => {{}});
    }});
  }});
}})();
</script>"""


# ── Montagem ───────────────────────────────────────────────────────────
def main():
    print("Lendo o banco…")
    cfgs = curl_json("configuracao?select=*&limit=1")
    cfg = cfgs[0] if cfgs else {}
    base = (cfg.get("site_url") or "https://maysimoveis.com").rstrip("/")

    imoveis = curl_json("imovel?select=*&publicar_no_site=eq.true&rascunho=eq.false&order=destaque.desc,codigo")
    if not imoveis:
        print("Nenhum imóvel publicado. Marque 'Publicar no site' em Imóveis, ou use o módulo Site e portais.")
    fotos = curl_json("imovel_foto?select=*&order=ordem")
    tipos_l = curl_json("tipo_imovel?select=id,nome,segmento")
    tipos = {t["id"]: t["nome"] for t in tipos_l}
    segmentos = {t["id"]: t.get("segmento") for t in tipos_l}
    bairros = {b["id"]: b["nome"] for b in curl_json("bairro?select=id,nome")}
    cidades_l = curl_json("cidade?select=id,nome,uf,regiao")
    cidades = {c["id"]: c["nome"] for c in cidades_l}
    regioes = {c["id"]: c.get("regiao") for c in cidades_l}
    subtipos = {t["id"]: t["nome"] for t in curl_json("subtipo_imovel?select=id,nome")}
    caracts = {c["id"]: c["nome"] for c in curl_json("caracteristica?select=id,nome")}
    vinculos = curl_json("imovel_caracteristica?select=imovel_id,caracteristica_id")

    empreendimentos = curl_json("empreendimento?select=*&ativo=eq.true&order=nome")
    if not isinstance(empreendimentos, list):
        print(f"Condomínios fora do ar nesta geração: {empreendimentos}")
        empreendimentos = []
    fotos_emp = curl_json("empreendimento_foto?select=*&order=ordem") if empreendimentos else []

    SAIDA.mkdir(parents=True, exist_ok=True)

    # Limpa ANTES de escrever de novo. Sem isso, um imóvel ou post excluído no
    # banco deixa a pasta antiga viva no site publicado: sem link nenhum
    # apontando para ela, mas alcançável por quem guardou o endereço e ainda
    # indexada pelo Google até ele perceber sozinho que sumiu. Foi exatamente
    # isso que aconteceu com os dois posts de blog excluídos em 16/08.
    #
    # Só as pastas 100% derivadas do banco. `fotos/` e `midia/` também têm
    # imagem baixada uma vez e reaproveitada; apagá-las forçaria rebaixar
    # tudo de novo a cada geração.
    import shutil
    for pasta in ("imovel", "blog", "condominio"):
        alvo = SAIDA / pasta
        if alvo.exists():
            shutil.rmtree(alvo)

    (SAIDA / "estilo.css").write_text(CSS.strip(), encoding="utf-8")
    logo_origem = AQUI.parent.parent / "marca" / "logo.png"
    if logo_origem.exists():
        shutil.copyfile(logo_origem, SAIDA / "logo.png")

    # Baixa as fotos uma vez e aponta o HTML para o arquivo local.
    print(f"Preparando fotos de {len(imoveis)} imóveis…")
    baixadas = 0
    for im in imoveis:
        im["_tipo"] = tipos.get(im.get("tipo_imovel_id"))
        im["_bairro"] = bairros.get(im.get("bairro_id"))
        im["_cidade"] = cidades.get(im.get("cidade_id"))
        im["_regiao"] = regioes.get(im.get("cidade_id"))
        im["_subtipo"] = subtipos.get(im.get("subtipo_imovel_id"))
        im["_segmento"] = segmentos.get(im.get("tipo_imovel_id"))
        im["_caracteristicas"] = [caracts[v["caracteristica_id"]] for v in vinculos
                                  if v["imovel_id"] == im["id"] and v["caracteristica_id"] in caracts]
        minhas = [f for f in fotos if f["imovel_id"] == im["id"]]
        minhas.sort(key=lambda f: (not f.get("capa"), f.get("ordem") or 0))
        # Baixa as DUAS versões de cada foto. A galeria da ficha usa a
        # miniatura; sem isso ela carrega 19 imagens de 1600px e a página vai
        # a 4,4MB com LCP de 9,5s. É o mesmo erro do sistema antigo, onde a
        # miniatura era gerada e nenhuma tela apontava pra ela.
        locais, minis = [], []
        for n, f in enumerate(minhas):
            nome = f"{im['codigo']}-{n}.jpg"
            if baixar_foto(f["url"], SAIDA / "fotos" / nome):
                locais.append(f"fotos/{nome}"); baixadas += 1
            tn = f"{im['codigo']}-{n}-p.jpg"
            if f.get("url_thumb") and baixar_foto(f["url_thumb"], SAIDA / "fotos" / tn):
                minis.append(f"fotos/{tn}")
            else:
                minis.append(locais[-1] if locais else None)
        im["_fotos"] = locais
        im["_miniaturas"] = minis
        im["_capa"] = locais[0] if locais else None
        im["_capa_thumb"] = minis[0] if minis else im["_capa"]

        # Três larguras em WebP para a capa, escolhidas pelo navegador.
        im["_capa_set"] = None
        if im["_capa"]:
            variantes = []
            for larg in (480, 800, 1400):
                v = converter_webp(SAIDA / im["_capa"], larg)
                if v:
                    variantes.append((f"fotos/{v.name}", larg))
            if variantes:
                im["_capa_set"] = variantes

    # Fotos do empreendimento — mesma lógica do imóvel, sem o srcset em três
    # larguras: a capa aqui não é LCP de página de venda de uma unidade só.
    if empreendimentos:
        print(f"Preparando fotos de {len(empreendimentos)} empreendimentos…")
    construtoras = {c["id"]: c["nome"] for c in curl_json("construtora?select=id,nome")} if empreendimentos else {}
    for emp in empreendimentos:
        emp["_bairro"] = bairros.get(emp.get("bairro_id"))
        emp["_cidade"] = cidades.get(emp.get("cidade_id"))
        emp["_construtora"] = construtoras.get(emp.get("construtora_id"))
        minhas = [f for f in fotos_emp if f["empreendimento_id"] == emp["id"]]
        minhas.sort(key=lambda f: (not f.get("capa"), f.get("ordem") or 0))
        locais = []
        for n, f in enumerate(minhas):
            nome = f"emp-{emp['id'][:8]}-{n}.jpg"
            if baixar_foto(f["url"], SAIDA / "fotos" / nome):
                locais.append(f"fotos/{nome}"); baixadas += 1
        emp["_fotos"] = locais
        emp["_capa"] = locais[0] if locais else None

    EMPREENDIMENTOS.clear()
    EMPREENDIMENTOS.extend(empreendimentos)

    # Recorte público do corretor — id, nome, foto, bio, creci. Nada
    # sensível: a view perfil_publico já filtra as colunas.
    corretores = curl_json("perfil_publico?select=*")
    CORRETORES.clear()
    CORRETORES.extend(corretores if isinstance(corretores, list) else [])

    posts = curl_json("post?select=*&publicado=eq.true&order=publicado_em.desc")

    midias = curl_json("midia_site?select=*&ativo=eq.true&order=ordem")
    videos = [m for m in midias if m["tipo"] == "video"]
    reels = [m for m in midias if m["tipo"] == "reel"]
    if videos or reels:
        print(f"Preparando {len(videos)} vídeos e {len(reels)} reels…")
    for v in videos:
        vid = id_youtube(v["url"])
        v["_capa"] = capa_youtube(vid) if vid else None
    for r in reels:
        r["_capa"] = None
        r["_video"] = None
        # Arquivo enviado por ele tem prioridade: é o caminho garantido.
        if r.get("video_url"):
            nome = f"reel-{r['id'][:8]}.mp4"
            if baixar_foto(r["video_url"], SAIDA / "midia" / nome):
                final = comprimir_video(SAIDA / "midia" / nome)
                r["_video"] = f"midia/{final.name}"
        if r.get("capa_url"):
            nome = f"reel-{r['id'][:8]}.jpg"
            if baixar_foto(r["capa_url"], SAIDA / "fotos" / nome):
                w = converter_webp(SAIDA / "fotos" / nome, 480)
                r["_capa"] = f"fotos/{w.name}" if w else f"fotos/{nome}"
        # Sem arquivo enviado, tenta extrair do link do Instagram.
        if not r["_video"]:
            v, c = baixar_reel(r["url"])
            if v:
                r["_video"] = v
                if c and not r["_capa"]:
                    r["_capa"] = c

    print("Escrevendo páginas…")
    # O menu grande sai daqui, e precisa estar pronto ANTES de qualquer página,
    # porque o cabeçalho de todas elas o desenha.
    montar_menu(imoveis)
    POSTS.clear()
    POSTS.extend(posts or [])

    lps = copiar_lps(cfg, base)

    (SAIDA / "favoritos.html").write_text(
        pagina_favoritos(cfg, imoveis, base), encoding="utf-8")

    (SAIDA / "index.html").write_text(
        pagina_home(cfg, imoveis, sorted(({"nome": b} for b in set(filter(None, (i.get("_bairro") for i in imoveis)))), key=lambda x: x["nome"]),
                    sorted(({"nome": t} for t in set(filter(None, (i.get("_tipo") for i in imoveis)))), key=lambda x: x["nome"]),
                    base, videos, reels), encoding="utf-8")

    for im in imoveis:
        if not im.get("slug"):
            continue
        pasta = SAIDA / "imovel" / im["slug"]
        pasta.mkdir(parents=True, exist_ok=True)
        # O caminho NÃO é alterado aqui. Alterar dentro do laço fazia o cartão
        # de "imóveis semelhantes" apontar pro lugar errado: quem já tinha sido
        # processado ganhava o prefixo, quem ainda não, não. Agora o prefixo
        # sai na hora de desenhar, por quem sabe em que pasta está.
        (pasta / "index.html").write_text(pagina_imovel(cfg, im, base, imoveis), encoding="utf-8")

    # Condomínios — cada um lista as unidades publicadas que apontam pra ele.
    for emp in empreendimentos:
        if not emp.get("slug"):
            continue
        unidades = [im for im in imoveis if im.get("empreendimento_id") == emp["id"]]
        pasta = SAIDA / "condominio" / emp["slug"]
        pasta.mkdir(parents=True, exist_ok=True)
        (pasta / "index.html").write_text(pagina_condominio(cfg, emp, unidades, base), encoding="utf-8")

    # Blog
    if posts:
        (SAIDA / "blog").mkdir(parents=True, exist_ok=True)
        (SAIDA / "blog" / "index.html").write_text(pagina_blog(cfg, posts, base), encoding="utf-8")
        for po in posts:
            if not po.get("slug"):
                continue
            pasta = SAIDA / "blog" / po["slug"]
            pasta.mkdir(parents=True, exist_ok=True)
            (pasta / "index.html").write_text(pagina_post(cfg, po, base), encoding="utf-8")

    agora = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    urls = [f"  <url><loc>{base}/</loc><lastmod>{agora}</lastmod><priority>1.0</priority></url>"]
    urls += [f"  <url><loc>{base}/imovel/{i['slug']}/</loc><lastmod>{agora}</lastmod><priority>0.8</priority></url>"
             for i in imoveis if i.get("slug")]
    urls += [f"  <url><loc>{base}/condominio/{c['slug']}/</loc><lastmod>{agora}</lastmod><priority>0.7</priority></url>"
             for c in empreendimentos if c.get("slug")]
    if posts:
        urls.append(f"  <url><loc>{base}/blog/</loc><lastmod>{agora}</lastmod><priority>0.7</priority></url>")
        urls += [f"  <url><loc>{base}/blog/{p['slug']}/</loc><lastmod>{p.get('publicado_em') or agora}</lastmod><priority>0.6</priority></url>"
                 for p in posts if p.get("slug")]
    (SAIDA / "sitemap.xml").write_text(
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
        + "\n".join(urls) + "\n</urlset>\n", encoding="utf-8")

    (SAIDA / "robots.txt").write_text(
        f"User-agent: *\nAllow: /\n\nSitemap: {base}/sitemap.xml\n", encoding="utf-8")

    total = sum(f.stat().st_size for f in SAIDA.rglob("*") if f.is_file())
    print(f"\nGerado em {SAIDA}")
    if lps:
        print(f"  {len(lps)} landing pages sob o domínio:")
        for nome, url in lps:
            print(f"    {url}")
    print(f"  {len(imoveis)} imóveis · {len(empreendimentos)} condomínios · {len(posts)} artigos · "
          f"{len(videos)} vídeos · {len(reels)} reels · {baixadas} fotos · {len(urls)} URLs no sitemap")
    print(f"  peso total: {total/1024/1024:.1f} MB")

    if "--abrir" in sys.argv:
        subprocess.run(["open", str(SAIDA / "index.html")])


if __name__ == "__main__":
    main()
