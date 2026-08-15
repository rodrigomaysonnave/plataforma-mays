# Plataforma Mays

Sistema de gestão imobiliária da Maysonnave Imóveis. Aplicação estática que
conversa direto com o Supabase; não há servidor próprio.

**Ambiente de teste.** O endereço é provisório e o domínio ainda não é o
definitivo.

A chave que aparece em `configuracao.js` é a chave *anon* do Supabase, pública
por desenho: sozinha ela não abre nada. Quem protege os dados é o RLS no banco,
tabela por tabela. Sem sessão válida, o visitante alcança apenas o que o site
público precisa: imóvel publicado, foto, blog e o formulário de contato.

Conta nova nasce sem aprovação (`perfil.aprovado = false`) e não enxerga nada
até um administrador liberar.
