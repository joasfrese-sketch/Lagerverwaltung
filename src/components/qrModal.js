import QRCode from 'qrcode';
import { esc, toast, openModal } from '../lib/ui.js';

export async function qrModal(item) {
  const url = await QRCode.toDataURL(`ITEM:${item.id}`, { width: 320, margin: 1 });
  const { el } = openModal(`
    <div class="text-center"><h3 class="mb-1 text-lg font-bold">${esc(item.name)}</h3><div class="mb-2 font-mono text-xs text-slate-500">${esc(item.id)}</div>
    <img src="${url}" alt="QR" class="mx-auto h-56 w-56"><div class="mt-3 flex gap-2"><button id="pr" class="btn-primary flex-1">🖨️ Etikett drucken</button><button data-close class="btn-ghost flex-1">Schließen</button></div></div>`);
  el.querySelector('#pr').onclick = () => {
    const w = window.open('', '_blank');
    if (!w) return toast('Pop-up wurde blockiert.', 'error');
    w.document.write(`<html><head><title>Etikett</title><style>body{font-family:sans-serif;margin:0}.l{width:64mm;height:33.5mm;border:1px dashed #999;display:flex;align-items:center;gap:3mm;padding:2mm;box-sizing:border-box}img{width:26mm;height:26mm}b{font-size:11pt}small{font-size:8pt;color:#444}</style></head><body><div class="l"><img src="${url}"><div><b>${esc(item.name)}</b><br><small>${esc(item.id)}<br>${esc(item.room_id)}</small></div></div><script>onload=()=>print()<\/script></body></html>`);
    w.document.close();
  };
}