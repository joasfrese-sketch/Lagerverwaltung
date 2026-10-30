// Edge Function: Admin legt Benutzer an, ohne die eigene Session zu verlieren.
// Deploy: supabase functions deploy admin-create-user
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type' };

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const caller = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: req.headers.get('Authorization')! } } });
    const { data: { user } } = await caller.auth.getUser();
    if (!user) throw new Error('Nicht angemeldet');
    const { data: me } = await caller.from('profiles').select('role').eq('id', user.id).single();
    if (me?.role !== 'admin') throw new Error('Nur Administratoren');

    const { email, password, full_name, username, role = 'user', managed_room = null } = await req.json();
    const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name, username } });
    if (error) throw error;
    // Rolle setzen (Trigger erlaubt service_role)
    await admin.from('profiles').update({ role, managed_room: role === 'raum_manager' ? managed_room : null }).eq('id', data.user.id);
    return new Response(JSON.stringify({ id: data.user.id }), { headers: { ...cors, 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e.message || e) }), { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } });
  }
});
