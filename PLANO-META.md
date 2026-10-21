# Plano: publicar imóvel no Facebook, Instagram e Marketplace

Pedido: marcar uma opção no imóvel e ele sair publicado no Meta sozinho.

## O que a Meta permite (e o que não)

- **Marketplace no perfil pessoal: não tem API.** A Meta não oferece forma
  oficial de um sistema criar anúncio no Marketplace. A publicação automática
  no perfil pessoal foi cortada em 2018. O programa de imóveis do Marketplace
  é fechado para grandes portais parceiros.
- **Robô no navegador (Playwright etc.) está descartado.** Viola os termos, e
  a Meta detecta e bloqueia o Marketplace ou a conta inteira.
- **Página do Facebook e Instagram profissional: tem API oficial** (Graph API).
  É por aí que dá para automatizar de verdade.

## Escopo escolhido: 1 + 3

### 1. Checkbox "Publicar no Facebook/Instagram" (automático)

Mesmo padrão do "Publicar no site" (`publicacao.js` → função `publicar-site`).

**Boa notícia: metade da infraestrutura já existe.** As funções
`webhook-meta-leads` e `puxar-leads-meta` (repositório `Claude`, pasta
`OS Mays-Imóveis/plataforma/edge-functions/`) já usam um app da Meta com
`META_PAGE_TOKEN`, `META_PAGE_ID` (padrão `468358409702679`) e
`META_GRAPH_VERSION` nos segredos do Supabase.

Passos:

1. **Banco** (nova migração em `OS Mays-Imóveis/plataforma/sql/`, próxima depois da `54_`):
   - `imovel.publicar_no_meta boolean default false`
   - `imovel.meta_post_id text`, `imovel.ig_media_id text`, `imovel.meta_publicado_em timestamptz`
   - Regra: `divulgacao_restrita` também impede `publicar_no_meta` (igual ao site).
2. **Ficha do imóvel** (`mod-imoveis.js`):
   - Checkbox `fMeta` ao lado de `fSite` (linha ~389), gravado em `salvar()` (linha ~646).
   - Mesma trava de divulgação restrita que já existe para o site (linha ~654).
   - Mostrar "Publicado no Facebook em DD/MM" com link quando `meta_post_id` existir.
3. **Função de borda nova `publicar-meta`** (pasta `edge-functions/publicar-meta/`):
   - Recebe `imovel_id`, lê imóvel + fotos com a service role.
   - Monta o texto: título, valor (`brl`), dormitórios, suítes, vagas, área,
     bairro, link da página do imóvel no site, chamada pro WhatsApp. Pode
     reaproveitar `gerar-texto-imovel` para a legenda.
   - **Facebook:** sobe até 10 fotos como `POST /{page_id}/photos?published=false`,
     depois `POST /{page_id}/feed` com `attached_media` e `message`.
   - **Instagram:** pegar o `instagram_business_account` da Página; carrossel
     com `POST /{ig_id}/media` (`is_carousel_item=true`) por foto, depois
     `media_type=CAROUSEL` e `POST /{ig_id}/media_publish`. As fotos precisam
     ser URL pública JPEG (usar as do site / storage).
   - Grava `meta_post_id`, `ig_media_id` e `meta_publicado_em`.
   - **Só publica uma vez:** se já tem `meta_post_id`, não reposta ao salvar de
     novo (senão cada edição vira post novo). Republicar fica num botão próprio.
   - Deploy: `python3 supa.py deploy publicar-meta edge-functions/publicar-meta/index.ts`
4. **Disparo:** em `salvar()`, se `publicar_no_meta` e ainda sem `meta_post_id`,
   chamar `supabaseClient.functions.invoke('publicar-meta', { body: { imovel_id } })`.
   Falhar no Meta não pode parecer que o salvamento falhou (mesma lógica do
   `avisar` em `publicacao.js`).

**Permissões do token** (conferir no Explorador da Graph API se o
`META_PAGE_TOKEN` atual já tem; o de leads provavelmente não tem todas):
`pages_manage_posts`, `pages_read_engagement`, `instagram_basic`,
`instagram_content_publish`, `business_management`. Se faltar, gerar um novo
token de Página de longa duração e trocar o segredo no Supabase.

Pré-requisito: Instagram da Maysonnave como conta **profissional** e
**ligado à Página** do Facebook.

### 3. Botão "Preparar para Marketplace" (semi-automático, perfil pessoal)

Na ficha do imóvel (`mod-imoveis.js`), ao lado do "Ver no site":

- Abre um painel com **título** (até ~100 caracteres), **preço**, **descrição**
  pronta, cada um com botão "Copiar".
- Botão **"Baixar fotos"**: baixa as fotos do imóvel (até 20, ordem da ficha).
- Botão **"Abrir Marketplace"**: abre
  `https://www.facebook.com/marketplace/create/rental` (aluguel) ou
  `https://www.facebook.com/marketplace/create/item` (venda), em nova aba.
- Corretor cola e publica em menos de um minuto, sem risco para a conta.
- Opcional: marcar `imovel.marketplace_em timestamptz` quando clicar, para
  saber o que já foi anunciado lá.

## Fora do escopo agora (ideia para depois)

**Catálogo de imóveis da Meta:** `gerar.py` gera também um feed XML/CSV dos
imóveis publicados. O Gerenciador de Comércio lê o feed e alimenta anúncios
dinâmicos de imóveis. Conversa com a skill `trafego-imoveis`.

## Como retomar no Mac

```bash
cd ~/caminho/para/plataforma-mays
git fetch origin
git checkout claude/meta-facebook-marketplace-integration-bock8l
claude
```

E dizer: "lê o PLANO-META.md e segue pela parte 3, depois a 1".
(A parte 3 não depende de nada da Meta e já entrega valor; a 1 depende de
conferir as permissões do token.)
