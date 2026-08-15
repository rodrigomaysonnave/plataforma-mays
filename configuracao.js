// ══════════════════════════════════════════════════════════════════════
// Credenciais do Supabase da Plataforma.
//
// Único arquivo que muda entre ambientes. A chave anon é pública por desenho:
// ela não dá acesso a nada sozinha, quem protege é o RLS no banco.
//
// Projeto: Plataforma Mays (gwhwesvmqvxakvjtsrdn), região São Paulo.
// ══════════════════════════════════════════════════════════════════════

const SUPABASE_URL = 'https://gwhwesvmqvxakvjtsrdn.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd3aHdlc3ZtcXZ4YWt2anRzcmRuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY2MjI3MjMsImV4cCI6MjEwMjE5ODcyM30.-8YOH8sLts-lK-u6ALcbnlQHhVOsgZrKQWg5B3DhjRE';
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
