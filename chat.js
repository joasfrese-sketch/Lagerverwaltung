import { supabase, unwrap } from '../lib/supabase.js';
import { esc, toast, openModal, busy } from '../lib/ui.js';
import { state, GLOBAL_CHAT_ID } from '../state.js';

const S = { tab: 'chats', chats: [], names: {}, unread: new Set(), current: null, channel: null, root: null };
const ICONS = { overdue: '⏰', due_soon: '⏳', rental: '📦', return: '✅', damage: '🛠️', stock: '📉', chat: '💬', info: 'ℹ️', system: '⚙️' };

export async function render(el) {
  S.root = el; S.current = null;
  el.innerHTML = `
    <div class="mb-3 flex items-center gap-2"><h1 class="mr-auto text-2xl font-bold">Chat</h1>
      <div class="flex rounded-xl bg-slate-200 p-0.5 text-sm font-semibold">
        <button id="tChats" class="rounded-lg px-3 py-1.5">💬 Chats</button>
        <button id="tNotif" class="rounded-lg px-3 py-1.5">🔔 Mitteilungen</button></div></div>
    <div id="body"></div>`;
  el.querySelector('#tChats').onclick = () => { S.tab = 'chats'; draw(); };
  el.querySelector('#tNotif').onclick = () => { S.tab = 'notif'; draw(); };
  S.channel = supabase.channel('chat-live')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages' }, (p) => {
      if (S.tab === 'chats' && S.current === p.new.chat_id) { loadMessages(); markRead(S.current); }
      else if (S.tab === 'chats') loadList();
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications', filter: `user_id=eq.${state.user.id}` }, () => { if (S.tab === 'notif') drawNotifs(); else loadList(); })
    .subscribe();
  await draw();
}

export function unmount() { if (S.channel) { supabase.removeChannel(S.channel); S.channel = null; } }

async function draw() {
  S.root.querySelector('#tChats').className = `rounded-lg px-3 py-1.5 ${S.tab === 'chats' ? 'bg-white shadow' : 'text-slate-600'}`;
  S.root.querySelector('#tNotif').className = `rounded-lg px-3 py-1.5 ${S.tab === 'notif' ? 'bg-white shadow' : 'text-slate-600'}`;
  if (S.tab === 'notif') return drawNotifs();
  S.root.querySelector('#body').innerHTML = `
    <div class="md:grid md:grid-cols-[16rem_1fr] md:gap-3">
      <div id="list" class="${S.current ? 'hidden md:block' : ''}"></div>
      <div id="pane" class="${S.current ? '' : 'hidden md:block'}"></div></div>`;
  await loadList();
  if (S.current) drawPane();
  else S.root.querySelector('#pane').innerHTML = '<div class="card hidden py-16 text-center text-sm text-slate-400 md:block">Wähle einen Chat.</div>';
}

async function loadList() {
  const list = S.root.querySelector('#list');
  if (!list) return;
  try {
    S.chats = unwrap(await supabase.from('chats').select('*'));
    const members = unwrap(await supabase.from('chat_members').select('chat_id, user_id'));
    const ids = [...new Set(members.map((m) => m.user_id))];
    unwrap(await supabase.from('public_profiles').select('id, full_name, username').in('id', ids)).forEach((p) => (S.names[p.id] = p.full_name || p.username));
    const un = unwrap(await supabase.from('notifications').select('link').eq('type', 'chat').is('read_at', null));
    S.unread = new Set(un.map((n) => (n.link || '').replace('chat:', '')));
    S.chats.forEach((c) => {
      if (c.type === 'global') c.title = '🌐 Alle';
      else if (c.type === 'group') c.title = '👥 ' + (c.name || 'Gruppe');
      else { const o = members.find((m) => m.chat_id === c.id && m.user_id !== state.user.id); c.title = '👤 ' + (S.names[o?.user_id] || 'Direktchat'); }
    });
    S.chats.sort((a, b) => (a.type === 'global' ? -1 : b.type === 'global' ? 1 : a.title.localeCompare(b.title)));
    list.innerHTML = `<button id="newChat" class="btn-primary mb-2 w-full">+ Neuer Chat</button><div class="space-y-1.5">
      ${S.chats.map((c) => `<button data-chat="${esc(c.id)}" class="card flex w-full items-center justify-between !p-3 text-left text-sm font-semibold ${S.current === c.id ? 'ring-2 ring-brand-500' : ''}">${esc(c.title)}${S.unread.has(c.id) ? '<span class="h-2.5 w-2.5 rounded-full bg-red-500"></span>' : ''}</button>`).join('')}</div>`;
    list.querySelector('#newChat').onclick = newChatModal;
    list.querySelectorAll('[data-chat]').forEach((b) => (b.onclick = () => openChat(b.dataset.chat)));
  } catch (e) { toast(e.message, 'error'); }
}

