/* ============================================================
   Avisos por correo (usado por api.mjs y avisos.mjs)
   ------------------------------------------------------------
   Variables de entorno en Netlify:
     BREVO_API_KEY   clave de https://brevo.com (no necesita dominio propio)
       o RESEND_API_KEY (necesita dominio verificado)
     MAIL_FROM       (obligatoria) remitente verificado en el proveedor,
                     p. ej.  AppXpand <tucorreo@gmail.com>
     SITE_URL        (opcional) enlace a la plataforma; por defecto la URL de Netlify
   Si falta alguna, los avisos se omiten sin romper nada.
   ============================================================ */

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const siteUrl = () => (process.env.SITE_URL || process.env.URL || '').replace(/\/$/, '');

/* Proveedor: Brevo (BREVO_API_KEY, no exige dominio propio) o Resend (RESEND_API_KEY, exige dominio verificado) */
function parseFrom(from) {
  const m = /^(.*)<([^>]+)>\s*$/.exec(from);
  return m ? { name: m[1].trim().replace(/^"|"$/g, ''), email: m[2].trim() } : { name: '', email: from.trim() };
}
export async function sendMail({ to, subject, html }) {
  const brevo = (process.env.BREVO_API_KEY || '').trim(), resend = (process.env.RESEND_API_KEY || '').trim();
  const from = (process.env.MAIL_FROM || '').trim();
  if ((!brevo && !resend) || !from || !to) return false;
  try {
    let res;
    if (brevo) {
      const sender = parseFrom(from);
      res = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: { 'api-key': brevo, 'Content-Type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ sender: sender.name ? sender : { email: sender.email }, to: [{ email: to }], subject, htmlContent: html })
      });
    } else {
      res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + resend, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from, to: [to], subject, html })
      });
    }
    if (!res.ok) { console.error('Aviso por correo rechazado', res.status, (await res.text()).slice(0, 300)); return false; }
    return true;
  } catch (e) { console.error('Aviso por correo fallido', e); return false; }
}

/* Correo de una persona: el de «Mi perfil»; si no lo ha puesto, el de la ficha de «Equipo en la web».
   Devuelve '' si no hay o si ha desactivado los avisos. */
export async function recipientFor(db, id) {
  const pf = (await db.get('pf/' + id, { type: 'json' })) || {};
  if (pf.notify === false) return '';
  const tp = (await db.get('tp/' + id, { type: 'json' })) || {};
  return pf.email || tp.email || '';
}

const frame = (title, body) => `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#1c2430">
  <h2 style="margin:0 0 12px">${esc(title)}</h2>${body}
  ${siteUrl() ? `<p style="margin-top:20px"><a href="${esc(siteUrl())}" style="background:#2563eb;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none">Abrir la plataforma</a></p>` : ''}
  <p style="color:#8a93a0;font-size:12px;margin-top:24px">Puedes cambiar el correo o desactivar estos avisos en «Mi perfil».</p></div>`;

const line = c => `<li style="margin:4px 0"><strong>${esc(c.business)}</strong>${c.contact ? ' · ' + esc(c.contact) : ''}${c.phone ? ' · ' + esc(c.phone) : ''}${c.next ? ` <span style="color:#8a93a0">(${esc(c.next)})</span>` : ''}</li>`;
const section = (label, list) => list.length ? `<h3 style="margin:16px 0 4px;font-size:15px">${esc(label)} (${list.length})</h3><ul style="padding-left:18px;margin:0">${list.map(line).join('')}</ul>` : '';

/* Aviso inmediato: cliente nuevo desde la web */
export async function mailNewLead(db, ownerId, client) {
  const to = await recipientFor(db, ownerId);
  if (!to) return false;
  return sendMail({
    to,
    subject: `Nuevo cliente desde la web: ${client.business}`,
    html: frame('Tienes un cliente nuevo', `<ul style="padding-left:18px">${line(client)}</ul>${client.notes ? `<p>${esc(client.notes)}</p>` : ''}`)
  });
}

/* Resumen diario de una persona: citas y seguimientos de hoy, vencidos y nuevos sin abrir */
export async function mailDigest(db, ownerId, mine, today) {
  const open = mine.filter(c => ['nuevo', 'contactado', 'reunion', 'propuesta'].includes(c.status));
  const citas = open.filter(c => c.status === 'reunion' && c.next === today);
  const hoy = open.filter(c => c.status !== 'reunion' && c.next === today);
  const vencidos = open.filter(c => c.next && c.next < today);
  const nuevos = open.filter(c => c.webNew);
  if (!citas.length && !hoy.length && !vencidos.length && !nuevos.length) return false;
  const to = await recipientFor(db, ownerId);
  if (!to) return false;
  const html = frame('Tu resumen de hoy',
    section('Citas de hoy', citas) + section('Seguimientos de hoy', hoy) +
    section('Seguimientos vencidos', vencidos) + section('Clientes nuevos sin abrir', nuevos));
  return sendMail({ to, subject: `Resumen de hoy: ${citas.length + hoy.length} para hoy, ${vencidos.length} vencidos, ${nuevos.length} nuevos`, html });
}
