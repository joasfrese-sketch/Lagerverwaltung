import { supabase } from './supabase.js';
import { state } from '../state.js';

// Ungelesenes, getrennt nach Chats (Anzahl Nachrichten je Chat) und übrigen Mitteilungen.
// Chat-Mitteilungen werden pro Chat gebündelt; gezählt werden die Nachrichten seit dem letzten Lesen.
export async function countUnreadMessages(chatIds) {
  const out = {};
  if (!chatIds.length) return out;
  const { data: mine } = await supabase.from('chat_members').select('chat_id, last_read_at').eq('user_id', state.user.id).in('chat_id', chatIds);
  await Promise.all((mine || []).map(async (m) => {
    const { count } = await supabase.from('chat_messages').select('id', { count: 'exact', head: true })
      .eq('chat_id', m.chat_id).neq('sender_id', state.user.id).gt('created_at', m.last_read_at);
    out[m.chat_id] = count || 0;
  }));
  return out;
}

export async function unreadSummary() {
  const [chatN, otherN] = await Promise.all([
    supabase.from('notifications').select('link').eq('type', 'chat').is('read_at', null),
    supabase.from('notifications').select('id', { count: 'exact', head: true }).neq('type', 'chat').is('read_at', null),
  ]);
  const chatIds = [...new Set((chatN.data || []).map((n) => (n.link || '').replace('chat:', '')).filter(Boolean))];
  const perChat = await countUnreadMessages(chatIds);
  const messages = chatIds.reduce((sum, id) => sum + (perChat[id] || 1), 0);
  const notifications = otherN.count || 0;
  return { chats: chatIds.length, perChat, messages, notifications, total: messages + notifications };
}
