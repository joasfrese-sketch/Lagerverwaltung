import QRCode from 'qrcode';
import { supabase, unwrap } from '../lib/supabase.js';
import { esc, toast } from '../lib/ui.js';

// Druckt QR-Etiketten auf DIN A4 (3 x 8 = 24 pro Seite, 64 x 33,5 mm)
export async function printLabels(ids) {
  const w = window.open('', '_blank');
  if (!w) return toast('Pop-up wurde blockiert.', 'error');
  w.document.write('<p style="font-family:sans-serif">Etiketten werden erstellt…</p>');
  try {
    let items = [];
    for (let i = 0; i < ids.length; i += 100) items = items.concat(unwrap(await supabase.from('items').select('id, name, room_id').in('id', ids.slice(i, i + 100))));
    items.sort((a, b) => a.name.localeCompare(b.name));
    const labels = [];
    for (const it of items) labels.push({ ...it, qr: await QRCode.toDataURL(`ITEM:${it.id}`, { width: 200, margin: 0 }) });
    const pages = [];
    for (let i = 0; i < labels.length; i += 24) pages.push(labels.slice(i, i + 24));
    w.document.open();
    w.document.write(`<html><head><title>Etiketten</title><style>
      @page{size:A4 portrait;margin:0} body{margin:0;font-family:sans-serif}
      .p{display:grid;grid-template-columns:repeat(3,64mm);grid-template-rows:repeat(8,33.5mm);gap:2mm 3mm;padding:8mm 6mm;box-sizing:border-box;width:210mm;height:297mm;page-break-after:always}
      .l{border:1px dashed #94a3b8;border-radius:3mm;padding:2mm;box-sizing:border-box;display:flex;align-items:center;gap:2mm;overflow:hidden}
      .l img{width:26mm;height:26mm}.l b{font-size:10pt;line-height:1.15;display:block}.l small{font-size:7.5pt;color:#334155}
    </style></head><body>${pages.map((p) => `<div class="p">${p.map((l) => `<div class="l"><img src="${l.qr}"><div><b>${esc(l.name)}</b><small>${esc(l.id)}<br>${esc(l.room_id)}</small></div></div>`).join('')}</div>`).join('')}
    <script>onload=()=>setTimeout(()=>print(),300)<\/script></body></html>`);
    w.document.close();
  } catch (e) { w.close(); toast(e.message, 'error'); }
}
