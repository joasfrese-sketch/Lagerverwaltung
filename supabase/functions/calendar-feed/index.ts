// Edge Function: abonnierbarer Kalender (iCal) für Google, Outlook, Apple.
// Aufruf: GET /functions/v1/calendar-feed?token=<persönlicher Schlüssel>
// Der Schlüssel wird in der App unter Kalender → „Abonnieren" erzeugt und kann dort zurückgesetzt werden.
// Deploy: supabase functions deploy calendar-feed --no-verify-jwt
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { buildIcs, rentalToEvent } from '../_shared/ics.js';

Deno.serve(async (req) => {
  const token = new URL(req.url).searchParams.get('token') || '';
  if (token.length < 32) return new Response('Ungültiger Kalender-Link', { status: 404 });
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  const { data: tok } = await admin.from('calendar_feeds').select('user_id').eq('token', token).maybeSingle();
  if (!tok) return new Response('Kalender-Link ungültig oder zurückgesetzt', { status: 404 });
  const { data, error } = await admin.rpc('calendar_feed_events', { p_token: token });
  if (error) return new Response('Fehler beim Laden', { status: 500 });
  const body = buildIcs((data || []).map(rentalToEvent), { name: 'Lager Pro – Ausleihen' });
  return new Response(body, {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'inline; filename="lager-pro.ics"',
      'Cache-Control': 'private, max-age=900',
    },
  });
});
