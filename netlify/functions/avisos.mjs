/* Resumen diario por correo (lunes a viernes, 07:00 UTC ≈ 8:00-9:00 en España) */
import { getStore } from '@netlify/blobs';
import { mailDigest } from './mail.mjs';

export const config = { schedule: '0 7 * * 1-5' };

const DAY_FMT = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' });

export default async () => {
  const db = getStore({ name: 'crm', consistency: 'strong' });
  const today = DAY_FMT.format(new Date());
  const { blobs } = await db.list({ prefix: 'c/' });
  const clients = (await Promise.all(blobs.map(b => db.get(b.key, { type: 'json' })))).filter(Boolean);
  const byOwner = new Map();
  for (const c of clients) if (c.owner) (byOwner.get(c.owner) || byOwner.set(c.owner, []).get(c.owner)).push(c);
  let sent = 0;
  for (const [owner, mine] of byOwner) {
    try { if (await mailDigest(db, owner, mine, today)) sent++; }
    catch (e) { console.error('Resumen fallido para', owner, e); }
  }
  console.log(`Resúmenes enviados: ${sent}`);
};
