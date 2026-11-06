import { supabase } from './supabase.js';

export const BUCKET = 'item-photos';
export const MAX_PHOTOS = 5;
const MARKER = `/object/public/${BUCKET}/`;

// Vorschaubild (Liste) = gleicher Pfad mit _t vor .jpg
export const thumbUrl = (u) => (typeof u === 'string' ? u.replace(/\.jpg(\?.*)?$/, '_t.jpg') : u);

async function loadBitmap(file) {
  try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); }
  catch {
    return new Promise((resolve, reject) => {
      const img = new Image(); const url = URL.createObjectURL(file);
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = () => reject(new Error('Bild konnte nicht gelesen werden (Format nicht unterstützt?)'));
      img.src = url;
    });
  }
}

function scaled(src, max) {
  const w = src.width; const h = src.height; const s = Math.min(1, max / Math.max(w, h));
  const c = document.createElement('canvas'); c.width = Math.round(w * s); c.height = Math.round(h * s);
  c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
  return c;
}
const jpeg = (canvas, q) => new Promise((res) => canvas.toBlob(res, 'image/jpeg', q));

// Verkleinert im Browser: Vollbild (max. 1280 px) und Vorschau (max. 360 px)
export async function prepare(file) {
  if (!file.type.startsWith('image/')) throw new Error(`${file.name}: keine Bilddatei`);
  const bmp = await loadBitmap(file);
  const big = scaled(bmp, 1280);
  let q = 0.82; let full = await jpeg(big, q);
  while (full.size > 450 * 1024 && q > 0.5) { q -= 0.1; full = await jpeg(big, q); }
  const thumb = await jpeg(scaled(bmp, 360), 0.75);
  if (bmp.close) bmp.close();
  return { full, thumb };
}

export function pathsFor(url) {
  const i = String(url).indexOf(MARKER);
  if (i < 0) return [];
  const path = decodeURIComponent(url.slice(i + MARKER.length).split('?')[0]);
  return [path, path.replace(/\.jpg$/, '_t.jpg')];
}

export async function removePhotos(urls) {
  const paths = (urls || []).flatMap(pathsFor);
  if (!paths.length) return;
  try { await supabase.storage.from(BUCKET).remove(paths); } catch { /* Aufräumen ist best-effort */ }
}

export async function uploadPhoto(item, file) {
  const { full, thumb } = await prepare(file);
  const base = `${item.photo_key}/${crypto.randomUUID()}`;
  const put = (path, blob) => supabase.storage.from(BUCKET).upload(path, blob, { contentType: 'image/jpeg', cacheControl: '31536000' });
  let r = await put(`${base}.jpg`, full);
  if (r.error) throw new Error(`Upload fehlgeschlagen: ${r.error.message}`);
  r = await put(`${base}_t.jpg`, thumb);
  if (r.error) { await supabase.storage.from(BUCKET).remove([`${base}.jpg`]); throw new Error(`Upload fehlgeschlagen: ${r.error.message}`); }
  return supabase.storage.from(BUCKET).getPublicUrl(`${base}.jpg`).data.publicUrl;
}
