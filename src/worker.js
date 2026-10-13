// Flashback Detectives v1.3 API. Static files come from ./public (Workers Assets).
// Secrets: admin_user, admin_password (defaults admin123 / password123 if unset).
import D from './stories.json';
const J = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { 'content-type': 'application/json' } });
const sha = async s => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))].map(b => b.toString(16).padStart(2, '0')).join('');
const same = (a, b) => { if (a.length !== b.length) return false; let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i); return r === 0; };
const cl = (s, n) => String(s ?? '').trim().slice(0, n);
const pubNode = (S, k) => { const n = S.n[k]; return { id: k, q: n.q, h: n.h, o: n.o.map((o, i) => ({ i, l: o.l, t: o.x ? o.t : '' })) }; };
const TYPES = Object.fromEntries(Object.entries(D.types).map(([k, v]) => [k, { kind: v.kind, checks: v.checks, rq: v.rq, map: v.map }]));

async function auth(req, env, role) {
  const t = (req.headers.get('authorization') || '').replace('Bearer ', '');
  if (!t) return null;
  return env.DB.prepare("SELECT * FROM sessions WHERE token=? AND role=? AND created>datetime('now',?)").bind(t, role, role === 'admin' ? '-4 hours' : '-12 hours').first();
}
async function mk(env, role, pid) {
  await env.DB.prepare("DELETE FROM sessions WHERE created<datetime('now','-1 day')").run();
  const token = crypto.randomUUID() + crypto.randomUUID();
  await env.DB.prepare('INSERT INTO sessions(token,role,pupil_id) VALUES(?,?,?)').bind(token, role, pid).run();
  return token;
}
// Rate limiting: 5 bad logins per username, 40 per IP, 8 per IP for teacher login, in 10 minutes
async function blocked(env, k, max) { const r = await env.DB.prepare('SELECT * FROM fails WHERE k=?').bind(k).first(); return !!r && Date.now() - r.ts < 6e5 && r.n >= max; }
async function fail(env, k) { const r = await env.DB.prepare('SELECT * FROM fails WHERE k=?').bind(k).first(); const n = r && Date.now() - r.ts < 6e5 ? r.n + 1 : 1; await env.DB.prepare('INSERT OR REPLACE INTO fails(k,n,ts) VALUES(?,?,?)').bind(k, n, Date.now()).run(); }
const clear = (env, k) => env.DB.prepare('DELETE FROM fails WHERE k=?').bind(k).run();
async function getRun(env, s, id) { const r = await env.DB.prepare('SELECT * FROM runs WHERE id=? AND pupil_id=? AND done=0').bind(id | 0, s.pupil_id).first(); if (r) r.st = JSON.parse(r.state); return r; }
const saveRun = (env, r) => env.DB.prepare('UPDATE runs SET state=? WHERE id=?').bind(JSON.stringify(r.st), r.id).run();

