// Both dashboard data and visit navigation must use the same backend.

// The public site's own Visit Copilot server (Vultr, see deploy/vultr). Change this if it moves.
export const HOSTED_SERVER = 'https://visit.mending.fit';

export function visitConnection(href, storage) {
  const url = new URL(href), params = url.searchParams;
  const get = key => { try { return storage?.getItem(key); } catch { return null; } };
  const set = (key, value) => { try { storage?.setItem(key, value); } catch {} };
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  const standalone = local && !url.pathname.startsWith('/pt/');
  // The public site (mending.fit on Vercel) is only the dashboard; its data, search and the visit app
  // come from the hosted Visit Copilot server. Served from that server itself (/pt/), use the same origin.
  const hosted = !local && !url.pathname.startsWith('/pt/');
  const fallback = standalone ? `${url.protocol}//${url.hostname}:${url.port === '8000' ? '8001' : '8000'}`
    : hosted ? HOSTED_SERVER : '';
  const explicitVisit = params.get('visit_url') || get('visitCopilot.visitUrl');
  const server = (params.get('server') ?? get('visitCopilot.server') ?? (explicitVisit ? new URL(explicitVisit, url).origin : fallback)).replace(/\/$/, '');
  const patientId = params.get('patient_id') || get('visitCopilot.patientId') || 'demo-patient';
  if (params.has('patient_id')) set('visitCopilot.patientId', patientId);
  if (params.has('server')) set('visitCopilot.server', server);
  if (params.has('visit_url')) set('visitCopilot.visitUrl', explicitVisit);
  return { patientId, server, visitUrl: explicitVisit || `${server}/`, api: `${server}/api/patients/${encodeURIComponent(patientId)}` };
}
