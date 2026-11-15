// Edge Function: Admin legt Benutzer an, ohne die eigene Session zu verlieren.
// Deploy: supabase functions deploy admin-create-user
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// Die Anmeldebibliothek der App sendet zusätzlich „apikey“ und „x-client-info“; ohne diese Header bricht der Browser
// die Anfrage schon bei der Vorabprüfung ab („Failed to send a request to the Edge Function“).
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const caller = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } }, auth: { persistSession: false } });
    const { data: { user } } = await caller.auth.getUser();
    if (!user) throw new Error('Nicht angemeldet');
    const { data: me } = await caller.from('profiles').select('role').eq('id', user.id).single();
    if (me?.role !== 'admin') throw new Error('Nur Administratoren');

    const { email, password, full_name, username, role = 'user', managed_room = null } = await req.json();
    if (!['user', 'raum_manager', 'admin'].includes(role)) throw new Error('Ungültige Rolle');
    const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });

    // Die Datenbank verlangt bei jeder Neuanlage einen Einladungs-Code (Schutz der Registrierung). Supabase setzt eine
    // „vom Admin angelegt“-Markierung erst NACH dem Anlegen, deshalb würde die Prüfung sonst scheitern. Nur diese Funktion
    // besitzt den Service-Schlüssel: Sie erzeugt einen einmaligen, 10 Minuten gültigen Code und löscht ihn danach wieder.
    const code = crypto.randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase();
    const { error: ce } = await admin.from('invite_codes').insert({ code, note: 'Admin legt Konto an (automatisch)', max_uses: 1, expires_at: new Date(Date.now() + 10 * 60_000).toISOString(), created_by: user.id });
    if (ce) throw new Error('Einladungs-Code konnte nicht erzeugt werden: ' + ce.message);
    let data;
    try {
      const res = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name, username, invite_code: code }, app_metadata: { admin_created: true } });
      if (res.error) throw res.error;
      data = res.data;
    } finally {
      await admin.from('invite_codes').delete().eq('code', code);
    }
    // Rolle setzen (Trigger erlaubt service_role)
    await admin.from('profiles').update({ role, managed_room: role === 'raum_manager' ? managed_room : null }).eq('id', data.user.id);
    return new Response(JSON.stringify({ id: data.user.id }), { headers: { ...cors, 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e.message || e) }), { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } });
  }
});