export function openChatById(id) { S.tab = 'chats'; S.current = id; }

async function openChat(id) {
  S.current = id;
  S.root.querySelector('#list').classList.add('hidden', 'md:block');
  S.root.querySelector('#pane').classList.remove('hidden');
  drawPane();
  markRead(id);
}

function drawPane() {
  const c = S.chats.find((x) => x.id === S.current);
  const pane = S.root.querySelector('#pane');
  pane.innerHTML = `
    <div class="card flex h-[70vh] flex-col !p-0 md:h-[34rem]">
      <div class="flex items-center gap-2 border-b p-3"><button id="back" class="btn-ghost !px-2.5 !py-1 md:hidden">←</button><b class="text-sm">${esc(c ? c.title : 'Chat')}</b></div>
      <div id="msgs" class="flex-1 space-y-2 overflow-y-auto p-3"></div>
      <form id="send" class="flex gap-2 border-t p-3"><input id="msg" class="input" placeholder="Nachricht schreiben…" maxlength="4000" required autocomplete="off"><button class="btn-primary">Senden</button></form>
    </div>`;
  pane.querySelector('#back').onclick = () => { S.current = null; draw(); };
  pane.querySelector('#send').onsubmit = (e) => {
    e.preventDefault();
    const input = pane.querySelector('#msg'); const body = input.value.trim();
    if (!body) return;
    busy(e.target.querySelector('button'), async () => {
      unwrap(await supabase.from('chat_messages').insert({ chat_id: S.current, sender_id: state.user.id, body }));
      input.value = ''; await loadMessages();
    });
  };
  loadMessages();
}

async function loadMessages() {
  const box = S.root.querySelector('#msgs');
  if (!box || !S.current) return;
  try {
    const msgs = unwrap(await supabase.from('chat_messages').select('*').eq('chat_id', S.current).order('created_at', { ascending: false }).limit(200));
    const unknown = [...new Set(msgs.map((m) => m.sender_id))].filter((id) => !S.names[id]);
    if (unknown.length) unwrap(await supabase.from('public_profiles').select('id, full_name, username').in('id', unknown)).forEach((p) => (S.names[p.id] = p.full_name || p.username));
    box.innerHTML = msgs.reverse().map((m) => {
      const mine = m.sender_id === state.user.id;
      const t = new Date(m.created_at).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
      return `<div class="flex flex-col ${mine ? 'items-end' : 'items-start'}"><div class="text-[10px] text-slate-400">${mine ? 'Du' : esc(S.names[m.sender_id] || 'Unbekannt')} · ${t}</div>
        <div class="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-sm ${mine ? 'rounded-tr-none bg-brand-600 text-white' : 'rounded-tl-none bg-slate-100'}">${esc(m.body)}</div></div>`;
    }).join('') || '<p class="py-8 text-center text-sm italic text-slate-400">Noch keine Nachrichten.</p>';
    box.scrollTop = box.scrollHeight;
  } catch (e) { toast(e.message, 'error'); }
}

async function markRead(chatId) {
  await supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('link', 'chat:' + chatId).is('read_at', null);
  if (chatId !== GLOBAL_CHAT_ID) await supabase.from('chat_members').update({ last_read_at: new Date().toISOString() }).eq('chat_id', chatId).eq('user_id', state.user.id);
  window.dispatchEvent(new Event('notifications-changed'));
}

