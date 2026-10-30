// Edge Function: Anmeldung/Passwort-Reset per Benutzername, ohne E-Mail-Adressen preiszugeben.
// Deploy: supabase functions deploy username-auth --no-verify-jwt
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info' };
const json = (b: unknown) => new Response(JSON.stringify(b), { headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const { action, identifier, password, redirectTo } = await req.json();
    const url = Deno.env.get('SUPABASE_URL')!;
    const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
    const anon = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { auth: { persistSession: false } });

    let email = String(identifier || '').trim().toLowerCase();
    if (!email.includes('@')) {
      const { data } = await admin.rpc('email_for_username', { p_username: email });
      email = (data as string) || '';
    }
    if (action === 'reset') {
      if (email) await anon.auth.resetPasswordForEmail(email, { redirectTo });
      return json({ ok: true });
    }
    if (!email || !password) return json({ error: 'invalid' });
    const { data, error } = await anon.auth.signInWithPassword({ email, password });
    if (error || !data.session) return json({ error: /confirm/i.test(error?.message || '') ? 'not_confirmed' : 'invalid' });
    return json({ session: { access_token: data.session.access_token, refresh_token: data.session.refresh_token } });
  } catch (_e) {
    return json({ error: 'invalid' });
  }
});
