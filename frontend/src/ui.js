import { t } from './i18n.js';

export const $ = s => document.querySelector(s);

let tt;
// The toast uses the top layer (popover) so it also appears above open dialogs.
export function toast(msg, ms = 2600) {
  const t = $('#toast');
  t.textContent = msg; t.hidden = false;
  try { if (t.showPopover && !t.matches(':popover-open')) t.showPopover(); } catch {}
  clearTimeout(tt);
  tt = setTimeout(() => { try { if (t.hidePopover && t.matches(':popover-open')) t.hidePopover(); } catch {} t.hidden = true; }, ms);
}

function openPicker(title) {
  $('#picker-title').textContent = title;
  const box = $('#picker-list');
  box.textContent = '';
  if (!$('#picker').open) $('#picker').showModal();
  return box;
}

export function pickList(title, items) {
  const box = openPicker(title);
  if (!items.length) { box.textContent = t('picker.empty'); return; }
  for (const it of items) {
    const b = document.createElement('button');
    b.className = 'pick'; b.textContent = it.label;
    if (it.detail) { const s = document.createElement('small'); s.textContent = it.detail; b.append(s); }
    b.onclick = () => { $('#picker').close(); it.onPick && it.onPick(); };
    box.append(b);
  }
}

export function showInfo(title, text) {
  const box = openPicker(title);
  const pre = document.createElement('pre');
  pre.textContent = text;
  box.append(pre);
}