async function newChatModal() {
  const people = unwrap(await supabase.from('public_profiles').select('id, full_name, username').neq('id', state.user.id).order('full_name'));
  const { el, close } = openModal(`
    <h3 class="mb-1 text-lg font-bold">Neuer Chat</h3><p class="mb-3 text-xs text-slate-500">Eine Person wählen = Direktchat. Mehrere Personen + Name = Gruppe.</p>
    <form id="f" class="space-y-3"><input name="name" class="input" placeholder="Gruppenname (nur bei Gruppen)">
      <div class="max-h-56 space-y-1 overflow-y-auto rounded-xl bg-slate-50 p-2 text-sm">${people.map((p) => `<label class="flex items-center gap-2"><input type="checkbox" name="u" value="${esc(p.id)}"> ${esc(p.full_name || p.username)} <span class="text-xs text-slate-400">@${esc(p.username)}</span></label>`).join('') || '<i class="text-slate-400">Keine weiteren Nutzer.</i>'}</div>
      <div class="flex justify-end gap-2"><button type="button" data-close class="btn-ghost">Abbrechen</button><button class="btn-primary">Erstellen</button></div></form>`);
  el.querySelector('#f').onsubmit = (e) => {
    e.preventDefault();
    const f = new FormData(e.target); const users = f.getAll('u'); const name = (f.get('name') || '').trim();
    busy(e.target.querySelector('.btn-primary'), async () => {
      if (!users.length) throw new Error('Bitte mindestens eine Person wählen.');
      let id;
      if (users.length === 1 && !name) id = unwrap(await supabase.rpc('get_or_create_direct_chat', { p_other: users[0] }));
      else { if (!name) throw new Error('Für Gruppen bitte einen Namen angeben.'); id = unwrap(await supabase.rpc('create_group_chat', { p_name: name, p_members: users })); }
      close(); S.current = id; await draw(); markRead(id);
    });
  };
}

// ----- Benachrichtigungszentrale -----
async function drawNotifs() {
  const body = S.root.querySelector('#body');
  try {
    const list = unwrap(await supabase.from('notifications').select('*').order('created_at', { ascending: false }).limit(60));
    body.innerHTML = `<div class="mb-2 flex justify-end"><button id="allRead" class="btn-ghost !py-1 !text-xs">Alle als gelesen markieren</button></div>
      <div class="space-y-2">${list.map((n) => `<button data-n="${esc(n.id)}" class="card flex w-full gap-3 !p-3 text-left ${n.read_at ? 'opacity-60' : 'border-brand-500/40 bg-brand-50/50'}">
        <span class="text-xl">${ICONS[n.type] || 'ℹ️'}</span><span class="min-w-0 flex-1"><b class="block text-sm">${esc(n.title)}</b><span class="block text-xs text-slate-600">${esc(n.body)}</span>
        <span class="text-[10px] text-slate-400">${new Date(n.created_at).toLocaleString('de-DE')}</span></span></button>`).join('') || '<p class="card py-10 text-center text-sm italic text-slate-400">Keine Mitteilungen.</p>'}</div>`;
    body.querySelector('#allRead').onclick = async () => {
      await supabase.from('notifications').update({ read_at: new Date().toISOString() }).is('read_at', null);
      window.dispatchEvent(new Event('notifications-changed')); drawNotifs();
    };
    body.querySelectorAll('[data-n]').forEach((b) => (b.onclick = async () => {
      const n = list.find((x) => x.id === b.dataset.n);
      if (!n.read_at) await supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', n.id);
      window.dispatchEvent(new Event('notifications-changed'));
      const link = n.link || '';
      if (link.startsWith('chat:')) { S.tab = 'chats'; S.current = link.slice(5); draw(); }
      else if (link.startsWith('rental:')) location.hash = '#/ich';
      else if (link.startsWith('item:')) location.hash = '#/katalog';
      else drawNotifs();
    }));
  } catch (e) { body.innerHTML = `<div class="card text-red-600">${esc(e.message)}</div>`; }
}
