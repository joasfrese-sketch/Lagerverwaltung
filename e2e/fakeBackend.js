// Minimaler Ersatz für Supabase in den End-to-End-Tests: liefert Testdaten mit einfachen Filtern und
// protokolliert alle Schreib-Aufrufe (rpc, insert, update). Die Geschäftsregeln der Datenbank werden
// in supabase/tests geprüft – hier geht es um die Verdrahtung der Oberfläche.
export const FAKE_URL = 'http://fake.supabase.test';
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
export const UID = '00000000-0000-0000-0000-0000000000a1';

const hours = (h) => new Date(Date.now() + h * 3600e3).toISOString();

export function makeData() {
  const items = [
    { id: 'T-CAM', name: 'Kamera', room_id: 'Technik', category: 'Foto', item_type: 'standard', status: 'active', stock_quantity: 1, min_stock: 0, photos: [], accessories: ['Akku'], rented_now: true, rented_until: hours(20), low_stock: false, inspection_due: false, shelf: 'A', compartment: '1', created_at: hours(-500) },
    { id: 'T-DRILL', name: 'Bohrmaschine', room_id: 'Technik', category: 'Werkzeug', item_type: 'standard', status: 'active', stock_quantity: 1, min_stock: 0, photos: [], accessories: [], rented_now: false, low_stock: false, inspection_due: false, created_at: hours(-400) },
    { id: 'K-TOPF', name: 'Topf', room_id: 'Küche', category: 'Geschirr', item_type: 'standard', status: 'maintenance', stock_quantity: 1, min_stock: 0, photos: [], accessories: [], rented_now: false, low_stock: false, inspection_due: false, created_at: hours(-300) },
    { id: 'K-PAPIER', name: 'Küchenrolle', room_id: 'Küche', category: 'Verbrauch', item_type: 'consumable', status: 'active', stock_quantity: 2, min_stock: 4, photos: [], accessories: [], rented_now: false, low_stock: true, inspection_due: false, created_at: hours(-200) },
  ];
  const rooms = [
    { id: 'Technik', name: 'Technik', icon: '🔌', description: 'Kameras & Kabel', sort_order: 1 },
    { id: 'Küche', name: 'Küche', icon: '🍳', description: 'Töpfe', sort_order: 2 },
    { id: 'Büro', name: 'Büro', icon: '🏢', description: 'Papier', sort_order: 3 },
  ];
  const rental = { id: 'r1', item_id: 'T-CAM', start_at: hours(-30), end_at: hours(20), project: 'Fest', borrower_id: UID, status: 'active', damage_photos: [], items: { name: 'Kamera', accessories: ['Akku'], room_id: 'Technik' } };
  return {
    profiles: [{ id: UID, email: 'admin@test.local', username: 'ada', full_name: 'Ada Admin', role: 'admin', managed_room: null }],
    public_profiles: [{ id: UID, username: 'ada', full_name: 'Ada Admin' }],
    rooms, items, catalog_items: items,
    rental_calendar: [{ id: 'r1', item_id: 'T-CAM', item_name: 'Kamera', room_id: 'Technik', start_at: hours(-30), end_at: hours(20), status: 'active', overdue: false, borrower_id: UID, borrower_name: 'Ada Admin', project: 'Fest' }],
    user_settings: [{ user_id: UID, prefs: { profile_done: true, tour_done: true } }],
    rentals: [rental], notifications: [], extension_requests: [], waitlist: [], permissions: [], invite_codes: [], inventory_counts: [], activity_log: [], chat_messages: [], chats: [{ id: 'c1', type: 'global' }], chat_members: [], push_subscriptions: [], feedback: [], backups: [], client_errors: [],
  };
}

const SKIP = new Set(['select', 'order', 'limit', 'offset', 'or', 'and']);
function matches(row, params) {
  for (const [k, v] of params) {
    if (SKIP.has(k)) continue;
    const [op, ...rest] = v.split('.'); const val = rest.join('.');
    const cell = row[k];
    if (op === 'eq' && String(cell) !== val) return false;
    if (op === 'neq' && String(cell) === val) return false;
    if (op === 'is' && !(val === 'null' ? cell == null : String(cell) === val)) return false;
    if (op === 'in') { const set = val.replace(/^\(|\)$/g, '').split(',').map((x) => x.replace(/^"|"$/g, '')); if (!set.includes(String(cell))) return false; }
    if (op === 'gte' && !(String(cell) >= val)) return false;
    if (op === 'gt' && !(String(cell) > val)) return false;
    if (op === 'lte' && !(String(cell) <= val)) return false;
    if (op === 'lt' && !(String(cell) < val)) return false;
  }
  return true;
}

/** Installiert den Fake auf einer Playwright-Seite. rpcHandlers: { name: (args) => antwort | { __error: 'Text' } } */
export async function installFake(context, { data = makeData(), rpcHandlers = {} } = {}) {
  const calls = { rpc: [], writes: [] };
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const jwt = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: UID, exp, aal: 'aal1', amr: [{ method: 'password', timestamp: 1 }], role: 'authenticated' })}.sig`;
  const user = { id: UID, email: 'admin@test.local', aud: 'authenticated', role: 'authenticated', factors: [], app_metadata: {}, user_metadata: {} };
  await context.addInitScript(([k, v]) => { try { localStorage.setItem(k, v); } catch { /* egal */ } }, ['sb-fake-auth-token', JSON.stringify({ access_token: jwt, refresh_token: 'r', expires_at: exp, expires_in: 3600, token_type: 'bearer', user })]);
  await context.route(`${FAKE_URL}/**`, async (route) => {
    const req = route.request(); const u = new URL(req.url());
    if (u.pathname.startsWith('/auth/v1/user')) return route.fulfill({ json: user });
    if (u.pathname.startsWith('/auth/v1/')) return route.fulfill({ json: {} });
    if (u.pathname.startsWith('/rest/v1/rpc/')) {
      const name = u.pathname.split('/').pop(); let args = {}; try { args = req.postDataJSON() || {}; } catch { /* leer */ }
      calls.rpc.push({ name, args });
      const h = rpcHandlers[name]; const out = h ? h(args) : null;
      if (out && out.__error) return route.fulfill({ status: 400, json: { message: out.__error } });
      return route.fulfill({ json: out ?? null });
    }
    if (u.pathname.startsWith('/rest/v1/')) {
      const table = u.pathname.split('/')[3]; const rows = data[table];
      if (!rows) return route.fulfill({ status: 404, json: { message: 'unbekannte Tabelle ' + table } });
      if (req.method() !== 'GET' && req.method() !== 'HEAD') { calls.writes.push({ table, method: req.method(), body: req.postData() }); return route.fulfill({ status: 201, json: [] }); }
      let out = rows.filter((r) => matches(r, u.searchParams));
      const total = out.length;
      const order = u.searchParams.get('order');
      if (order) { const [col, dir] = order.split(',')[0].split('.'); out = [...out].sort((a, b) => String(a[col] ?? '').localeCompare(String(b[col] ?? ''), 'de') * (dir === 'desc' ? -1 : 1)); }
      const lim = Number(u.searchParams.get('limit')); if (lim) out = out.slice(0, lim);
      const single = (req.headers().accept || '').includes('vnd.pgrst.object');
      return route.fulfill({ status: 200, headers: { 'content-range': `0-${Math.max(out.length - 1, 0)}/${total}`, 'access-control-expose-headers': 'content-range' }, json: single ? out[0] ?? null : out });
    }
    return route.fulfill({ status: 404, body: '' });
  });
  return { calls, data };
}
