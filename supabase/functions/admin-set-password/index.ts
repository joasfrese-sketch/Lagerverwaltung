// Edge Function: Administrator setzt das Passwort einer anderen Person neu.
// Prüft die Anmeldung und die Administrator-Rolle des Aufrufers, setzt das Passwort und schreibt einen Protokolleintrag
// (ohne das Passwort). Deploy: supabase functions deploy admin-set-password
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const TRIVIAL = ['12345678', '123456789', '1234567890', '0123456789', 'password', 'passwort'];

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const caller = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } }, auth: { persistSession: false } });
    const { data: { user } } = await caller.auth.getUser();
    if (!user) throw new Error('Nicht angemeldet');
    const { data: me } = await caller.from('profiles').select('role').eq('id', user.id).single();
    if (me?.role !== 'admin') throw new Error('Nur Administratoren');

    const { user_id, password } = await req.json();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(user_id ?? ''))) throw new Error('Ungültiger Benutzer');
    if (typeof password !== 'string' || password.length < 8) throw new Error('Das Passwort muss mindestens 8 Zeichen haben.');
    if (password.length > 72) throw new Error('Das Passwort darf höchstens 72 Zeichen haben.');
    if (TRIVIAL.includes(password.toLowerCase())) throw new Error('Dieses Passwort ist zu einfach zu erraten.');

    const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
    const { data: target } = await admin.from('profiles').select('full_name, username').eq('id', user_id).maybeSingle();
    if (!target) throw new Error('Benutzer nicht gefunden');
    const { error } = await admin.auth.admin.updateUserById(user_id, { password });
    if (error) throw error;
    await admin.from('activity_log').insert({ actor_id: user.id, subject_id: user_id, action: 'PASSWORT', item_name: target.full_name || target.username, details: { note: 'Passwort vom Administrator neu gesetzt' } });
    return new Response(JSON.stringify({ ok: true }), { headers: { ...cors, 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e.message || e) }), { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } });
  }
});
