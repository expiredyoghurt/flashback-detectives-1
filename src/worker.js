// Flashback Detectives API. Static files are served from ./public by Workers Assets.
// Secrets: admin_user, admin_password (fall back to the defaults below if unset).
const J = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { 'content-type': 'application/json' } });
const sha = async s => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))].map(b => b.toString(16).padStart(2, '0')).join('');
const same = (a, b) => { if (a.length !== b.length) return false; let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i); return r === 0; };
const STORIES = ['embedded', 'classical', 'linked'];

async function auth(req, env, role) {
  const t = (req.headers.get('authorization') || '').replace('Bearer ', '');
  if (!t) return null;
  const s = await env.DB.prepare('SELECT * FROM sessions WHERE token=?').bind(t).first();
  return s && s.role === role ? s : null;
}
async function mkSession(env, role, pupilId) {
  const token = crypto.randomUUID() + crypto.randomUUID();
  await env.DB.prepare('INSERT INTO sessions(token,role,pupil_id) VALUES(?,?,?)').bind(token, role, pupilId).run();
  return token;
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url), path = url.pathname, m = req.method;
    if (!path.startsWith('/api/')) return env.ASSETS ? env.ASSETS.fetch(req) : new Response('Not found', { status: 404 });
    const body = m === 'POST' ? await req.json().catch(() => ({})) : {};
    const clean = (s, n) => String(s || '').trim().slice(0, n);
    try {
      if (m === 'POST' && path === '/api/register') {
        const u = clean(body.username, 20).toLowerCase(), pin = clean(body.pin, 8);
        if (!/^[a-z0-9_.-]{3,20}$/.test(u)) return J({ error: 'Username: 3-20 letters or numbers' }, 400);
        if (!/^\d{4,8}$/.test(pin)) return J({ error: 'PIN must be 4-8 digits' }, 400);
        if (await env.DB.prepare('SELECT 1 FROM pupils WHERE username=?').bind(u).first()) return J({ error: 'That name is taken' }, 409);
        const r = await env.DB.prepare('INSERT INTO pupils(username,class,pin_hash) VALUES(?,?,?)').bind(u, clean(body.class, 20), await sha(u + ':' + pin)).run();
        return J({ token: await mkSession(env, 'pupil', r.meta.last_row_id), username: u });
      }
      if (m === 'POST' && path === '/api/login') {
        const u = clean(body.username, 20).toLowerCase();
        const p = await env.DB.prepare('SELECT * FROM pupils WHERE username=?').bind(u).first();
        if (!p || !same(p.pin_hash, await sha(u + ':' + clean(body.pin, 8)))) return J({ error: 'Wrong name or PIN' }, 401);
        return J({ token: await mkSession(env, 'pupil', p.id), username: u });
      }
      if (m === 'POST' && path === '/api/admin/login') {
        const au = env.admin_user || 'admin123', ap = env.admin_password || 'password123';
        const ok = same(await sha(clean(body.user, 100)), await sha(au)) && same(await sha(clean(body.password, 100)), await sha(ap));
        if (!ok) return J({ error: 'Wrong teacher login' }, 401);
        return J({ token: await mkSession(env, 'admin', null) });
      }
      if (path === '/api/log' || path === '/api/complete' || path === '/api/me') {
        const s = await auth(req, env, 'pupil');
        if (!s) return J({ error: 'Please log in' }, 401);
        if (path === '/api/me') {
          const c = await env.DB.prepare('SELECT story,MAX(points) points,MAX(perfect) perfect FROM completions WHERE pupil_id=? GROUP BY story').bind(s.pupil_id).all();
          const t = await env.DB.prepare('SELECT COUNT(*) n FROM attempts WHERE pupil_id=? AND retry=1').bind(s.pupil_id).first();
          return J({ completions: c.results, tries: t.n });
        }
        if (!STORIES.includes(body.story)) return J({ error: 'Bad story' }, 400);
        if (path === '/api/log') {
          await env.DB.prepare('INSERT INTO attempts(pupil_id,story,node,choice,rating,points,retry,ms) VALUES(?,?,?,?,?,?,?,?)')
            .bind(s.pupil_id, body.story, clean(body.node, 30), clean(body.choice, 80), clean(body.rating, 1), body.points | 0, body.retry ? 1 : 0, body.ms | 0).run();
          return J({ ok: 1 });
        }
        await env.DB.prepare('INSERT INTO completions(pupil_id,story,points,perfect,reflection) VALUES(?,?,?,?,?)')
          .bind(s.pupil_id, body.story, body.points | 0, body.perfect ? 1 : 0, JSON.stringify((body.reflection || []).slice(0, 6).map(x => clean(x, 600)))).run();
        return J({ ok: 1 });
      }
      if (path.startsWith('/api/admin/')) {
        if (!(await auth(req, env, 'admin'))) return J({ error: 'Teacher login required' }, 401);
        if (m === 'GET' && path === '/api/admin/summary') {
          const pupils = await env.DB.prepare(`SELECT p.username,p.class,
            (SELECT COUNT(DISTINCT story) FROM completions WHERE pupil_id=p.id) done,
            (SELECT COALESCE(SUM(pts),0) FROM (SELECT MAX(points) pts FROM completions WHERE pupil_id=p.id GROUP BY story)) points,
            (SELECT COUNT(*) FROM attempts WHERE pupil_id=p.id AND retry=1) tries,
            (SELECT MAX(ts) FROM attempts WHERE pupil_id=p.id) last_active FROM pupils p ORDER BY p.class,p.username`).all();
          const choices = await env.DB.prepare('SELECT story,node,choice,rating,COUNT(*) n,CAST(AVG(ms)/1000 AS INT) secs FROM attempts WHERE retry=0 GROUP BY story,node,choice,rating').all();
          const done = await env.DB.prepare('SELECT p.username,p.class,c.story,c.points,c.perfect,c.reflection,c.ts FROM completions c JOIN pupils p ON p.id=c.pupil_id ORDER BY c.ts DESC LIMIT 300').all();
          return J({ pupils: pupils.results, choices: choices.results, completions: done.results });
        }
        if (m === 'POST' && path === '/api/admin/reset-pin') {
          const u = clean(body.username, 20).toLowerCase(), pin = clean(body.pin, 8);
          if (!/^\d{4,8}$/.test(pin)) return J({ error: 'PIN must be 4-8 digits' }, 400);
          const r = await env.DB.prepare('UPDATE pupils SET pin_hash=? WHERE username=?').bind(await sha(u + ':' + pin), u).run();
          return J(r.meta.changes ? { ok: 1 } : { error: 'No such pupil' }, r.meta.changes ? 200 : 404);
        }
      }
      return J({ error: 'Not found' }, 404);
    } catch (e) { return J({ error: 'Server error' }, 500); }
  }
};