export default {
  async fetch(req, env) {
    const url = new URL(req.url), path = url.pathname, m = req.method, ip = req.headers.get('cf-connecting-ip') || 'x';
    if (!path.startsWith('/api/')) return env.ASSETS ? env.ASSETS.fetch(req) : new Response('Not found', { status: 404 });
    const b = m === 'POST' ? await req.json().catch(() => ({})) : {};
    const DB = env.DB;
    try {
      if (m === 'POST' && path === '/api/register') {
        const u = cl(b.username, 20).toLowerCase(), pin = cl(b.pin, 8);
        if (!/^[a-z0-9_.-]{3,20}$/.test(u)) return J({ error: 'Username: 3-20 letters or numbers' }, 400);
        if (!/^\d{4,8}$/.test(pin)) return J({ error: 'PIN must be 4-8 digits' }, 400);
        if (await DB.prepare('SELECT 1 FROM pupils WHERE username=?').bind(u).first()) return J({ error: 'That name is taken' }, 409);
        const r = await DB.prepare('INSERT INTO pupils(username,class,pin_hash) VALUES(?,?,?)').bind(u, cl(b.class, 20), await sha(u + ':' + pin)).run();
        return J({ token: await mk(env, 'pupil', r.meta.last_row_id), username: u });
      }
      if (m === 'POST' && path === '/api/login') {
        const u = cl(b.username, 20).toLowerCase();
        if (await blocked(env, 'u:' + u, 5) || await blocked(env, 'i:' + ip, 40)) return J({ error: 'Too many tries. Wait 10 minutes.' }, 429);
        const p = await DB.prepare('SELECT * FROM pupils WHERE username=?').bind(u).first();
        if (!p || !same(p.pin_hash, await sha(u + ':' + cl(b.pin, 8)))) { await fail(env, 'u:' + u); await fail(env, 'i:' + ip); return J({ error: 'Wrong name or PIN' }, 401); }
        await clear(env, 'u:' + u);
        return J({ token: await mk(env, 'pupil', p.id), username: u });
      }
      if (m === 'POST' && path === '/api/admin/login') {
        if (await blocked(env, 'a:' + ip, 8)) return J({ error: 'Too many tries. Wait 10 minutes.' }, 429);
        const au = env.admin_user || 'admin123', ap = env.admin_password || 'password123';
        if (!(same(await sha(cl(b.user, 100)), await sha(au)) && same(await sha(cl(b.password, 100)), await sha(ap)))) { await fail(env, 'a:' + ip); return J({ error: 'Wrong teacher login' }, 401); }
        await clear(env, 'a:' + ip);
        return J({ token: await mk(env, 'admin', null) });
      }
      /* ---------- pupil ---------- */
      if (path.startsWith('/api/') && !path.startsWith('/api/admin/')) {
        const s = await auth(req, env, 'pupil');
        if (!s) return J({ error: 'Please log in' }, 401);
        const pid = s.pupil_id;
        const me = await DB.prepare('SELECT class FROM pupils WHERE id=?').bind(pid).first();
        if (m === 'GET' && path === '/api/stories') {
          const a = await DB.prepare('SELECT story FROM assignments WHERE class=?').bind(me.class).all();
          return J({ types: TYPES, stories: Object.entries(D.stories).map(([id, s]) => ({ id, type: s.type, title: s.title, ic: s.ic, blurb: s.blurb })), assigned: a.results.map(x => x.story) });
        }
        if (m === 'GET' && path === '/api/me') {
          const c = (await DB.prepare('SELECT story,MAX(points) points,MAX(perfect) perfect FROM completions WHERE pupil_id=? GROUP BY story').bind(pid).all()).results;
          const n = async (sql, ...a) => (await DB.prepare(sql).bind(pid, ...a).first()).n;
          const g = bt => n("SELECT COUNT(*) n FROM picks WHERE pupil_id=? AND bt=? AND r='g'", bt);
          const tries = await n('SELECT COUNT(*) n FROM picks WHERE pupil_id=? AND tries>0');
          const bg = { first: c.length >= 1, explorer: c.length >= 3, placer: await g('placer') >= 3, content: await g('content') >= 3, length: await g('length') >= 3, architect: c.some(x => x.perfect), persist: tries >= 1 };
          const w = (await DB.prepare('SELECT story,text,comment,ts FROM writings WHERE pupil_id=? ORDER BY id DESC LIMIT 20').bind(pid).all()).results;
          const so = await DB.prepare('SELECT MAX(score) s,MAX(total) t FROM sorts WHERE pupil_id=?').bind(pid).first();
          return J({ completions: c, badges: bg, writings: w, sort: so });
        }
        if (m === 'POST' && path === '/api/run/start') {
          const S = D.stories[b.story]; if (!S) return J({ error: 'Bad story' }, 400);
          const r = await DB.prepare('INSERT INTO runs(pupil_id,story,state) VALUES(?,?,?)').bind(pid, b.story, JSON.stringify({ cur: 'open', pts: 0, perfect: true, story: [], tn: {}, pend: null })).run();
          return J({ run: r.meta.last_row_id, node: pubNode(S, 'open') });
        }
        if (path.startsWith('/api/run/')) {
          const r = await getRun(env, s, b.run); if (!r) return J({ error: 'Run not found' }, 404);
          const S = D.stories[r.story], st = r.st;
          if (path === '/api/run/choice') {
            const node = S.n[st.cur], o = node && node.o[b.idx | 0]; if (!o) return J({ error: 'Bad choice' }, 400);
            const tries = st.tn[st.cur] || 0; let p = o.p;
            if (tries > 0) p = Math.round(p / 2); // partial credit after a retry
            if (o.rt) { st.tn[st.cur] = tries + 1; st.pend = null; } else st.pend = { p, r: o.r, t: o.nt ? '' : o.t, n: o.n };
            await DB.prepare('INSERT INTO picks(pupil_id,run,story,node,idx,r,p,bt,tries,ms) VALUES(?,?,?,?,?,?,?,?,?,?)').bind(pid, r.id, r.story, st.cur, b.idx | 0, o.r, o.rt ? 0 : p, o.b || null, tries, Math.min(b.ms | 0, 6e5)).run();
            await saveRun(env, r);
            return J({ r: o.r, p: o.rt ? 0 : p, f: o.f, tip: o.tip, retry: !!o.rt, half: tries > 0 && !o.rt && o.p > 0 });
          }
          if (path === '/api/run/retry') { st.tn[st.cur] = (st.tn[st.cur] || 0) + 1; st.pend = null; await saveRun(env, r); return J({ node: pubNode(S, st.cur) }); }
          if (path === '/api/run/advance') {
            if (!st.pend) return J({ error: 'Pick first' }, 400);
            if (st.pend.t) st.story.push(st.pend.t);
            st.pts += st.pend.p; if (st.pend.r !== 'g' || (st.tn[st.cur] || 0) > 0) st.perfect = false;
            st.cur = st.pend.n; st.pend = null; await saveRun(env, r);
            return J(st.cur === 'sum' ? { done: true, story: st.story, pts: st.pts, perfect: st.perfect } : { node: pubNode(S, st.cur), story: st.story, pts: st.pts });
          }
          if (path === '/api/run/finish') {
            if (st.cur !== 'sum') return J({ error: 'Story not finished' }, 400);
            await DB.prepare('INSERT INTO completions(pupil_id,story,points,perfect,reflection) VALUES(?,?,?,?,?)').bind(pid, r.story, st.pts, st.perfect ? 1 : 0, JSON.stringify((b.reflection || []).slice(0, 6).map(x => cl(x, 600)))).run();
            if (cl(b.writing, 2000)) await DB.prepare('INSERT INTO writings(pupil_id,story,text,checks) VALUES(?,?,?,?)').bind(pid, r.story, cl(b.writing, 2000), JSON.stringify((b.checks || []).slice(0, 6).map(x => x | 0))).run();
            await DB.prepare('UPDATE runs SET done=1 WHERE id=?').bind(r.id).run();
            return J({ ok: 1, points: st.pts, perfect: st.perfect });
          }
        }
        if (m === 'GET' && path === '/api/sort') return J({ items: D.sort.map((x, i) => ({ i, x: x.x })) });
        if (m === 'POST' && path === '/api/sort') {
          const a = Array.isArray(b.answers) ? b.answers : [];
          const res = D.sort.map((x, i) => ({ ok: a[i] === x.a, a: x.a, e: x.e }));
          const sc = res.filter(x => x.ok).length;
          await DB.prepare('INSERT INTO sorts(pupil_id,score,total) VALUES(?,?,?)').bind(pid, sc, res.length).run();
          return J({ results: res, score: sc, total: res.length });
        }
        return J({ error: 'Not found' }, 404);
      }
      /* ---------- teacher ---------- */
      if (!(await auth(req, env, 'admin'))) return J({ error: 'Teacher login required' }, 401);
      const lab = (st, nd, i) => { try { return D.stories[st].n[nd].o[i].l; } catch (e) { return '?'; } };
      if (m === 'GET' && path === '/api/admin/summary') {
        const all = async q => (await DB.prepare(q).all()).results;
        const pupils = await all(`SELECT p.username,p.class,
          (SELECT COUNT(DISTINCT story) FROM completions WHERE pupil_id=p.id) done,
          (SELECT COALESCE(SUM(m),0) FROM (SELECT MAX(points) m FROM completions WHERE pupil_id=p.id GROUP BY story)) points,
          (SELECT COUNT(*) FROM picks WHERE pupil_id=p.id AND tries>0) tries,
          (SELECT MAX(ts) FROM picks WHERE pupil_id=p.id) last_active FROM pupils p ORDER BY p.class,p.username`);
        const ch = (await all("SELECT story,node,idx,r,COUNT(*) n,CAST(AVG(ms)/1000 AS INT) secs FROM picks GROUP BY story,node,idx,r")).map(x => ({ ...x, choice: lab(x.story, x.node, x.idx) }));
        return J({ pupils, choices: ch,
          completions: await all('SELECT p.username,p.class,c.story,c.points,c.perfect,c.reflection,c.ts FROM completions c JOIN pupils p ON p.id=c.pupil_id ORDER BY c.ts DESC LIMIT 300'),
          writings: await all('SELECT w.id,p.username,p.class,w.story,w.text,w.checks,w.comment,w.ts FROM writings w JOIN pupils p ON p.id=w.pupil_id ORDER BY w.id DESC LIMIT 300'),
          assignments: await all('SELECT class,story FROM assignments'),
          stories: Object.entries(D.stories).map(([id, s]) => ({ id, title: s.title, type: s.type })), types: TYPES });
      }
      if (m === 'GET' && path === '/api/admin/pupil') {
        const p = await DB.prepare('SELECT id,username,class,created FROM pupils WHERE username=?').bind(cl(url.searchParams.get('u'), 20).toLowerCase()).first();
        if (!p) return J({ error: 'No such pupil' }, 404);
        const all = async (q) => (await DB.prepare(q).bind(p.id).all()).results;
        const picks = (await all('SELECT story,node,idx,r,p,tries,ms,ts FROM picks WHERE pupil_id=? ORDER BY id DESC LIMIT 150')).map(x => ({ ...x, choice: lab(x.story, x.node, x.idx) }));
        return J({ pupil: p, picks, completions: await all('SELECT story,points,perfect,reflection,ts FROM completions WHERE pupil_id=? ORDER BY id DESC'), writings: await all('SELECT id,story,text,comment,ts FROM writings WHERE pupil_id=? ORDER BY id DESC'), sorts: await all('SELECT score,total,ts FROM sorts WHERE pupil_id=? ORDER BY id DESC LIMIT 10') });
      }
      if (m === 'POST' && path === '/api/admin/reset-pin') {
        const u = cl(b.username, 20).toLowerCase(), pin = cl(b.pin, 8);
        if (!/^\d{4,8}$/.test(pin)) return J({ error: 'PIN must be 4-8 digits' }, 400);
        const r = await DB.prepare('UPDATE pupils SET pin_hash=? WHERE username=?').bind(await sha(u + ':' + pin), u).run();
        return r.meta.changes ? J({ ok: 1 }) : J({ error: 'No such pupil' }, 404);
      }
      if (m === 'POST' && path === '/api/admin/delete-pupil') {
        const p = await DB.prepare('SELECT id FROM pupils WHERE username=?').bind(cl(b.username, 20).toLowerCase()).first();
        if (!p) return J({ error: 'No such pupil' }, 404);
        for (const t of ['picks', 'runs', 'completions', 'writings', 'sorts', 'sessions']) await DB.prepare(`DELETE FROM ${t} WHERE pupil_id=?`).bind(p.id).run();
        await DB.prepare('DELETE FROM pupils WHERE id=?').bind(p.id).run();
        return J({ ok: 1 });
      }
      if (m === 'POST' && path === '/api/admin/bulk') {
        const cls = cl(b.class, 20), out = [];
        for (const raw of (Array.isArray(b.names) ? b.names : []).slice(0, 60)) {
          let base = cl(raw, 40).toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 16); if (base.length < 3) continue;
          let u = base, k = 1; while (await DB.prepare('SELECT 1 FROM pupils WHERE username=?').bind(u).first()) u = base + (++k);
          const pin = String(1000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 9000));
          await DB.prepare('INSERT INTO pupils(username,class,pin_hash) VALUES(?,?,?)').bind(u, cls, await sha(u + ':' + pin)).run();
          out.push({ name: cl(raw, 40), username: u, pin, class: cls });
        }
        return J({ created: out });
      }
      if (m === 'POST' && path === '/api/admin/comment') { await DB.prepare('UPDATE writings SET comment=? WHERE id=?').bind(cl(b.comment, 500), b.id | 0).run(); return J({ ok: 1 }); }
      if (m === 'POST' && path === '/api/admin/assign') {
        if (!D.stories[b.story]) return J({ error: 'Bad story' }, 400);
        await (b.on ? DB.prepare('INSERT OR IGNORE INTO assignments(class,story) VALUES(?,?)') : DB.prepare('DELETE FROM assignments WHERE class=? AND story=?')).bind(cl(b.class, 20), b.story).run();
        return J({ ok: 1 });
      }
      return J({ error: 'Not found' }, 404);
    } catch (e) { return J({ error: 'Server error' }, 500); }
  }
};
