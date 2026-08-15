/* ===== Flipdeck · ausgelagerter Inline-Block 1 ===== */

"use strict";

/* ===== SUPABASE & AUTH — ZUERST initialisieren, damit der Login auch dann
   funktioniert, wenn später im Skript ein Fehler auftritt. ===== */
const SUPABASE_URL = 'https://xkfotgarjhoxarjlohaj.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhrZm90Z2FyamhveGFyamxvaGFqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIxODI5NjgsImV4cCI6MjA5Nzc1ODk2OH0.nVl5j4LI4GmIDFDGvZJVMcT3CKFc-DMEpWWFjmsjHsM';
let sb = null;
try { sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY); }
catch(e){ console.error("Supabase konnte nicht geladen werden (Internet/CDN?):", e); }
/* Passwort-Reset: klickt jemand den E-Mail-Link, meldet Supabase PASSWORD_RECOVERY -> Neu-Passwort-Fenster. */
try{ if(sb && sb.auth && sb.auth.onAuthStateChange){ sb.auth.onAuthStateChange(function(event){ if(event==="PASSWORD_RECOVERY"){ try{ hideSplash(); }catch(e){} try{ openSetNewPassword(); }catch(e){} } }); } }catch(e){}

const MAIL_DOMAIN  = 'flipgrid.app';
const OWNER_EMAILS = ['admin@flipgrid.app', 'noah@flipgrid.app', 'noah1g@flipgrid.app'];
const toEmail = u => u.includes('@') ? u : `${u}@${MAIL_DOMAIN}`;
const roleFor = email => OWNER_EMAILS.includes((email||'').toLowerCase()) ? 'owner' : 'user';
/* =====================================================================
   0 · DATA-SERVICE  ·  Mock-Provider (localStorage) · SUPABASE-READY
   ---------------------------------------------------------------------
   Die App spricht NIE direkt mit localStorage, sondern ausschließlich
   über DB.*  ->  ein einziger Seam, den du später gegen Supabase tauschst.

   >>> LIVE-BETA: SO HÄNGST DU SUPABASE DRAN
   1) supabase-js laden + Client:
        const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
   2) Den SupabaseProvider unten (siehe Block am Dateiende) ausfüllen –
      die Methodennamen sind identisch zu DB.
   3) Unten  window.DB = SupabaseProvider  setzen (oder DB ersetzen).
   4) Bilder: statt Base64 in Supabase Storage hochladen (uploadImage-Stub)
      und nur die zurückgegebene URL im Datensatz speichern.
   Hinweis: Lese-Methoden befüllen beim Login In-Memory-Arrays; Speichern
   ist „fire-and-forget". Für echte async-Calls einfach await ergänzen.
   ===================================================================== */
const Store = (() => {
  let mem = {}, ok = false;
  try { localStorage.setItem("__t","1"); localStorage.removeItem("__t"); ok = true; } catch(e){ ok = false; }
  return {
    get(k){ try { return ok ? localStorage.getItem(k) : (k in mem ? mem[k] : null); } catch(e){ return k in mem ? mem[k] : null; } },
    set(k,v){ try { ok ? localStorage.setItem(k,v) : (mem[k]=v); } catch(e){ mem[k]=v; } },
    del(k){ try { ok ? localStorage.removeItem(k) : delete mem[k]; } catch(e){ delete mem[k]; } }
  };
})();
let currentUser = null;
const uKey = base => `fg_${base}_${currentUser ? currentUser.username : "guest"}`;
/* Anzeigename: der gewählte Username (neue Konten) oder ersatzweise das Mail-Präfix (Alt-Konten). */
function displayName(){ return (currentUser && (currentUser.uname || (currentUser.username||"").split("@")[0])) || ""; }
/* Läuft die App in der neuen Desktop-Shell? Dann Titelleisten-Optik anpassen (Platz für Fenster-Buttons). */
try{ if(/FlipdeckShell/i.test(navigator.userAgent)) document.documentElement.classList.add("is-electron"); }catch(e){}

/* =====================================================================
   SUPABASE-HELFER · Daten liegen in EINER Tabelle 'app_state'
   (user_id, key, value) — value ist JSON. RLS sorgt dafür, dass jeder
   User NUR seine eigenen Zeilen sieht/schreibt. dbLoad gibt 'undefined'
   zurück, wenn es noch keine Zeile gibt (= allererster Login).
   ===================================================================== */
/* Optimistic-Lock gegen stilles Überschreiben zwischen zwei Geräten:
   Pro Key merken wir die Server-Version (updated_at) und schreiben nur, wenn sie
   sich seit dem Laden nicht geändert hat. Fehlt die Spalte (SQL noch nicht drin),
   fällt alles automatisch aufs bisherige Verhalten zurück. */
let _ver = {};              // key -> zuletzt gesehene updated_at
let _hasUpdatedAt = null;   // null=unbekannt, true/false nach erster Prüfung
let _conflictPending = {};  // key -> value, die wegen Konflikt nicht geschrieben wurden

async function dbLoad(key){
  try{
    const { data, error } = await sb.from('app_state').select('value,updated_at').eq('key', key).maybeSingle();
    if(error){
      _hasUpdatedAt = false;   // evtl. fehlt updated_at -> ohne die Spalte erneut (Alt-Verhalten)
      const r = await sb.from('app_state').select('value').eq('key', key).maybeSingle();
      if(r.error){ console.warn('[db load]', key, r.error.message); return undefined; }
      return r.data ? r.data.value : undefined;
    }
    _hasUpdatedAt = true;
    if(data){ _ver[key] = data.updated_at; return data.value; }
    return undefined;
  }catch(e){ console.warn('[db load crash]', key, e); return undefined; }
}
/* Fehler-Klartext für einen fehlgeschlagenen Speichervorgang.
   Unterscheidet abgelaufene Sitzung / Rechteproblem / sonstiges. */
function classifySaveError(error){
  const msg  = ((error && (error.message||error.msg||error.hint)) || '')+'';
  const code = ((error && (error.code||error.status)) || '')+'';
  const low  = msg.toLowerCase();
  if(low.includes('jwt') || low.includes('expired') || low.includes('token') || low.includes('not authenticated') || code==='401')
    return 'Sitzung abgelaufen — deine letzte Änderung wurde NICHT gespeichert. Bitte neu anmelden.';
  if(low.includes('row-level') || low.includes('policy') || low.includes('permission') || code==='42501' || code==='403')
    return 'Rechteproblem — deine letzte Änderung wurde NICHT gespeichert. Bitte neu anmelden.';
  return 'Speichern fehlgeschlagen — deine letzte Änderung wurde evtl. NICHT gespeichert.' + (msg ? ' ('+msg+')' : '');
}
function _colMissing(error){ return /updated_at|column/.test(((error&&error.message)||'').toLowerCase()); }
function _plainUpsert(key, value){   // Alt-Verhalten ohne Versions-Prüfung
  return sb.from('app_state').upsert({ user_id: currentUser.id, key, value }, { onConflict: 'user_id,key' })
    .then(({error})=>{ if(error){ console.warn('[db save]', key, error.message); showSaveError(classifySaveError(error)); return false; } clearSaveError(); markOnline(); return true; })
    .catch(e=>{ console.warn('[db save crash]', key, e); if(navigator.onLine) showSaveError('Speichern fehlgeschlagen (Netzwerkfehler) — Änderung evtl. nicht gespeichert.'); return false; });
}
async function dbSave(key, value){
  if(!currentUser || !currentUser.id){ console.warn('[db save] kein User aktiv'); showSaveError('Nicht angemeldet — Änderung wurde nicht gespeichert.'); return false; }
  if(_hasUpdatedAt === false) return _plainUpsert(key, value);   // Spalte fehlt -> ohne Lock
  const nowIso = new Date().toISOString(), uid = currentUser.id, known = _ver[key];
  try{
    if(known){
      // gezieltes Update nur, wenn die Server-Version noch unsere ist
      const { data, error } = await sb.from('app_state')
        .update({ value, updated_at: nowIso })
        .eq('user_id', uid).eq('key', key).eq('updated_at', known).select('updated_at');
      if(error){ if(_colMissing(error)){ _hasUpdatedAt=false; return _plainUpsert(key,value); } console.warn('[db save]',key,error.message); showSaveError(classifySaveError(error)); return false; }
      if(data && data.length){ _ver[key]=data[0].updated_at; clearSaveError(); markOnline(); return true; }
      // 0 Treffer: existiert die Zeile (=Konflikt) oder ist sie weg (=insert)?
      const { data: cur, error: e2 } = await sb.from('app_state').select('updated_at').eq('user_id',uid).eq('key',key).maybeSingle();
      if(e2){ console.warn('[db save]',key,e2.message); showSaveError(classifySaveError(e2)); return false; }
      if(cur){
        // Nur wenn der Serverstand WIRKLICH ein anderer ist, war ein anderes Gerät schneller.
        // Ist er unverändert unserer, kam bloß keine Rückmeldung zurück (z.B. weil RLS das
        // RETURNING beschneidet) — dann wäre eine Konflikt-Meldung bei JEDEM Speichern falsch.
        if(Date.parse(cur.updated_at) !== Date.parse(known)){ showConflict(key, value); return false; }
        delete _ver[key];
        const ok = await _plainUpsert(key, value);
        if(ok){
          const rr = await sb.from('app_state').select('updated_at').eq('user_id',uid).eq('key',key).maybeSingle();
          if(rr && rr.data) _ver[key] = rr.data.updated_at;       // Versions-Schutz wieder scharf
        }
        return ok;
      }
      const { data: ins, error: e3 } = await sb.from('app_state').insert({ user_id:uid, key, value, updated_at:nowIso }).select('updated_at');
      if(e3){ console.warn('[db save]',key,e3.message); showSaveError(classifySaveError(e3)); return false; }
      if(ins&&ins.length) _ver[key]=ins[0].updated_at; clearSaveError(); markOnline(); return true;
    } else {
      // Version noch unbekannt (kein vorheriges Load) -> upsert + Version merken
      const { data, error } = await sb.from('app_state')
        .upsert({ user_id:uid, key, value, updated_at:nowIso }, { onConflict:'user_id,key' }).select('updated_at');
      if(error){ if(_colMissing(error)){ _hasUpdatedAt=false; return _plainUpsert(key,value); } console.warn('[db save]',key,error.message); showSaveError(classifySaveError(error)); return false; }
      if(data&&data.length) _ver[key]=data[0].updated_at; clearSaveError(); markOnline(); return true;
    }
  }catch(e){ console.warn('[db save crash]',key,e); if(navigator.onLine) showSaveError('Speichern fehlgeschlagen (Netzwerkfehler) — Änderung evtl. nicht gespeichert.'); return false; }
}

/* =====================================================================
   PROFILES · echte Nutzerverwaltung in Supabase-Tabelle 'profiles'
   (id = auth.users.id, username, role). Jeder schreibt sein eigenes
   Profil; Owner dürfen via RLS alle lesen & Rollen ändern.
   Alles defensiv: fehlt die Tabelle, wirft es -> Admin-Tab zeigt Setup-Hinweis.
   ===================================================================== */
async function profileUpsert(){
  if(!sb || !currentUser || !currentUser.id) return;
  const uname = currentUser.uname || (currentUser.username||'').split('@')[0];
  try{
    // Username anlegen/aktualisieren. Status/Rolle werden serverseitig (Trigger) verwaltet
    // -> neue Konten starten automatisch als 'pending'. Owner/Status kommen aus der DB.
    await sb.from('profiles').upsert({ id: currentUser.id, username: uname }, { onConflict:'id' });
  }catch(e){ console.warn('[profiles upsert]', e && e.message); }
}
/* Eigenes Profil lesen (status/role). Fehlt die status-Spalte (SQL noch nicht
   eingespielt) -> null zurück; der Aufrufer behandelt das als „freigegeben". */
async function fetchMyProfile(){
  if(!sb || !currentUser || !currentUser.id) return null;
  try{ const { data, error } = await sb.from('profiles').select('status,role').eq('id',currentUser.id).maybeSingle();
    if(error) return null; return data || null; }
  catch(e){ return null; }
}
async function profileList(){
  let r = await sb.from('profiles').select('id,username,role,status,created_at').order('created_at',{ascending:true});
  if(r.error) r = await sb.from('profiles').select('id,username,role,created_at').order('created_at',{ascending:true});  // Fallback ohne status-Spalte
  if(r.error) throw r.error;
  return (r.data||[]).map(u=>Object.assign({ status:'approved' }, u));   // ohne status-Spalte gilt: freigegeben
}
async function profileSetRole(id, role){
  const { error } = await sb.from('profiles').update({ role }).eq('id', id);
  if(error) throw error;
}
async function setUserStatus(id, status){
  const { error } = await sb.from('profiles').update({ status }).eq('id', id);
  if(error) throw error;
}
/* zentrale Nach-Login-Weiche: freigegeben -> App, sonst -> Warte-Screen */
async function handlePostAuth(user){
  const chosen = (user.user_metadata && user.user_metadata.username) || null;
  currentUser = { id:user.id, username:user.email, uname:chosen, role:roleFor(user.email) };
  await profileUpsert();
  const prof = await fetchMyProfile();
  const dbRole   = (prof && prof.role) || currentUser.role;
  const status   = (prof && prof.status) ? prof.status : 'approved';   // unbekannt -> freigegeben (RLS ist der echte Riegel)
  const isOwner  = dbRole==='owner' || roleFor(user.email)==='owner';
  currentUser.role = isOwner ? 'owner' : (dbRole || 'user');
  if(isOwner || status==='approved'){ await enterApp(); }
  else { showPending(status); }
}
function showPending(status){
  hideSplash();
  $("#app-view").classList.add("hidden"); $("#login-view").classList.add("hidden");
  const pv=$("#pending-view"); if(pv) pv.classList.remove("hidden");
  const msg=$("#pending-msg"); if(msg) msg.textContent = status==='rejected'
    ? "Deine Registrierung wurde abgelehnt. Bei Fragen wende dich an den Betreiber."
    : "Deine Registrierung wurde noch nicht freigegeben. Sobald der Admin sie annimmt, hast du Zugriff.";
}
/* Owner-Benachrichtigung: offene Anfragen zählen -> Badge + Dashboard-Hinweis + Toast */
async function refreshPendingBadge(showNote){
  const badge=$("#admin-badge"), alert=$("#admin-alert");
  if(!currentUser || currentUser.role!=="owner"){ if(badge) badge.classList.add("hidden"); if(alert) alert.classList.add("hidden"); return 0; }
  let count=0;
  try{ const { data, error } = await sb.from('profiles').select('id').eq('status','pending'); if(!error) count=(data||[]).length; }
  catch(e){ return 0; }
  let fb=0; try{ fb=await feedbackUnread(); }catch(e){}
  const total=count+fb;
  const parts=[]; if(count>0) parts.push(`${count} neue Registrierungsanfrage${count===1?"":"n"}`); if(fb>0) parts.push(`${fb} neues Feedback`);
  if(badge){ badge.textContent=String(total); badge.classList.toggle("hidden", total===0); }
  if(alert){ alert.classList.toggle("hidden", total===0);
    const t=$("#admin-alert-txt"); if(t) t.textContent = parts.join(" · ")||"Neue Hinweise"; }
  if(showNote && total>0) showToast(`🔔 ${parts.join(" · ")}`);
  return total;
}

/* Konto-weite Steuer-/Onboarding-Konfig (kuMode, Standard-Plattform, onboarded, tourDone …).
   MODUL-GLOBAL, damit saveTaxCfg mergen kann und kein Feld (z. B. tourDone) verloren geht. */
let taxCfg = null;

const DB = {
  /* ---- USERS (nur kosmetische Liste für Admin-Tab) + UI-Settings: bleiben LOKAL ---- */
  getUsers(){ try { const u=JSON.parse(Store.get("fg_users")||"null"); if(u&&u.length) return u; } catch(e){} return []; },
  saveUsers(arr){ Store.set("fg_users", JSON.stringify(arr)); },
  getSession(){ try { return JSON.parse(Store.get("fg_session")||"null"); } catch(e){ return null; } },
  setSession(s){ Store.set("fg_session", JSON.stringify(s)); }, clearSession(){ Store.del("fg_session"); },

  /* ---- DATEN: jetzt in Supabase (pro User getrennt via RLS) ---- */
  getFlips(){ return flipGetRows(); },          saveFlips(arr){ return flipSaveRows(arr); },
  getCalcs(){ return dbLoad('calcs'); },         saveCalcs(arr){ return dbSave('calcs', arr); },
  getInventory(){ return invGetRows(); },        saveInventory(arr){ return invSaveRows(arr); },
  getFixed(){ return dbLoad('fixed'); },         saveFixed(arr){ return dbSave('fixed', arr); },
  getFixCfg(){ return dbLoad('fixcfg'); },       saveFixCfg(o){ return dbSave('fixcfg', o); },
  getShipCfg(){ return dbLoad('shipcfg'); },      saveShipCfg(o){ return dbSave('shipcfg', o); },
  getBackups(){ return dbLoad('backups'); },      saveBackups(a){ return dbSave('backups', a); },
  getAvatar(){ return dbLoad('avatar'); },       setAvatar(d){ return dbSave('avatar', d); },
  getTaxCfg(){ return dbLoad('taxcfg'); },       saveTaxCfg(o){ taxCfg = Object.assign({}, taxCfg||{}, o||{}); return dbSave('taxcfg', taxCfg); },

  /* ---- APP-SETTINGS (Theme, Mode, Sprache, Stale): pro Gerät LOKAL ---- */
  getSetting(k,def){ const v=Store.get("fg_"+k); return v===null?def:v; },
  setSetting(k,v){ Store.set("fg_"+k, v); }
};

/* =====================================================================
   INVENTAR PER-ZEILE (Weg A.5 · Stufe 1)
   Jeder Artikel liegt als eigene Zeile in 'inv_items' statt in einem großen
   JSON-Klumpen. Speichern schreibt nur die GEÄNDERTEN Zeilen (Diff) — bleibt
   auch bei zehntausenden Artikeln schnell. Fehlt die Tabelle, fällt alles
   automatisch auf den alten Klumpen ('app_state' key 'inventory') zurück.
   Ein Marker ('inv_ready') macht die Migration sicher (kein Teil-Verlust):
   Zeilen gelten erst als maßgeblich, wenn die Migration KOMPLETT durch ist.
   ===================================================================== */
let _invMode = null;          // 'rows' | 'blob' | null(unbekannt)
let _invRows = new Map();     // id -> JSON.stringify(item)  (Schatten des DB-Stands)
function _invTableMissing(err){ return /relation|does not exist|schema cache|not find the table/i.test(((err&&err.message)||'')+''); }
function invSetupSQL(){ return `-- In Supabase: SQL Editor -> New query -> einfügen -> RUN
create table if not exists public.inv_items (
  user_id uuid not null references auth.users(id) on delete cascade,
  id text not null,
  data jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);
alter table public.inv_items enable row level security;
drop policy if exists "inv_self_all" on public.inv_items;
create policy "inv_self_all" on public.inv_items for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);`; }
async function _invMigrateFromBlob(arr){
  const uid=currentUser.id, nowIso=new Date().toISOString();
  const rows=arr.filter(it=>it&&it.id!=null).map(it=>({ user_id:uid, id:String(it.id), data:it, updated_at:nowIso }));
  for(let i=0;i<rows.length;i+=200){ const { error }=await sb.from('inv_items').upsert(rows.slice(i,i+200), { onConflict:'user_id,id' }); if(error) throw error; }
}
async function invGetRows(){
  if(!currentUser||!currentUser.id) return undefined;
  const uid=currentUser.id;
  const ready = (await dbLoad('inv_ready'))===true;
  let res; try{ res = await sb.from('inv_items').select('id,data').eq('user_id', uid); }
  catch(e){ _invMode='blob'; return dbLoad('inventory'); }
  if(res.error){ _invMode='blob'; if(!_invTableMissing(res.error)) console.warn('[inv load]', res.error.message); return dbLoad('inventory'); }
  const data = res.data||[];
  const byTime=(a,b)=> new Date((b&&(b.touchedAt||b.date))||0) - new Date((a&&(a.touchedAt||a.date))||0);
  if(ready){
    _invMode='rows'; _invRows=new Map(data.map(r=>[String(r.id), JSON.stringify(r.data)]));
    return data.map(r=>r.data).sort(byTime);
  }
  // Tabelle existiert, aber noch nicht migriert -> einmalig vom Klumpen übernehmen
  const legacy = await dbLoad('inventory');
  if(Array.isArray(legacy) && legacy.length){
    legacy.forEach(it=>{ if(it && it.id==null) it.id='i'+Date.now().toString(36)+Math.random().toString(36).slice(2,6); }); // kein Artikel darf durchfallen
    try{
      await _invMigrateFromBlob(legacy);
      await dbSave('inv_ready', true);   // erst JETZT gelten Zeilen als maßgeblich
      _invMode='rows'; _invRows=new Map(legacy.filter(it=>it&&it.id!=null).map(it=>[String(it.id), JSON.stringify(it)]));
      setTimeout(()=>{ try{ showToast('✓ Inventar auf schnelles Format umgestellt · '+legacy.length+' Artikel'); }catch(e){} }, 1500);
      return legacy;
    }catch(e){ console.warn('[inv migrate]', e&&e.message); _invMode='blob'; return legacy; }   // scheitert -> sicher beim Klumpen bleiben
  }
  // frisches Konto ohne Altdaten -> direkt im Zeilen-Modus starten
  try{ await dbSave('inv_ready', true); }catch(e){}
  _invMode='rows'; _invRows=new Map();
  return legacy || undefined;
}
async function invSaveRows(arr){
  if(_invMode!=='rows') return dbSave('inventory', arr);   // Blob-Modus (Tabelle fehlt / Migration offen) -> Alt-Verhalten
  if(!currentUser||!currentUser.id){ showSaveError('Nicht angemeldet — Änderung wurde nicht gespeichert.'); return false; }
  const uid=currentUser.id, nowIso=new Date().toISOString();
  (arr||[]).forEach(it=>{ if(it && it.id==null) it.id='i'+Date.now().toString(36)+Math.random().toString(36).slice(2,6); }); // nie ohne id speichern
  const cur=new Map(); (arr||[]).forEach(it=>{ if(it&&it.id!=null) cur.set(String(it.id), JSON.stringify(it)); });
  const upserts=[], dels=[];
  cur.forEach((json,id)=>{ if(_invRows.get(id)!==json) upserts.push({ user_id:uid, id, data:JSON.parse(json), updated_at:nowIso }); });
  _invRows.forEach((_,id)=>{ if(!cur.has(id)) dels.push(id); });
  if(!upserts.length && !dels.length){ clearSaveError(); markOnline(); return true; }
  try{
    for(let i=0;i<upserts.length;i+=200){ const { error }=await sb.from('inv_items').upsert(upserts.slice(i,i+200), { onConflict:'user_id,id' }); if(error){ console.warn('[inv save]',error.message); showSaveError(classifySaveError(error)); return false; } }
    for(let i=0;i<dels.length;i+=200){ const { error }=await sb.from('inv_items').delete().eq('user_id',uid).in('id', dels.slice(i,i+200)); if(error){ console.warn('[inv del]',error.message); showSaveError(classifySaveError(error)); return false; } }
    _invRows = cur; clearSaveError(); markOnline(); return true;
  }catch(e){ console.warn('[inv save crash]', e); if(navigator.onLine) showSaveError('Speichern fehlgeschlagen (Netzwerkfehler) — Änderung evtl. nicht gespeichert.'); return false; }
}

/* =====================================================================
   VERKÄUFE PER-ZEILE (Weg A.5 · Stufe 2) — identisches Muster wie Inventar.
   Jeder Verkauf ('flip') liegt als Zeile in 'flip_items'. Diff-Speichern +
   sichere, markierte Migration ('flips_ready'). Inert ohne die Tabelle.
   ===================================================================== */
let _flipMode = null;
let _flipRows = new Map();
function flipSetupSQL(){ return `-- In Supabase: SQL Editor -> New query -> einfügen -> RUN
create table if not exists public.flip_items (
  user_id uuid not null references auth.users(id) on delete cascade,
  id text not null,
  data jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);
alter table public.flip_items enable row level security;
drop policy if exists "flip_self_all" on public.flip_items;
create policy "flip_self_all" on public.flip_items for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);`; }
async function _flipMigrateFromBlob(arr){
  const uid=currentUser.id, nowIso=new Date().toISOString();
  const rows=arr.filter(f=>f&&f.id!=null).map(f=>({ user_id:uid, id:String(f.id), data:f, updated_at:nowIso }));
  for(let i=0;i<rows.length;i+=200){ const { error }=await sb.from('flip_items').upsert(rows.slice(i,i+200), { onConflict:'user_id,id' }); if(error) throw error; }
}
async function flipGetRows(){
  if(!currentUser||!currentUser.id) return undefined;
  const uid=currentUser.id;
  const ready = (await dbLoad('flips_ready'))===true;
  let res; try{ res = await sb.from('flip_items').select('id,data').eq('user_id', uid); }
  catch(e){ _flipMode='blob'; return dbLoad('flips'); }
  if(res.error){ _flipMode='blob'; if(!_invTableMissing(res.error)) console.warn('[flip load]', res.error.message); return dbLoad('flips'); }
  const data = res.data||[];
  const byDate=(a,b)=> new Date((b&&b.date)||0) - new Date((a&&a.date)||0);
  if(ready){
    _flipMode='rows'; _flipRows=new Map(data.map(r=>[String(r.id), JSON.stringify(r.data)]));
    return data.map(r=>r.data).sort(byDate);
  }
  const legacy = await dbLoad('flips');
  if(Array.isArray(legacy) && legacy.length){
    legacy.forEach(f=>{ if(f && f.id==null) f.id='f'+Date.now().toString(36)+Math.random().toString(36).slice(2,6); });
    try{
      await _flipMigrateFromBlob(legacy);
      await dbSave('flips_ready', true);
      _flipMode='rows'; _flipRows=new Map(legacy.filter(f=>f&&f.id!=null).map(f=>[String(f.id), JSON.stringify(f)]));
      setTimeout(()=>{ try{ showToast('✓ Verkäufe auf schnelles Format umgestellt · '+legacy.length+' Einträge'); }catch(e){} }, 2600);
      return legacy;
    }catch(e){ console.warn('[flip migrate]', e&&e.message); _flipMode='blob'; return legacy; }
  }
  try{ await dbSave('flips_ready', true); }catch(e){}
  _flipMode='rows'; _flipRows=new Map();
  return legacy || undefined;
}
async function flipSaveRows(arr){
  if(_flipMode!=='rows') return dbSave('flips', arr);
  if(!currentUser||!currentUser.id){ showSaveError('Nicht angemeldet — Änderung wurde nicht gespeichert.'); return false; }
  const uid=currentUser.id, nowIso=new Date().toISOString();
  (arr||[]).forEach(f=>{ if(f && f.id==null) f.id='f'+Date.now().toString(36)+Math.random().toString(36).slice(2,6); });
  const cur=new Map(); (arr||[]).forEach(f=>{ if(f&&f.id!=null) cur.set(String(f.id), JSON.stringify(f)); });
  const upserts=[], dels=[];
  cur.forEach((json,id)=>{ if(_flipRows.get(id)!==json) upserts.push({ user_id:uid, id, data:JSON.parse(json), updated_at:nowIso }); });
  _flipRows.forEach((_,id)=>{ if(!cur.has(id)) dels.push(id); });
  if(!upserts.length && !dels.length){ clearSaveError(); markOnline(); return true; }
  try{
    for(let i=0;i<upserts.length;i+=200){ const { error }=await sb.from('flip_items').upsert(upserts.slice(i,i+200), { onConflict:'user_id,id' }); if(error){ console.warn('[flip save]',error.message); showSaveError(classifySaveError(error)); return false; } }
    for(let i=0;i<dels.length;i+=200){ const { error }=await sb.from('flip_items').delete().eq('user_id',uid).in('id', dels.slice(i,i+200)); if(error){ console.warn('[flip del]',error.message); showSaveError(classifySaveError(error)); return false; } }
    _flipRows = cur; clearSaveError(); markOnline(); return true;
  }catch(e){ console.warn('[flip save crash]', e); if(navigator.onLine) showSaveError('Speichern fehlgeschlagen (Netzwerkfehler) — Änderung evtl. nicht gespeichert.'); return false; }
}

/* =====================================================================
   UNDO / REDO (v5.0) — Snapshot-basiert über den gesamten Datenstand.
   Wird automatisch bei jeder gespeicherten Änderung aufgezeichnet, indem die
   DB.save*-Methoden umhüllt werden — ohne die vielen Mutations-Stellen anzufassen.
   ===================================================================== */
let _history=[], _hp=-1, _histTimer=null, _restoring=false;
function _snapState(){ return JSON.stringify({ flips, inventory, fixed, calcs:(typeof calcs!=="undefined"?calcs:[]), fixcfg:fixCfg, shipcfg:shipCfg }); }
function initHistory(){ _history=[_snapState()]; _hp=0; updateUndoUI(); }
function recordHistory(){
  if(_restoring) return;
  const snap=_snapState();
  if(_hp>=0 && _history[_hp]===snap) return;     // keine echte Änderung
  _history=_history.slice(0, _hp+1);             // Redo-Zweig verwerfen
  _history.push(snap);
  if(_history.length>40) _history.shift();
  _hp=_history.length-1; updateUndoUI();
  maybeAutoSnapshot();   // gedrosselt einen dauerhaften Wiederherstellungs-Punkt anlegen
}
function scheduleHistory(){ if(_restoring) return; clearTimeout(_histTimer); _histTimer=setTimeout(recordHistory, 500); }
function flushHistory(){ if(_histTimer){ clearTimeout(_histTimer); _histTimer=null; recordHistory(); } }
/* Speichern nach Undo/Redo: gesammelt statt sofort. Wer zehnmal Strg+Z drückt,
   löst sonst 60 Uploads aus. Wir merken nur, WAS sich geändert hat, und schreiben
   das kurz nach dem letzten Tastendruck einmal weg. */
let _syncWanted={}, _syncTimer=null;
function _queueSync(keys){
  Object.assign(_syncWanted, keys);
  clearTimeout(_syncTimer); _syncTimer=setTimeout(flushUndoSync, 700);
}
function flushUndoSync(){
  clearTimeout(_syncTimer); _syncTimer=null;
  const w=_syncWanted; _syncWanted={};
  if(!Object.keys(w).length) return;
  _restoring=true;   // diese Schreibvorgänge sind kein neuer Verlaufs-Schritt
  if(w.flips)     DB.saveFlips(flips);
  if(w.inventory) DB.saveInventory(inventory);
  if(w.fixed)     DB.saveFixed(fixed);
  if(w.calcs && typeof calcs!=="undefined") DB.saveCalcs(calcs);
  if(w.fixcfg)    DB.saveFixCfg(fixCfg);
  if(w.shipcfg)   DB.saveShipCfg(shipCfg);
  _restoring=false;
}
// Schließt jemand die App vorher, geht der Stand trotzdem raus.
window.addEventListener("pagehide", flushUndoSync);
document.addEventListener("visibilitychange", ()=>{ if(document.visibilityState==="hidden") flushUndoSync(); });

function _applySnapshot(str, fromStr){
  let s, p={}; try{ s=JSON.parse(str); }catch(e){ return; }
  try{ p=JSON.parse(fromStr||"{}"); }catch(e){ p={}; }
  const differs=(a,b)=>JSON.stringify(a===undefined?null:a)!==JSON.stringify(b===undefined?null:b);
  flips=s.flips||[]; inventory=s.inventory||[]; fixed=s.fixed||[];
  if(typeof calcs!=="undefined") calcs=s.calcs||[];
  fixCfg=s.fixcfg||fixCfg; shipCfg=normalizeShipCfg(s.shipcfg);
  _queueSync({ flips:differs(s.flips,p.flips), inventory:differs(s.inventory,p.inventory),
               fixed:differs(s.fixed,p.fixed), calcs:differs(s.calcs,p.calcs),
               fixcfg:differs(s.fixcfg,p.fixcfg), shipcfg:differs(s.shipcfg,p.shipcfg) });
  renderShipPresets&&renderShipPresets(); applyShipDefaults&&applyShipDefaults();
  renderDashboard&&renderDashboard(); renderTrackerList&&renderTrackerList();
  renderInventory&&renderInventory(); renderFixed&&renderFixed();
  renderReport&&renderReport(); renderCalcHistory&&renderCalcHistory();
}
function undo(){ flushHistory(); if(_hp<=0) return; const from=_history[_hp]; _hp--; _applySnapshot(_history[_hp], from); updateUndoUI(); showToast("↶ Rückgängig"); }
function redo(){ flushHistory(); if(_hp>=_history.length-1) return; const from=_history[_hp]; _hp++; _applySnapshot(_history[_hp], from); updateUndoUI(); showToast("↷ Wiederholt"); }
function updateUndoUI(){
  const u=document.getElementById("undo-btn"), r=document.getElementById("redo-btn");
  if(u) u.disabled = !(_hp>0);
  if(r) r.disabled = !(_hp>=0 && _hp<_history.length-1);
}
/* DB.save*-Methoden umhüllen (Avatar/Backups/Settings bewusst NICHT). */
["saveFlips","saveInventory","saveFixed","saveCalcs","saveFixCfg","saveShipCfg"].forEach(m=>{
  const orig=DB[m].bind(DB);
  DB[m]=function(...a){ const res=orig(...a); scheduleHistory(); return res; };
});
/* Buttons + Tastatur (Strg/Cmd+Z bzw. +Shift+Z / +Y) — in Textfeldern native Undo belassen */
(function(){
  const u=document.getElementById("undo-btn"), r=document.getElementById("redo-btn");
  if(u) u.addEventListener("click", undo);
  if(r) r.addEventListener("click", redo);
  document.addEventListener("keydown", e=>{
    if(!(e.ctrlKey||e.metaKey)) return;
    const k=(e.key||"").toLowerCase(); if(k!=="z" && k!=="y") return;
    const el=document.activeElement;
    if(el && (/^(input|textarea|select)$/i.test(el.tagName) || el.isContentEditable)) return;
    e.preventDefault();
    if(k==="y" || (k==="z" && e.shiftKey)) redo(); else undo();
  });
})();

/* ===== 1 · HELFER ===== */
const $  = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);
const MONTHS = ["Jan","Feb","Mär","Apr","Mai","Jun","Jul","Aug","Sep","Okt","Nov","Dez"];
const dayOffset = d => { const x=new Date(); x.setHours(12,0,0,0); x.setDate(x.getDate()-d); return x.toISOString(); };
const num = v => { const n=parseFloat(String(v).replace(",", ".")); return isFinite(n)?n:0; };
const eur = n => n.toLocaleString("de-DE",{minimumFractionDigits:2,maximumFractionDigits:2})+" €";
const pct = n => n.toLocaleString("de-DE",{minimumFractionDigits:1,maximumFractionDigits:1})+" %";
const fmtDate = iso => new Date(iso).toLocaleDateString("de-DE",{day:"numeric",month:"long",year:"numeric"});
/* Kundenretoure: f.returned = true -> Verkauf zählt weder für Umsatz noch Gewinn.
   Eine Änderung an diesen drei Helfern korrigiert automatisch ALLE Auswertungen. */
const flipProfit  = f => f.returned ? 0 : (num(f.payout)-num(f.ek)-num(f.ship))*(f.qty||1);
const flipRevenue = f => f.returned ? 0 : num(f.payout)*(f.qty||1);
const flipCost    = f => f.returned ? 0 : (num(f.ek)+num(f.ship))*(f.qty||1);
/* escapeHtml jetzt auch attribut-sicher: escapt zusätzlich " und ' → kein Quote-Breakout mehr,
   egal ob der Wert in Textinhalt ODER in einem Attribut landet. (Härtung, v5.10.6) */
const escapeHtml = s => String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");
/* Attribut-sicher escapen (auch Anführungszeichen!) – escapeHtml allein reicht in
   Attributen NICHT, weil " nicht ersetzt wird -> Ausbruch/XSS möglich. */
const attrEsc = s => String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");
/* Feste eBay-Transaktionsgebühr je Bestellung – abhängig vom KU-Regler:
   mit KU (inkl. MwSt) = 0,54 € · ohne KU (netto) = 0,42 €  (Kleinbeträge ≤10 €: 0,45 € / 0,35 €) */
const transFee = vk => kuMode ? (vk<=10 ? 0.45 : 0.54) : (vk<=10 ? 0.35 : 0.42);
const todayISOInput = () => new Date().toISOString().slice(0,10);
const icoEdit=`<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>`;
const icoTrash=`<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg>`;
function readImageScaled(file, max, cb){ const r=new FileReader(); r.onload=()=>{ const img=new Image(); img.onload=()=>{ const s=Math.min(1,max/Math.max(img.width,img.height)); const c=document.createElement("canvas"); c.width=Math.round(img.width*s); c.height=Math.round(img.height*s); c.getContext("2d").drawImage(img,0,0,c.width,c.height); cb(c.toDataURL("image/jpeg",0.85)); }; img.src=r.result; }; r.readAsDataURL(file); }

function seedFlips(){
  return [
    { id:"s1",name:"Topps Lineage FC Bayern München 2025/26",ean:"4063339201147",qty:1,ek:294.12,payout:504.12,ship:0,date:dayOffset(2) },
    { id:"s2",name:"Pokémon 151 Booster Display (DE)",ean:"0820650859328",qty:1,ek:159.00,payout:219.90,ship:6.19,date:dayOffset(5) },
    { id:"s3",name:"Apple AirPods Pro 2 (USB-C)",ean:"0195949052330",qty:2,ek:165.00,payout:218.50,ship:6.19,date:dayOffset(9) },
    { id:"s4",name:"Nike Dunk Low Panda Gr. 43",ean:"0196969053217",qty:1,ek:95.00,payout:138.00,ship:6.19,date:dayOffset(14) },
    { id:"s5",name:"PlayStation 5 Slim Disc",ean:"0711719577171",qty:1,ek:399.00,payout:452.00,ship:8.49,date:dayOffset(22) },
    { id:"s6",name:"LEGO Icons Bonsai Baum 10281",ean:"5702016667967",qty:1,ek:44.00,payout:69.90,ship:5.49,date:dayOffset(33) },
    { id:"s7",name:"One Piece OP-07 Booster Display",ean:"0810059785632",qty:1,ek:89.00,payout:149.00,ship:6.19,date:dayOffset(41) },
    { id:"s8",name:"Stanley Quencher 1.18L",ean:"0041604159121",qty:3,ek:28.00,payout:41.50,ship:5.49,date:dayOffset(52) },
    { id:"s9",name:"LEGO Star Wars UCS Razor Crest",ean:"5702017155349",qty:1,ek:320.00,payout:412.00,ship:9.49,date:dayOffset(70) },
    { id:"s10",name:"Air Jordan 1 Low Wolf Grey Gr. 44",ean:"0196969712017",qty:1,ek:110.00,payout:142.00,ship:6.19,date:dayOffset(86) },
    { id:"s11",name:"Pokémon Karmesin & Purpur Display",ean:"0820650855412",qty:1,ek:135.00,payout:176.00,ship:6.19,date:dayOffset(103) },
    { id:"s12",name:"Apple Watch Series 9 45mm",ean:"0194253934547",qty:1,ek:329.00,payout:352.00,ship:6.19,date:dayOffset(121) },
    { id:"s13",name:"Sonos Era 100 Schwarz",ean:"0840176901127",qty:1,ek:199.00,payout:214.00,ship:8.49,date:dayOffset(150) },
    { id:"s14",name:"Designer Cap (Retoure)",ean:"0889441234567",qty:1,ek:180.00,payout:168.00,ship:6.19,date:dayOffset(168) },
    { id:"s15",name:"LEGO Technic Ferrari Daytona SP3",ean:"5702017156347",qty:1,ek:149.00,payout:189.00,ship:8.49,date:dayOffset(200) }
  ];
}
/* Beispiel-Fixkosten (nur für admin-Demo) */
function seedFixed(){
  return [
    { id:"fx1", name:"Versandkartons & Füllmaterial", amount:45, cat:"Material" },
    { id:"fx2", name:"eBay Shop-Abo (Basis)", amount:39.95, cat:"Abo" },
    { id:"fx3", name:"Buchhaltung / Steuertool", amount:19.90, cat:"Buchhaltung" },
    { id:"fx4", name:"Lagerregal-Miete (anteilig)", amount:25, cat:"Lager" }
  ];
}

/* ===== 2 · TOAST ===== */
function showToast(msg){ const t=document.createElement("div"); t.className="toast";
  t.innerHTML=`<svg class="tick" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg><span>${escapeHtml(msg)}</span>`;
  $("#toast-wrap").appendChild(t); requestAnimationFrame(()=>t.classList.add("show"));
  setTimeout(()=>{ t.classList.remove("show"); setTimeout(()=>t.remove(),350); },2600); }

/* Persistente Speicher-Fehler-Leiste: bleibt sichtbar, bis der nächste
   Schreibvorgang klappt oder der Nutzer sie schließt (siehe dbSave). */
let _saveErrEl=null;
function _ensureSaveErrBar(){
  if(_saveErrEl && document.body.contains(_saveErrEl)) return _saveErrEl;
  const bar=document.createElement("div");
  bar.id="save-error-bar"; bar.setAttribute("role","alert"); bar.setAttribute("aria-live","assertive");
  bar.innerHTML=`<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="flex:0 0 auto"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/></svg><span class="se-txt"></span><button class="se-x" type="button" aria-label="Ausblenden"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg></button>`;
  (document.body||document.documentElement).appendChild(bar);
  bar.querySelector(".se-x").addEventListener("click",clearSaveError);
  _saveErrEl=bar; return bar;
}
function showSaveError(msg){
  const bar=_ensureSaveErrBar();
  bar.querySelector(".se-txt").textContent = msg || "Speichern fehlgeschlagen — Änderung evtl. nicht gespeichert.";
  document.body.classList.add("has-save-error");
}
function clearSaveError(){ document.body.classList.remove("has-save-error"); }
/* Ein erfolgreicher Schreibvorgang beweist die Verbindung -> Offline-Leiste weg. */
function markOnline(){ /* Offline-Leiste gibt es seit v5.0.4 nicht mehr – nichts zu tun. */ }

/* Konflikt-Leiste: ein anderes Gerät hat denselben Datensatz zwischenzeitlich
   gespeichert. Statt still zu überschreiben -> Wahl: neu laden oder eigenen Stand behalten. */
function showConflict(key, value){
  _conflictPending[key] = value;
  if(document.getElementById('conflict-bar')) return;
  const bar=document.createElement('div'); bar.id='conflict-bar'; bar.setAttribute('role','alertdialog');
  bar.style.cssText='position:fixed;left:50%;bottom:calc(18px + env(safe-area-inset-bottom, 0px));transform:translateX(-50%);z-index:95;max-width:calc(100vw - 28px);width:360px;display:flex;flex-direction:column;gap:6px;background:color-mix(in srgb,var(--cell) 92%,transparent);border:1px solid color-mix(in srgb,#f5a524 55%,var(--line));border-radius:16px;padding:13px 15px;box-shadow:0 24px 60px -20px rgba(0,0,0,.85);-webkit-backdrop-filter:blur(16px);backdrop-filter:blur(16px)';
  bar.innerHTML='<p style="font-size:12.5px;font-weight:700;color:#f5a524;margin:0">⚠ Auf einem anderen Gerät wurde gespeichert</p>'+
    '<p class="c-sub" style="font-size:11.5px;line-height:1.4;margin:0">Um Datenverlust zu vermeiden: <b>neu laden</b> übernimmt den Stand des anderen Geräts, <b>behalten</b> überschreibt ihn mit deinem.</p>'+
    '<div style="display:flex;gap:8px;margin-top:4px"><button id="conflict-reload" class="btn-accent" style="flex:1;padding:8px 12px;font-size:12.5px">Neu laden</button><button id="conflict-keep" class="btn-ghost" style="flex:1;padding:8px 12px;font-size:12.5px">Meinen Stand behalten</button></div>';
  (document.body||document.documentElement).appendChild(bar);
  bar.querySelector('#conflict-reload').addEventListener('click', ()=>location.reload());
  bar.querySelector('#conflict-keep').addEventListener('click', resolveConflictKeepMine);
}
async function resolveConflictKeepMine(){
  const btn=document.getElementById('conflict-keep'); if(btn){ btn.disabled=true; btn.textContent='Speichere…'; }
  try{
    for(const k of Object.keys(_conflictPending)){
      const nowIso=new Date().toISOString();
      const { data, error } = await sb.from('app_state')
        .upsert({ user_id:currentUser.id, key:k, value:_conflictPending[k], updated_at:nowIso }, { onConflict:'user_id,key' }).select('updated_at');
      if(error){ showSaveError('Überschreiben fehlgeschlagen: '+error.message); if(btn){ btn.disabled=false; btn.textContent='Meinen Stand behalten'; } return; }
      if(data&&data.length) _ver[k]=data[0].updated_at;
    }
    _conflictPending={}; const bar=document.getElementById('conflict-bar'); if(bar) bar.remove();
    clearSaveError(); showToast('✓ Dein Stand wurde gespeichert');
  }catch(e){ showSaveError('Überschreiben fehlgeschlagen (Netzwerk).'); if(btn){ btn.disabled=false; btn.textContent='Meinen Stand behalten'; } }
}

/* ===== 3 · THEMES ===== */
const PALETTES = {
  spacegray:{label:"Indigo · Mint",t:{"--bg":"#060911","--cell":"#0B1120","--cell-2":"#121A2E","--text":"#F8FAFC","--sub":"#94A3B8","--line":"rgba(255,255,255,.08)","--accent":"#34D399","--accent-3":"#7C8AFF","--accent-2":"#10B981","--accent-soft":"rgba(52,211,153,.12)","--danger":"#FB7185","--danger-soft":"rgba(251,113,133,.14)","--glow":"rgba(124,138,255,.30)"}},
  midnight:{label:"Midnight · Cyan",t:{"--bg":"#080C18","--cell":"#0E1526","--cell-2":"#162038","--text":"#EAF0FB","--sub":"#8A99B5","--line":"rgba(255,255,255,.08)","--accent":"#38BDF8","--accent-3":"#818CF8","--accent-2":"#0EA5E9","--accent-soft":"rgba(56,189,248,.13)","--danger":"#FB7185","--danger-soft":"rgba(251,113,133,.14)","--glow":"rgba(56,189,248,.24)"}},
  deeppurple:{label:"Ash · Indigo",t:{"--bg":"#0B0D14","--cell":"#13161F","--cell-2":"#1C2030","--text":"#F1F2F8","--sub":"#9AA0B5","--line":"rgba(255,255,255,.08)","--accent":"#A5B4FC","--accent-3":"#C4B5FD","--accent-2":"#818CF8","--accent-soft":"rgba(165,180,252,.13)","--danger":"#FB7185","--danger-soft":"rgba(251,113,133,.14)","--glow":"rgba(165,180,252,.24)"}},
  crimson:{label:"Crimson Red",t:{"--bg":"#19110f","--cell":"#251715","--cell-2":"#33201d","--text":"#fbeeec","--sub":"#b08a86","--line":"rgba(255,255,255,.07)","--accent":"#ff5a6a","--accent-3":"#ffb24d","--accent-2":"#e23e50","--accent-soft":"rgba(255,90,106,.15)","--danger":"#ffa14d","--danger-soft":"rgba(255,161,77,.15)","--glow":"rgba(255,90,106,.22)"}},
  carbongold:{label:"Carbon Gold",t:{"--bg":"#141312","--cell":"#1f1d1a","--cell-2":"#2a2722","--text":"#f6f2e9","--sub":"#a89e8a","--line":"rgba(255,255,255,.07)","--accent":"#e8c468","--accent-3":"#e07a5f","--accent-2":"#cda748","--accent-soft":"rgba(232,196,104,.15)","--danger":"#ff6f61","--danger-soft":"rgba(255,111,97,.15)","--glow":"rgba(232,196,104,.20)"}},
  emeraldmint:{label:"Emerald Mint",t:{"--bg":"#0e1714","--cell":"#16221d","--cell-2":"#1f2f28","--text":"#ecfbf4","--sub":"#83a89a","--line":"rgba(255,255,255,.07)","--accent":"#34d399","--accent-3":"#8b7cf6","--accent-2":"#16b07c","--accent-soft":"rgba(52,211,153,.15)","--danger":"#ff7a7a","--danger-soft":"rgba(255,122,122,.15)","--glow":"rgba(52,211,153,.22)"}},
  cyberpunk:{label:"Cyberpunk Neon",t:{"--bg":"#0d0b14","--cell":"#161226","--cell-2":"#211a3a","--text":"#f5edff","--sub":"#9488b8","--line":"rgba(255,255,255,.08)","--accent":"#ff2d9b","--accent-3":"#22d3ee","--accent-2":"#d6207f","--accent-soft":"rgba(255,45,155,.16)","--danger":"#ffb02e","--danger-soft":"rgba(255,176,46,.16)","--glow":"rgba(255,45,155,.25)"}},
  stealth:{label:"Stealth Graphite",t:{"--bg":"#141416","--cell":"#1d1d20","--cell-2":"#27272b","--text":"#eef0f4","--sub":"#8b8e98","--line":"rgba(255,255,255,.07)","--accent":"#aeb6c7","--accent-3":"#6b8bd1","--accent-2":"#8e96a8","--accent-soft":"rgba(174,182,199,.14)","--danger":"#ff6f6f","--danger-soft":"rgba(255,111,111,.14)","--glow":"rgba(174,182,199,.16)"}},
  ocean:{label:"Ocean Blue",t:{"--bg":"#0a121f","--cell":"#122033","--cell-2":"#1a2c45","--text":"#eaf2fb","--sub":"#7e93ad","--line":"rgba(255,255,255,.07)","--accent":"#2f9bff","--accent-3":"#22d3ee","--accent-2":"#1a7fe0","--accent-soft":"rgba(47,155,255,.15)","--danger":"#ff7a7a","--danger-soft":"rgba(255,122,122,.15)","--glow":"rgba(47,155,255,.22)"}},
  rosequartz:{label:"Rose Quartz",t:{"--bg":"#1a1316","--cell":"#261a20","--cell-2":"#33232b","--text":"#fbeef2","--sub":"#b38f9c","--line":"rgba(255,255,255,.07)","--accent":"#fb7185","--accent-3":"#a78bfa","--accent-2":"#e85575","--accent-soft":"rgba(251,113,133,.15)","--danger":"#ffb454","--danger-soft":"rgba(255,180,84,.15)","--glow":"rgba(251,113,133,.22)"}},
  amberdusk:{label:"Amber Dusk",t:{"--bg":"#161210","--cell":"#221b16","--cell-2":"#2e251d","--text":"#fbf3ea","--sub":"#ad9b86","--line":"rgba(255,255,255,.07)","--accent":"#fbbf24","--accent-3":"#fb7185","--accent-2":"#e0a312","--accent-soft":"rgba(251,191,36,.15)","--danger":"#ff6f61","--danger-soft":"rgba(255,111,97,.15)","--glow":"rgba(251,191,36,.20)"}},
  arcticteal:{label:"Arctic Teal",t:{"--bg":"#0c1617","--cell":"#142325","--cell-2":"#1c3032","--text":"#e9fbf9","--sub":"#7fa6a4","--line":"rgba(255,255,255,.07)","--accent":"#2dd4bf","--accent-3":"#6aa6ff","--accent-2":"#16b3a0","--accent-soft":"rgba(45,212,191,.15)","--danger":"#ff7a7a","--danger-soft":"rgba(255,122,122,.15)","--glow":"rgba(45,212,191,.22)"}}
};
/* Aktive UI-Einstellungen (persistent via DB.getSetting/​setSetting) */
let themeMode = DB.getSetting("mode","dark");   // 'dark' | 'light'
let lang      = DB.getSetting("lang","de");     // 'de' | 'en'

/* Light-Mode: nur die Neutral-Tokens werden überschrieben, Akzentfarbe bleibt */
const LIGHT_TOKENS = { "--bg":"#f3f4f7","--cell":"#ffffff","--cell-2":"#eef0f4","--text":"#1c1c1e","--sub":"#6b7280","--line":"rgba(0,0,0,.09)","--glow":"rgba(0,0,0,.10)" };
function applyPalette(key){ Store.set("fg_theme",key); applyTheme(); }
function applyTheme(){ const key=Store.get("fg_theme")||"spacegray"; const p=PALETTES[key]; if(!p) return;
  const tokens = Object.assign({}, p.t, themeMode==="light" ? LIGHT_TOKENS : {});
  Object.entries(tokens).forEach(([k,v])=>document.documentElement.style.setProperty(k,v));
  document.documentElement.classList.toggle("light", themeMode==="light");
  document.querySelector('meta[name="theme-color"]').setAttribute("content",tokens["--bg"]);
  buildThemeMenu(); }
function setMode(m){ themeMode=m; DB.setSetting("mode",m); applyTheme(); }
function buildThemeMenu(){ const cur=Store.get("fg_theme")||"spacegray";
  $("#theme-menu").innerHTML = Object.entries(PALETTES).map(([k,p])=>`
    <button class="menu-item" data-theme="${k}"><span class="sw"><i style="background:${p.t["--bg"]}"></i><i style="background:${p.t["--cell-2"]}"></i><i style="background:${p.t["--accent"]}"></i></span><span class="flex-1">${p.label}</span>${k===cur?`<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>`:""}</button>`).join("");
  $$("#theme-menu .menu-item").forEach(b=>b.addEventListener("click",()=>{ applyPalette(b.dataset.theme); $("#theme-menu").classList.add("hidden"); showToast(t("toast.palette")+": "+PALETTES[b.dataset.theme].label); }));
}
$("#theme-btn").addEventListener("click", e=>{ e.stopPropagation(); $("#profile-menu").classList.add("hidden"); $("#theme-btn").blur(); $("#theme-menu").classList.toggle("hidden"); });
document.addEventListener("click", e=>{ if(!e.target.closest("#theme-menu")&&!e.target.closest("#theme-btn")) $("#theme-menu").classList.add("hidden"); });

/* ===== 3b · i18n (DE/EN) =====
   Statische Texte tragen data-i18n="key" und werden von applyI18n() gesetzt.
   Dynamische Strings (Toasts, Listen) laufen über t("key"). */
const I18N = {
  de:{
    "tab.dashboard":"Übersicht","tab.tracker":"Verkäufe","tab.calc":"Gebühren","tab.inventory":"Bestand","tab.fix":"Fixkosten","tab.report":"Auswertung","tab.pwgen":"Passwörter","tab.admin":"Admin","tab.profil":"Profil",
    "nav.logout":"Abmelden",
    "login.subtitle":"Reselling-Cockpit","login.user":"Benutzername oder E-Mail","login.pass":"Passwort","login.remember":"Angemeldet bleiben","login.btn":"Anmelden","login.err":"Username oder Passwort falsch.",
    "dash.revenue":"Umsatz","dash.profit":"Nettogewinn","dash.margin":"Marge","dash.history":"Historie","dash.search":"Suche nach Produkt oder EAN…","dash.recent":"Letzte Deals",
    "track.add":"Neuen Deal hinzufügen","track.recent":"Letzte Deals","track.empty":"Keine Deals im Zeitraum",
    "calc.title":"Gebührenrechner","calc.toInv":"Zu Bestand hinzufügen ↗","calc.toTracker":"In Tracker übernehmen ↗",
    "inv.stock":"Bestand","inv.units":"Artikel","inv.capital":"Kapital gebunden","inv.potential":"Potenzieller Profit","inv.add":"Neues Item hinzufügen","inv.create":"Bestand manuell anlegen","inv.protect":"Preisschutz aktiv","inv.empty":"Bestand ist leer",
    "fix.title":"Fixkosten","fix.add":"Neue Ausgabe","fix.monthly":"Monatliche Fixkosten","fix.algo":"Zielmarge","fix.revenue":"Monatlicher Umsatz €","fix.packages":"Pakete / Monat","fix.base":"Basis-Gewinnmarge %","fix.empty":"Noch keine Ausgaben erfasst",
    "prof.title":"Profil","prof.pw":"Passwort ändern","prof.appearance":"Darstellung","prof.mode":"Erscheinungsbild","prof.lang":"Sprache","prof.stale":"Ladenhüter-Warnung ab (Tage)","prof.avatar":"Profilbild hochladen",
    "mode.dark":"Dunkel","mode.light":"Hell",
    "btn.save":"Speichern","btn.cancel":"Abbrechen","btn.add":"Hinzufügen","ui.close":"Eingabe schließen",
    "toast.palette":"Palette","toast.saved":"✓ Gespeichert","toast.deleted":"Gelöscht"
  },
  en:{
    "tab.dashboard":"Dashboard","tab.tracker":"Tracker","tab.calc":"Fee Calc","tab.inventory":"Inventory","tab.fix":"Fixed Costs","tab.report":"Reports","tab.pwgen":"Passwords","tab.admin":"Admin","tab.profil":"Profile",
    "nav.logout":"Log out",
    "login.subtitle":"Reselling cockpit","login.user":"Username or email","login.pass":"Password","login.remember":"Stay signed in","login.btn":"Sign in","login.err":"Wrong username or password.",
    "dash.revenue":"Revenue","dash.profit":"Net profit","dash.margin":"Margin","dash.history":"History","dash.search":"Search product or EAN…","dash.recent":"Recent deals",
    "track.add":"Add new deal","track.recent":"Recent deals","track.empty":"No deals in range",
    "calc.title":"Fee calculator","calc.toInv":"Send to inventory ↗","calc.toTracker":"Send to tracker ↗",
    "inv.stock":"Inventory","inv.units":"Items","inv.capital":"Capital tied up","inv.potential":"Potential profit","inv.add":"Add new item","inv.create":"Add stock manually","inv.protect":"Price protection active","inv.empty":"Inventory is empty",
    "fix.title":"Fixed Costs","fix.add":"New expense","fix.monthly":"Monthly fixed costs","fix.algo":"Target margin","fix.revenue":"Monthly revenue €","fix.packages":"Parcels / month","fix.base":"Base profit margin %","fix.empty":"No expenses yet",
    "prof.title":"Profile","prof.pw":"Change password","prof.appearance":"Appearance","prof.mode":"Theme","prof.lang":"Language","prof.stale":"Slow-mover warning after (days)","prof.avatar":"Upload profile picture",
    "mode.dark":"Dark","mode.light":"Light",
    "btn.save":"Save","btn.cancel":"Cancel","btn.add":"Add","ui.close":"Close",
    "toast.palette":"Palette","toast.saved":"✓ Saved","toast.deleted":"Deleted"
  }
};
function t(key){ return (I18N[lang] && I18N[lang][key]) || (I18N.de[key]) || key; }
function applyI18n(){
  $$("[data-i18n]").forEach(el=>{ const k=el.getAttribute("data-i18n"); const v=t(k); if(v) el.textContent=v; });
  $$("[data-i18n-ph]").forEach(el=>{ const k=el.getAttribute("data-i18n-ph"); const v=t(k); if(v) el.setAttribute("placeholder",v); });
  document.documentElement.setAttribute("lang", lang);
}
function setLang(l){ lang=l; DB.setSetting("lang",l); applyI18n();
  // dynamische Views neu rendern, damit per t() erzeugte Strings mitwechseln
  if(currentUser){ buildThemeMenu(); try{ renderTrackerList(); renderInventory(); renderFixed(); renderProfil(); }catch(e){} }
}


/* ===== 4 · AUTH ===== */
let users = DB.getUsers();
let avatarUrl = null;
function renderAvatar(){
  const uname = displayName();
  const init = uname.slice(0,2).toUpperCase();
  const inner = avatarUrl ? `<img src="${attrEsc(avatarUrl)}" alt="">` : `<span>${init}</span>`;
  $("#nav-avatar").innerHTML = inner;
  $("#nav-username").textContent = uname;
  const pv=$("#profil-avatar"); if(pv) pv.innerHTML = avatarUrl ? `<img src="${attrEsc(avatarUrl)}" alt="">` : `<span>${init}</span>`;
}
async function enterApp(){
  // Login sofort sichtbar quittieren
  $("#menu-admin").style.display = currentUser.role==="owner" ? "" : "none";
  hideSplash();
  $("#login-view").classList.add("hidden"); $("#pending-view").classList.add("hidden"); $("#app-view").classList.remove("hidden");
  applyI18n();

  // --- Daten aus Supabase laden (pro User getrennt via RLS) ---
  // Neue Konten starten komplett leer – keine Demo-/Beispieldaten.
  // Alle Datensätze PARALLEL laden (vorher nacheinander -> deutlich schnellerer Start)
  const [ _flips, _calcs, _inv, _avatar, _fixed, _fixcfg, _shipcfg ] = await Promise.all([
    DB.getFlips(), DB.getCalcs(), DB.getInventory(), DB.getAvatar(), DB.getFixed(), DB.getFixCfg(), DB.getShipCfg()
  ]);
  flips = _flips || []; calcs = _calcs || []; inventory = _inv || []; avatarUrl = _avatar || null; fixed = _fixed || [];
  fixCfg = _fixcfg || {revenue:4000, packages:60, baseMargin:15};
  syncCustomMarkets();   // eigene Marktplätze aus fixCfg in PLATFORMS spiegeln, bevor irgendwas rendert
  shipCfg = normalizeShipCfg(_shipcfg);
  await profileUpsert();

  renderShipPresets(); initShipDropdowns(); applyShipDefaults();
  try{ taxCfg = await DB.getTaxCfg() || null; }catch(e){ console.warn("[taxcfg load]", e); }
  if(taxCfg && typeof taxCfg==="object"){
    kuMode = !!taxCfg.kuMode;
    defaultUstRate = taxCfg.defaultUstRate || 19;
    defaultPlatform = PLATFORMS[taxCfg.defaultPlatform] ? taxCfg.defaultPlatform : "ebay";
    if(taxCfg.tourDone){ try{ Store.set(uKey("tourdone"),"1"); }catch(e){} }   // kontoweit: Tour nie wieder zeigen
  } else {
    // Kein Konto-Datensatz vorhanden (erster Login überhaupt) -> lokale Fallbacks behalten
    defaultUstRate = parseInt(Store.get(uKey("ustrate"))||"19")||19;
    defaultPlatform = Store.get(uKey("platform")) || "ebay";
    if(!PLATFORMS[defaultPlatform]) defaultPlatform="ebay";
  }
  maybeAutoBackup();   // Ebene 1: lokale Tagessicherung
  maybeCloudBackup();  // Ebene 2: Cloud-Sicherung in Supabase (fire-and-forget)
  snapInit();          // Ebene 3: feingranulare Wiederherstellungs-Punkte scharf schalten
  setTimeout(()=>{ try{ maybeAutoMigrate(); }catch(e){} }, 6000);  // Bilder automatisch im Hintergrund in den Storage sichern
  setTimeout(()=>{ try{ maybeAutoWeeklyDownload(); }catch(e){} }, 9000);  // wöchentliches Datei-Backup automatisch herunterladen
  mountFilters(); buildMonthChains(); renderAvatar(); renderAdmin(); renderProfil(); renderFixed(); refreshBuyPlatSelect(); refreshPaySelects();
  // Deep-Link respektieren: kommt die App über #calc/#inventory/... rein, dort starten
  var _tabs=["dashboard","tracker","calc","inventory","fix","report","pwgen","admin","profil"];
  var _want=(location.hash||"").replace(/^#/,"");
  // Hat der Nutzer während des Ladens schon einen Tab geöffnet, DORT bleiben (nicht zurück aufs Dashboard springen).
  // In jedem Fall den nun aktiven Tab mit den frisch geladenen Daten neu rendern.
  var _sel = document.querySelector('#tabs button[aria-selected="true"]');
  var _target = (_navPicked && _sel) ? _sel.dataset.tab : (_tabs.indexOf(_want)>-1 ? _want : "dashboard");
  setTab(_target, true);
  renderCalcHistory(); calc();
  refreshPendingBadge(true);   // Owner: offene Registrierungsanfragen melden (Toast + Badge + Dashboard-Hinweis)
  initHistory();               // Undo/Redo-Ausgangspunkt setzen
  if((!taxCfg || !taxCfg.onboarded) && Store.get(uKey("onboarded"))!=="1") setTimeout(openAccountSetup, 300); else startTourIfNew();   // Ersteinrichtung nur beim allerersten Login dieses KONTOS (kontoweit, nicht pro Gerät); sonst ggf. Erst-Login-Tour
}
function hideSplash(){ const s=$("#boot-splash"); if(s) s.classList.add("hidden"); }
function showLogin(){ hideSplash(); $("#app-view").classList.add("hidden"); $("#login-view").classList.remove("hidden"); }
/* Supabase-Fehler -> verständliche deutsche Meldung */
function authErrorDE(msg){
  const m = (msg||"").toLowerCase();
  if(m.includes("invalid login")) return "Username oder Passwort falsch.";
  if(m.includes("email not confirmed")) return "Konto noch nicht bestätigt — in Supabase die E-Mail-Bestätigung ausschalten (siehe Anleitung).";
  if(m.includes("already registered") || m.includes("already been registered")) return "Den Username gibt es schon — einfach unten auf „Anmelden“.";
  if(m.includes("password should be")) return "Passwort zu kurz (mindestens 6 Zeichen).";
  if(m.includes("failed to fetch") || m.includes("networkerror")) return "Keine Verbindung zu Supabase. Internet & API-Key prüfen.";
  return msg || "Unbekannter Fehler.";
}
function showLoginErr(txt){ const e=$("#login-err"); e.textContent=txt; e.classList.remove("hidden"); }

async function doLogin(){
  const id   = $("#username").value.trim();
  const pass = $("#password").value;
  $("#login-err").classList.add("hidden");
  if(!id || !pass){ showLoginErr("Bitte Benutzername/E-Mail und Passwort eingeben."); return; }
  if(!sb){ showLoginErr("Keine Verbindung zu Supabase (Internet/CDN?). Bitte online sein und neu laden."); return; }
  try{
    let email = id;
    if(!id.includes("@")){
      // Username eingegeben -> passende E-Mail per RPC holen; klappt das nicht (RPC fehlt / Alt-Konto), Fallback aufs alte Schema.
      try{ const { data, error } = await sb.rpc("email_for_username", { uname: id }); email = (!error && data) ? data : toEmail(id); }
      catch(e){ email = toEmail(id); }
    }
    const { data, error } = await sb.auth.signInWithPassword({ email: email, password: pass });
    if(error){ console.warn("[login]", error.message); showLoginErr(authErrorDE(error.message)); return; }
    await handlePostAuth(data.user);
  }catch(e){ console.error("[login] Crash:", e); showLoginErr("Technischer Fehler — Konsole prüfen (F12)."); }
}

async function doRegister(){
  const uname  = $("#username").value.trim();
  const email  = $("#signup-email")  ? $("#signup-email").value.trim()  : "";
  const email2 = $("#signup-email2") ? $("#signup-email2").value.trim() : "";
  const pass   = $("#password").value;
  const pass2  = $("#password2") ? $("#password2").value : "";
  $("#login-err").classList.add("hidden"); $("#login-ok").classList.add("hidden");
  if(!uname){ showLoginErr("Bitte einen Benutzernamen wählen."); return; }
  if(uname.includes("@")){ showLoginErr("Der Benutzername darf kein @ enthalten — die E-Mail gibst du separat ein."); return; }
  if(!email || !email.includes("@") || email.lastIndexOf(".")<email.indexOf("@")){ showLoginErr("Bitte eine gültige E-Mail-Adresse eingeben."); return; }
  if(email.toLowerCase()!==email2.toLowerCase()){ showLoginErr("Die beiden E-Mail-Adressen stimmen nicht überein."); return; }
  if(pass.length < 6){ showLoginErr("Passwort muss mindestens 6 Zeichen haben."); return; }
  if(pass !== pass2){ showLoginErr("Die beiden Passwörter stimmen nicht überein."); return; }
  if(!sb){ showLoginErr("Keine Verbindung zu Supabase (Internet/CDN?). Bitte online sein und neu laden."); return; }
  const btn=$("#register-btn"); const ol=btn.textContent; btn.disabled=true; btn.textContent="Wird erstellt…";
  try{
    const { data, error } = await sb.auth.signUp({ email: email, password: pass, options:{ data:{ username: uname } } });
    if(error){ console.warn("[register]", error.message); showLoginErr(authErrorDE(error.message)); return; }
    // Falls sofort eine Session entstand (E-Mail-Bestätigung AUS): wieder abmelden -> sauber zum Login
    if(data.session){ try{ await sb.auth.signOut(); }catch(e){} }
    // Erfolg -> zurück in den Login-Modus, Username vorausfüllen
    if(typeof setAuthMode==="function") setAuthMode("login");
    $("#password").value=""; if($("#password2")) $("#password2").value=""; if($("#signup-email")) $("#signup-email").value=""; if($("#signup-email2")) $("#signup-email2").value=""; $("#username").value=uname;
    const okEl=$("#login-ok");
    okEl.textContent = "✓ Registrierung eingegangen. Ein Admin muss dein Konto noch freigeben — danach kannst du dich anmelden.";
    okEl.classList.remove("hidden");
    $("#password").focus();
  }catch(e){ console.error("[register] Crash:", e); showLoginErr("Technischer Fehler — Konsole prüfen (F12)."); }
  finally{ btn.disabled=false; btn.textContent=ol; }
}

/* Login/Signup-Modus umschalten (gleiche Felder, klar getrennte Aktion) */
let authMode = "login";
function setAuthMode(mode){
  authMode = mode;
  const signup = mode === "signup";
  $("#auth-tab-login").setAttribute("aria-selected", signup ? "false" : "true");
  $("#auth-tab-signup").setAttribute("aria-selected", signup ? "true" : "false");
  $("#signup-emails").classList.toggle("hidden", !signup);
  $("#signup-extra").classList.toggle("hidden", !signup);
  $("#remember-row").classList.toggle("hidden", signup);
  $("#login-btn").classList.toggle("hidden", signup);
  $("#register-btn").classList.toggle("hidden", !signup);
  $("#forgot-row") && $("#forgot-row").classList.toggle("hidden", signup);
  $("#login-err").classList.add("hidden"); $("#login-ok").classList.add("hidden");
  $("#password").setAttribute("autocomplete", signup ? "new-password" : "current-password");
  // Feld-Label & Platzhalter passend zum Modus (im Signup ist es klar der neue Username)
  const ul=$("#user-label"); if(ul) ul.textContent = signup ? "Benutzername" : "Benutzername oder E-Mail";
  const uin=$("#username"); if(uin) uin.setAttribute("placeholder", signup ? "z. B. flipking" : "Name oder deine@email.de");
  // Desktop-Download-Zeile stört das lange Signup-Formular -> nur im Login zeigen
  document.querySelectorAll(".desktop-dl").forEach(el => el.classList.toggle("hidden", signup));
  const hint=$("#login-hint"); if(hint) hint.textContent = signup
    ? "Username & Passwort einmalig festlegen. Nach dem Erstellen meldest du dich damit an."
    : "Noch kein Konto? Oben auf „Neues Konto“ wechseln, Daten vergeben und erstellen.";
}
$("#auth-tab-login").addEventListener("click", ()=> setAuthMode("login"));
$("#auth-tab-signup").addEventListener("click", ()=> setAuthMode("signup"));
$("#login-btn").addEventListener("click", doLogin);
$("#register-btn").addEventListener("click", doRegister);
function authSubmit(){ if(authMode==="signup") doRegister(); else doLogin(); }
$("#username").addEventListener("keydown", e=>{ if(e.key==="Enter") authSubmit(); });
$("#password").addEventListener("keydown", e=>{ if(e.key==="Enter") authSubmit(); });
document.addEventListener("keydown", e=>{ if(e.key==="Enter" && e.target && e.target.id==="password2") doRegister(); });
$("#logout-btn").addEventListener("click", async ()=>{ await sb.auth.signOut(); currentUser=null; showLogin(); });

/* ===== Passwort vergessen · Reset per E-Mail (Supabase) ===== */
function openPasswordReset(){
  const pre = ($("#username")&&$("#username").value.trim())||"";
  $("#modal-root").innerHTML=`<div class="overlay" id="ov"><div class="modal" style="max-width:400px">
    <div class="flex items-start justify-between gap-3 mb-2"><p class="font-bold text-[17px]">Passwort zurücksetzen</p><button id="pr-x" class="iconbtn" title="Schließen"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg></button></div>
    <p class="c-sub text-[12.5px] leading-relaxed mb-3">Gib die <b>E-Mail</b> deines Kontos ein — wir schicken dir einen Link zum Zurücksetzen.</p>
    <input id="pr-email" class="field" type="email" placeholder="deine@email.de" value="${attrEsc(pre.includes('@')?pre:'')}" autocomplete="email">
    <button id="pr-send" class="btn-accent w-full" style="margin-top:14px">Reset-Link senden</button>
    <p id="pr-msg" class="text-[12.5px] mt-3 leading-relaxed"></p>
    <p class="c-sub text-[11px] mt-2 leading-relaxed">Funktioniert nur, wenn du dich mit einer <b>echten E-Mail</b> registriert hast. Hast du nur einen Benutzernamen genutzt, wende dich an den Betreiber.</p>
  </div></div>`;
  const close=()=>{ $("#modal-root").innerHTML=""; };
  $("#pr-x").addEventListener("click",close); const ov=$("#ov"); if(ov) ov.addEventListener("click",e=>{ if(e.target===ov) close(); });
  $("#pr-send").addEventListener("click",async()=>{ const em=$("#pr-email").value.trim(); if(!em||!em.includes("@")){ flashError($("#pr-email")); return; }
    const btn=$("#pr-send"); btn.disabled=true; btn.textContent="Sende…";
    try{ const { error } = await sb.auth.resetPasswordForEmail(em, { redirectTo: location.origin+location.pathname });
      if(error){ $("#pr-msg").innerHTML=`<span style="color:var(--danger)">${escapeHtml(error.message)}</span>`; btn.disabled=false; btn.textContent="Reset-Link senden"; }
      else { $("#pr-msg").innerHTML=`<span style="color:var(--accent)">✓ Falls ein Konto mit dieser E-Mail existiert, ist ein Reset-Link unterwegs. Schau auch im Spam-Ordner.</span>`; btn.textContent="Gesendet ✓"; }
    }catch(e){ $("#pr-msg").innerHTML=`<span style="color:var(--danger)">Fehler: ${escapeHtml(e&&e.message||"unbekannt")}</span>`; btn.disabled=false; btn.textContent="Reset-Link senden"; }
  });
}
if($("#forgot-pw")) $("#forgot-pw").addEventListener("click", openPasswordReset);
/* Nach Klick auf den Reset-Link: neues Passwort setzen (Supabase-Session ist im „recovery"-Modus). */
function openSetNewPassword(){
  $("#modal-root").innerHTML=`<div class="overlay" id="ov"><div class="modal" style="max-width:400px">
    <p class="font-bold text-[17px] mb-1">Neues Passwort festlegen</p>
    <p class="c-sub text-[12.5px] leading-relaxed mb-3">Du bist über den Reset-Link angemeldet. Vergib jetzt ein neues Passwort.</p>
    <input id="np-new" class="field" type="password" placeholder="Neues Passwort (min. 6 Zeichen)" autocomplete="new-password" style="margin-bottom:9px">
    <input id="np-cf" class="field" type="password" placeholder="Wiederholen" autocomplete="new-password">
    <button id="np-save" class="btn-accent w-full" style="margin-top:14px">Passwort speichern &amp; einloggen</button>
    <p id="np-msg" class="text-[12.5px] mt-3"></p>
  </div></div>`;
  $("#np-save").addEventListener("click",async()=>{ const a=$("#np-new").value, b=$("#np-cf").value;
    if(!a||a.length<6){ flashError($("#np-new")); $("#np-msg").innerHTML=`<span style="color:var(--danger)">Mindestens 6 Zeichen.</span>`; return; }
    if(a!==b){ flashError($("#np-cf")); $("#np-msg").innerHTML=`<span style="color:var(--danger)">Passwörter stimmen nicht überein.</span>`; return; }
    const btn=$("#np-save"); btn.disabled=true; btn.textContent="Speichere…";
    try{ const { error } = await sb.auth.updateUser({ password:a }); if(error) throw error;
      $("#modal-root").innerHTML=""; showToast("✓ Passwort geändert — du bist eingeloggt.");
      try{ const { data:{ session } } = await sb.auth.getSession(); if(session) await handlePostAuth(session.user); else showLogin(); }catch(e){ showLogin(); }
    }catch(e){ $("#np-msg").innerHTML=`<span style="color:var(--danger)">${escapeHtml(e&&e.message||"Fehler")}</span>`; btn.disabled=false; btn.textContent="Passwort speichern & einloggen"; }
  });
}
/* Warte-Screen: erneut prüfen (Admin evtl. schon freigegeben) / abmelden */
if($("#pending-logout")) $("#pending-logout").addEventListener("click", async ()=>{ try{ await sb.auth.signOut(); }catch(e){} currentUser=null; $("#pending-view").classList.add("hidden"); showLogin(); });
if($("#pending-recheck")) $("#pending-recheck").addEventListener("click", async ()=>{
  const b=$("#pending-recheck"), ol=b.textContent; b.disabled=true; b.textContent="Prüfe…";
  try{ const { data:{ session } } = await sb.auth.getSession(); if(session) await handlePostAuth(session.user); }
  catch(e){}
  b.disabled=false; b.textContent=ol;
});
/* Dashboard-Hinweis: springt zur Nutzerverwaltung */
if($("#admin-alert")) $("#admin-alert").addEventListener("click", ()=>setTab("admin"));
$("#profile-btn").addEventListener("click", e=>{ e.stopPropagation();
  const m=$("#profile-menu"), open=m.classList.toggle("hidden")===false;
  $("#profile-btn").setAttribute("aria-expanded", open?"true":"false");
  $("#theme-menu").classList.add("hidden");
});
document.addEventListener("click", e=>{ if(!e.target.closest("#profile-menu") && !e.target.closest("#profile-btn")){
  $("#profile-menu").classList.add("hidden"); $("#profile-btn").setAttribute("aria-expanded","false"); } });
$$("#profile-menu .menu-item[data-tab]").forEach(b=>b.addEventListener("click",()=>{
  setTab(b.dataset.tab); $("#profile-menu").classList.add("hidden"); $("#profile-btn").setAttribute("aria-expanded","false");
}));

/* ===== 5 · TABS ===== */
function moveThumb(){ const btn=$('#tabs button[aria-selected="true"]'); const thumb=$("#tab-thumb");
  if(btn){ thumb.style.opacity="1"; thumb.style.width=btn.offsetWidth+"px"; thumb.style.transform=`translateX(${btn.offsetLeft}px)`; }
  else thumb.style.opacity="0"; }
let _navPicked=false;
function setTab(name, instant){
  if(!instant) _navPicked=true;   // Nutzer hat aktiv navigiert (z. B. schon während des Ladens)
  $$("#tabs button").forEach(b=>b.setAttribute("aria-selected", b.dataset.tab===name));
  ["dashboard","tracker","calc","inventory","fix","report","pwgen","admin","profil","guides"].forEach(v=>{ const el=$("#"+v+"-view"); if(el) el.classList.toggle("hidden", v!==name); });
  const thumb=$("#tab-thumb");
  if(instant){ thumb.style.transition="none"; moveThumb(); requestAnimationFrame(()=>thumb.style.transition=""); } else moveThumb();
  const active=$("#"+name+"-view"); active.classList.remove("view-enter"); void active.offsetWidth; active.classList.add("view-enter");
  const btn=$(`#tabs button[data-tab="${name}"]`); if(btn) btn.scrollIntoView({behavior:"smooth",block:"nearest",inline:"center"});
  if(name==="dashboard") renderDashboard();
  if(name==="calc") setCalcMarket(defaultPlatform==="kaufland"?"kaufland":"ebay", false);
  if(name==="tracker") renderTrackerList();
  if(name==="inventory") renderInventory();
  if(name==="fix") renderFixed();
  if(name==="report") renderReport();
  if(name==="profil") renderProfil();
  if(name==="admin"){ renderAdmin(); renderFeedbackAdmin(); }
  if(name==="guides") renderGuides();
}
$$("#tabs button").forEach(b=>b.addEventListener("click",()=>setTab(b.dataset.tab)));
window.addEventListener("resize", moveThumb);

/* ===== Guides & Hilfe — kurze, klare Erklärungen mit Direkt-Sprung zum Feature ===== */
const GUIDES = [
  { cat:"Erste Schritte", items:[
    { t:"Wie Flipdeck funktioniert", ic:"🚀", act:{tab:"dashboard"}, go:"Zum Dashboard", body:`
      <p>Flipdeck begleitet deinen kompletten Reselling-Kreislauf — von der Kalkulation bis zur Auswertung:</p>
      <ol>
        <li><b>Kalkulieren</b> — im <b>Gebühren-Rechner</b> prüfst du vor dem Kauf, ob sich ein Deal nach Marktplatz-Gebühren lohnt.</li>
        <li><b>Bestand</b> — gekaufte Artikel erfasst du im <b>Bestand</b> mit Einkaufspreis, Zielpreis und Status.</li>
        <li><b>Verkauf</b> — beim Verkauf tippst du auf „Verkaufen" und wählst den Marktplatz; Gebühren &amp; Gewinn rechnet Flipdeck automatisch.</li>
        <li><b>Auswertung</b> — Dashboard &amp; Auswertung zeigen Gewinn, Marge und ROI über jeden Zeitraum.</li>
      </ol>
      <p>Deine Daten liegen sicher in der Cloud und werden automatisch gesichert.</p>` },
  ]},
  { cat:"Bestand &amp; Verkauf", items:[
    { t:"Artikel in den Bestand aufnehmen", ic:"📦", act:{tab:"inventory"}, go:"Zum Bestand", body:`
      <p>Im <b>Bestand</b> legst du jeden Einkauf an, damit du später den Gewinn genau kennst.</p>
      <ul>
        <li><b>Einkaufspreis (EK)</b> und dein geplanter <b>Verkaufspreis (VK)</b>.</li>
        <li><b>Gebühren-Kategorie</b> (bestimmt die eBay-Gebühr) und optional <b>Einkaufsplattform</b> mit Retourenfrist.</li>
        <li>Flipdeck zeigt sofort den <b>Mindest-VK</b> (nie darunter verkaufen) und den <b>Ziel-VK</b> für deine Zielmarge.</li>
      </ul>
      <p>Über den Status (Bestellt → Unterwegs → Im Lager) behältst du auch unterwegs gekaufte Ware im Blick.</p>` },
    { t:"Einen Verkauf eintragen", ic:"💸", act:{tab:"inventory"}, go:"Zum Bestand", body:`
      <p>Beim verkauften Artikel im Bestand auf <b>„Verkaufen"</b> tippen.</p>
      <ul>
        <li><b>Marktplatz wählen</b> — eBay, Kaufland, eBay Privat, Kleinanzeigen … die passenden <b>Gebühren werden automatisch</b> abgezogen.</li>
        <li><b>eBay Privat</b>: innerdeutsch 0 €, Ausland 5 %. <b>Kaufland</b>: Provision je Kategorie.</li>
        <li>Der <b>Gewinn</b> wird live berechnet und landet im Tracker &amp; in der Auswertung.</li>
      </ul>` },
    { t:"Deal-Score &amp; ROI verstehen", ic:"◆", act:{tab:"inventory"}, go:"Zum Bestand", body:`
      <p>Der <b>Deal-Score (A–E)</b> zeigt auf einen Blick, wie profitabel ein Artikel ist — gemessen am <b>ROI</b> (Rendite = Gewinn ÷ Einkaufspreis).</p>
      <ul>
        <li><b>A</b> ≥ 50 % · <b>B</b> ≥ 30 % · <b>C</b> ≥ 15 % · <b>D</b> ≥ 5 % · <b>E</b> darunter/Verlust.</li>
        <li>Tippe im Bestand auf den <b>◆ Deal</b>-Pill für die Erklärung + die Marktplatz-Aufschlüsselung.</li>
      </ul>` },
    { t:"Verkäufe-Übersicht (Nach Produkt)", ic:"📊", act:{tab:"tracker"}, go:"Zu Verkäufe", body:`
      <p>Im <b>Verkäufe</b>-Tab siehst du alle Verkäufe. Bei viel Umschlag nutze die Ansicht <b>„Nach Produkt"</b>:</p>
      <ul>
        <li>Eine Zeile pro Produkt mit Anzahl Verkäufe, Stück und Gesamt-Gewinn.</li>
        <li>Aufklappen zeigt die Einzelverkäufe — wie eine Verkaufs-Chronik.</li>
      </ul>` },
  ]},
  { cat:"Gebühren &amp; Preise", items:[
    { t:"Gebühren-Rechner (eBay &amp; Kaufland)", ic:"🧮", act:{tab:"calc"}, go:"Zum Rechner", body:`
      <p>Der <b>Gebühren-Rechner</b> zeigt vor dem Kauf, was nach Marktplatz-Gebühren übrig bleibt.</p>
      <ul>
        <li>Oben zwischen <b>eBay</b> und <b>Kaufland</b> umschalten (öffnet automatisch deinen Standard-Marktplatz).</li>
        <li>EK, VK, Versand &amp; Kategorie eingeben → Reingewinn, Marge und Zielmargen-Ampel erscheinen live.</li>
        <li>„Zu Bestand hinzufügen" übernimmt die Werte direkt.</li>
      </ul>` },
    { t:"eBay Privat vs. gewerblich", ic:"🏷️", act:{tab:"calc"}, go:"Zum Rechner", body:`
      <p>Beim Verkauf-Eintragen wählst du den passenden eBay-Typ:</p>
      <ul>
        <li><b>eBay (gewerblich)</b> — Verkaufsprovision je Kategorie + Transaktionsgebühr.</li>
        <li><b>eBay · Privat</b> — innerdeutsch <b>gebührenfrei</b>, ins Ausland <b>5 %</b> auf (Artikel + Porto).</li>
      </ul>
      <p>Welche Marktplätze zur Auswahl stehen, stellst du unter Geschäft → Marktplätze ein.</p>` },
  ]},
  { cat:"Kosten &amp; Auswertung", items:[
    { t:"Fixkosten &amp; Zielmarge", ic:"🧾", act:{tab:"fix"}, go:"Zu Fixkosten", body:`
      <p>Im <b>Fixkosten</b>-Tab erfasst du wiederkehrende Kosten (Abos, Material …) mit <b>frei wählbarem Intervall</b> (monatlich, jährlich, alle X Tage …) und Startdatum — die nächste Fälligkeit wird berechnet.</p>
      <p>Die <b>Zielmarge</b> (Standard 15 %) ist deine gewünschte Gewinn-Marge je Artikel. Sie bestimmt den vorgeschlagenen <b>Ziel-VK</b> im Bestand — hier im Tab einstellbar.</p>` },
    { t:"Auswertung lesen", ic:"📈", act:{tab:"report"}, go:"Zur Auswertung", body:`
      <p>Die <b>Auswertung</b> fasst einen Zeitraum (Monat/Jahr) zusammen: <b>Gewinn, Umsatz, Ausgaben, Marge</b> und die Aufteilung nach Produkten, Plattformen und Fixkosten.</p>
      <p>Im <b>Dashboard</b> siehst du die wichtigsten Kennzahlen mit Zeitraum-Filtern — per „Anpassen" wählst du, welche Karten erscheinen.</p>` },
  ]},
  { cat:"Einrichtung &amp; Daten", items:[
    { t:"Marktplätze wählen &amp; eigene anlegen", ic:"🛒", act:{tab:"profil",scat:"geschaeft"}, go:"Zu Marktplätzen", body:`
      <p>Unter <b>Geschäft → Marktplätze</b> schaltest du ein, welche Marktplätze im Verkauf-Dialog erscheinen.</p>
      <ul>
        <li>Fehlt einer? <b>„Eigenen Marktplatz anlegen"</b> — läuft ohne Gebühren-Automatik (Auszahlung selbst eintragen).</li>
        <li>Echte Gebühren-Struktur gewünscht? Per <b>Feedback</b> melden — wird ergänzt.</li>
      </ul>` },
    { t:"Verkäufe per CSV importieren", ic:"⬆️", act:{tab:"profil",scat:"daten"}, go:"Zum Import", body:`
      <p>Umstieg von eBay/Excel? Unter <b>Daten → Verkäufe importieren (CSV)</b> lädst du deine Verkäufe hoch.</p>
      <ul>
        <li>Am einfachsten mit der <b>Vorlage</b>.</li>
        <li>Flipdeck <b>erkennt die Spalten automatisch</b> (auch fremde Exporte) — du prüfst nur die Vorschau und klickst Import.</li>
        <li>„Verkaufspreis" = der Betrag, den du <b>tatsächlich erhalten</b> hast (nach Gebühren).</li>
      </ul>` },
    { t:"Datensicherheit &amp; Backups", ic:"🛡️", act:{tab:"profil",scat:"daten"}, go:"Zu Daten", body:`
      <p>Deine Daten sind <b>automatisch sicher</b>: laufende Cloud-Sicherung, tägliche Backups und Wiederherstellungs-Punkte, auf die du jederzeit zurück kannst.</p>
      <p>Für ganz sicher lädst du unter <b>Daten</b> ab und zu ein <b>Backup als Datei</b> herunter.</p>` },
  ]},
];
let _guidesOpen = new Set();
function renderGuides(){
  const box=$("#guides-list"); if(!box) return;
  box.innerHTML = GUIDES.map(cat=>`
    <div class="mb-6">
      <p class="label mb-2.5" style="letter-spacing:.08em">${cat.cat}</p>
      <div class="flex flex-col gap-2.5">
        ${cat.items.map((g,i)=>{ const id=cat.cat.replace(/[^a-zA-Z]/g,"")+"-"+i, open=_guidesOpen.has(id);
          return `<div class="cell" style="overflow:hidden;padding:0">
            <button type="button" class="guide-head" data-id="${id}" style="display:flex;align-items:center;gap:12px;width:100%;text-align:left;padding:15px 16px;background:none;border:0;cursor:pointer">
              <span style="flex:0 0 auto;font-size:19px;line-height:1">${g.ic}</span>
              <span class="flex-1 min-w-0"><span class="font-semibold text-[15px]">${g.t}</span></span>
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="var(--sub)" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" style="flex:0 0 auto;transition:transform .2s;transform:rotate(${open?90:0}deg)"><path d="m9 18 6-6-6-6"/></svg>
            </button>
            <div class="guide-body ${open?"":"hidden"}" style="padding:0 16px 16px">
              <div class="guide-content" style="color:var(--sub);font-size:13.5px;line-height:1.65">${g.body}</div>
              <button type="button" class="btn-accent guide-go" data-tab="${g.act.tab}" data-scat="${g.act.scat||""}" style="margin-top:12px;display:inline-flex;align-items:center;gap:7px;width:auto;padding:9px 15px">${g.go} →</button>
            </div>
          </div>`; }).join("")}
      </div>
    </div>`).join("");
  $$("#guides-list .guide-head").forEach(b=>b.addEventListener("click",()=>{ const id=b.dataset.id; if(_guidesOpen.has(id)) _guidesOpen.delete(id); else _guidesOpen.add(id); renderGuides(); }));
  $$("#guides-list .guide-go").forEach(b=>b.addEventListener("click",()=>{ const tab=b.dataset.tab, scat=b.dataset.scat; setTab(tab); if(scat) setTimeout(()=>setSettingsCat(scat),50); window.scrollTo({top:0,behavior:"smooth"}); }));
}

/* ===== 6 · FILTER (geteilt zwischen Dashboard & Tracker) ===== */
let filterMode="range", activeRange=7, activeMonth=null;
function mountFilters(){ $("#filter-slot-d").innerHTML="";
  $("#filter-slot-d").appendChild($("#filter-tpl").content.cloneNode(true));
  $$(".range-group button").forEach(b=>b.addEventListener("click",()=>{ filterMode="range"; activeRange=b.dataset.range; activeMonth=null; syncFilterButtons(); renderDashboard(); }));
}
function buildMonthChains(){ const n=new Date();
  $$(".month-chain").forEach(chain=>{ chain.innerHTML=MONTHS.map((m,i)=>`<button data-month="${i}" aria-selected="false" ${i>n.getMonth()?'style="opacity:.4"':""}>${m}</button>`).join(""); });
  $$(".month-chain button").forEach(b=>b.addEventListener("click",()=>{ filterMode="month"; activeMonth=parseInt(b.dataset.month); syncFilterButtons(); renderDashboard(); }));
  syncFilterButtons();
}
function syncFilterButtons(){
  $$(".range-group button").forEach(b=>b.setAttribute("aria-selected", filterMode==="range"&&b.dataset.range===String(activeRange)));
  $$(".month-chain button").forEach(b=>b.setAttribute("aria-selected", filterMode==="month"&&parseInt(b.dataset.month)===activeMonth));
}
function startOfWeek(ref){ const d=new Date(ref); const wd=(d.getDay()+6)%7; d.setHours(0,0,0,0); d.setDate(d.getDate()-wd); return d; }  // Montag = Wochenstart
function inFilter(iso){ const d=new Date(iso); const n=new Date();
  if(filterMode==="month"){ return d.getFullYear()===n.getFullYear()&&d.getMonth()===activeMonth; }
  const rk=activeRange;
  if(rk==="all")  return true;
  if(rk==="today")return d.getFullYear()===n.getFullYear()&&d.getMonth()===n.getMonth()&&d.getDate()===n.getDate();
  if(rk==="week") return d.getTime()>=startOfWeek(n).getTime();
  if(rk==="year") return d.getFullYear()===n.getFullYear();
  const days=parseInt(rk)||365; return (Date.now()-d.getTime())<=days*86400000; }
/* gleiche Länge, aber die Periode DAVOR – für Trend-Vergleiche */
function prevFilter(iso){ const d=new Date(iso); const n=new Date();
  if(filterMode==="month"){ let y=n.getFullYear(), m=activeMonth-1; if(m<0){ m=11; y--; } return d.getFullYear()===y && d.getMonth()===m; }
  const rk=activeRange;
  if(rk==="all") return false;
  if(rk==="today"){ const y=new Date(n); y.setDate(y.getDate()-1); return d.getFullYear()===y.getFullYear()&&d.getMonth()===y.getMonth()&&d.getDate()===y.getDate(); }
  if(rk==="week"){ const s=startOfWeek(n); const ps=new Date(s); ps.setDate(ps.getDate()-7); return d.getTime()>=ps.getTime() && d.getTime()<s.getTime(); }
  if(rk==="year") return d.getFullYear()===n.getFullYear()-1;
  const days=parseInt(rk)||365; const age=Date.now()-d.getTime(); return age>days*86400000 && age<=2*days*86400000; }
function cmpLabel(){ return filterMode==="month" ? "Vormonat" : "Vorperiode"; }
/* kompakte €-Kurzform für enge Diagramm-Beschriftungen (1.234 -> „1,2k“) */
function compactEur(n){ const a=Math.abs(n); if(a>=1000) return (n<0?"-":"")+(a/1000).toLocaleString("de-DE",{maximumFractionDigits:1})+"k"; return Math.round(n).toLocaleString("de-DE"); }

/* ===== 7 · DASHBOARD ===== */
let flips=[];
let highlightId=null;
function animate(el,target,fmt){ if(matchMedia("(prefers-reduced-motion:reduce)").matches){ el.textContent=fmt(target); return; }
  const start=performance.now(),dur=500; (function step(t){ const p=Math.min((t-start)/dur,1),e=1-Math.pow(1-p,3); el.textContent=fmt(target*e); if(p<1) requestAnimationFrame(step); })(start); }
function renderKPIs(){ const view=flips.filter(f=>inFilter(f.date));
  const revenue=view.reduce((s,f)=>s+flipRevenue(f),0), profit=view.reduce((s,f)=>s+flipProfit(f),0), margin=revenue>0?profit/revenue*100:0;
  const cost=view.reduce((s,f)=>s+num(f.ek)*(f.qty||1),0), roi=cost>0?profit/cost*100:0;
  animate($("#kpi-revenue"),revenue,eur); animate($("#kpi-profit"),profit,eur); animate($("#kpi-margin"),margin,pct); if($("#kpi-roi")) animate($("#kpi-roi"),roi,pct);

  // Trend ggü. der gleich langen Vorperiode
  const prev=flips.filter(f=>prevFilter(f.date));
  const prevProfit=prev.reduce((s,f)=>s+flipProfit(f),0), prevRev=prev.reduce((s,f)=>s+flipRevenue(f),0);
  const cnt=view.length;
  let sub=`aus ${cnt} ${cnt===1?"Verkauf":"Verkäufen"}`;
  if(prev.length){
    const dAbs=profit-prevProfit, up=dAbs>=0, col=up?"var(--accent)":"var(--danger)", arrow=up?"▲":"▼";
    const dPct = prevProfit!==0 ? ` (${up?"+":""}${(dAbs/Math.abs(prevProfit)*100).toLocaleString("de-DE",{maximumFractionDigits:0})} %)` : "";
    sub += ` · <span style="color:${col};font-weight:800">${arrow} ${up?"+":""}${eur(dAbs)}</span><span class="c-sub">${dPct} ggü. ${cmpLabel()}</span>`;
  }
  $("#kpi-profit-sub").innerHTML=sub;

  // Umsatz-KPI bekommt einen dezenten Trend
  const rSub=$("#kpi-revenue-sub");
  if(rSub){
    if(prev.length && prevRev>0){ const dr=revenue-prevRev, up=dr>=0;
      rSub.innerHTML=`Netto · <span style="color:${up?'var(--accent)':'var(--danger)'};font-weight:700">${up?"▲":"▼"} ${(dr/prevRev*100).toLocaleString("de-DE",{maximumFractionDigits:0})} %</span>`;
    } else rSub.textContent="Netto";
  } }
function flipRowHTML(f){ const profit=flipProfit(f),rev=flipRevenue(f),margin=rev>0?profit/rev*100:0,pos=profit>=0; const plat=PLATFORMS[f.platform]||PLATFORMS.ebay;
  return `<div class="thumb">${ f.img?`<img src="${attrEsc(f.img)}" alt="" style="width:100%;height:100%;object-fit:cover">`:`<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--sub)" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="4"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>` }</div>
    <div class="flex-1 min-w-0"><div class="flex items-center gap-2 mb-1"><span class="pill ${plat.pill}">${plat.label}</span><span class="c-sub text-[12px]">${fmtDate(f.date)}</span>${f.qty>1?`<span class="pill pill-mut">×${f.qty}</span>`:""}${f.returned?`<span class="pill" style="border:1px solid color-mix(in srgb,#f5a524 45%,var(--line));color:#f5a524">↩ Retoure</span>`:""}</div>
      <p class="font-semibold text-[14.5px] leading-snug truncate"${f.returned?' style="text-decoration:line-through;opacity:.7"':''}>${escapeHtml(f.name)}</p>
      <div class="flex items-center gap-2 mt-1.5"><span class="cozy text-[23px]" style="color:${pos?'var(--accent)':'var(--danger)'}">${pos?"+":""}${eur(profit)}</span><span class="pill ${pos?'pill-accent':'pill-mut'}">${pct(margin)} Marge</span></div>
      <p class="c-sub text-[11px] mt-1 mono">EK ${eur(num(f.ek))} · VK ${eur(num(f.payout))}${f.ean?` · ${escapeHtml(f.ean)}`:""}</p></div>`; }
function renderHistory(){ const q=$("#search").value.trim().toLowerCase();
  const all=flips.slice().filter(f=>inFilter(f.date)).sort((a,b)=>new Date(b.date)-new Date(a.date)).filter(f=>!q||f.name.toLowerCase().includes(q)||(f.ean||"").includes(q));
  const list = q ? all : all.slice(0,10);
  $("#hist-count").textContent=flips.filter(f=>inFilter(f.date)).length;
  const box=$("#hist-list"); box.innerHTML=""; $("#hist-empty").classList.toggle("hidden",all.length>0);
  list.forEach(f=>{ const el=document.createElement("div"); el.className="row"+(f.id===highlightId?" flash":"");
    el.innerHTML=flipRowHTML(f)+`<div class="flex flex-col gap-2 shrink-0"><button class="iconbtn h-edit" data-id="${f.id}" title="Bearbeiten">${icoEdit}</button><button class="iconbtn danger h-del" data-id="${f.id}" title="Löschen">${icoTrash}</button></div>`;
    el.addEventListener("click",()=>openFlipDetail(f.id)); box.appendChild(el); });
  $$("#hist-list .h-edit").forEach(b=>b.addEventListener("click",e=>{ e.stopPropagation(); openDealEdit(b.dataset.id); }));
  $$("#hist-list .h-del").forEach(b=>b.addEventListener("click",e=>{ e.stopPropagation(); deleteDeal(b.dataset.id); })); }

function monthlyBuckets(n){ const out=[]; const d0=new Date();
  for(let i=n-1;i>=0;i--){ const d=new Date(d0.getFullYear(),d0.getMonth()-i,1); out.push({y:d.getFullYear(),m:d.getMonth(),label:MONTHS[d.getMonth()],profit:0,revenue:0,cost:0,count:0}); }
  flips.forEach(f=>{ const d=new Date(f.date); const b=out.find(o=>o.y===d.getFullYear()&&o.m===d.getMonth()); if(b){ b.profit+=flipProfit(f); b.revenue+=flipRevenue(f); b.cost+=flipCost(f); b.count+=(f.qty||1); } }); return out; }
function barChartSVG(items,key){ const W=340,H=164,padT=24,padB=26,padX=8;
  const vals=items.map(o=>o[key]), maxV=Math.max(1,...vals), minV=Math.min(0,...vals), range=(maxV-minV)||1;
  const plotH=H-padT-padB, zeroY=padT+(maxV/range)*plotH, n=items.length, slot=(W-padX*2)/n, bw=Math.min(26,slot*0.5);
  let grid="",bars="",labels="",vlabels="";
  for(let g=0;g<=2;g++){ const y=padT+plotH*g/2; grid+=`<line x1="${padX}" y1="${y.toFixed(1)}" x2="${W-padX}" y2="${y.toFixed(1)}" class="grid"/>`; }
  items.forEach((it,i)=>{ const v=it[key],cx=padX+slot*i+slot/2,x=cx-bw/2,h=Math.abs(v)/range*plotH,y=v>=0?zeroY-h:zeroY;
    bars+=`<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(2,h).toFixed(1)}" rx="4" class="${v>=0?'bar':'bar-neg'}"><title>${it.label}: ${eur(v)}</title></rect>`;
    // Wertbeschriftung: über positiven, unter negativen Balken
    const vy = v>=0 ? Math.max(9,y-4) : Math.min(H-padB+11, zeroY+h+11);
    if(Math.abs(v)>=0.005) vlabels+=`<text x="${cx.toFixed(1)}" y="${vy.toFixed(1)}" text-anchor="middle" class="val${v<0?' val-neg':''}">${compactEur(v)}</text>`;
    labels+=`<text x="${cx.toFixed(1)}" y="${H-9}" text-anchor="middle" class="axis">${it.label}</text>`; });
  return `<svg viewBox="0 0 ${W} ${H}" class="chart" preserveAspectRatio="xMidYMid meet">${grid}${bars}${vlabels}${labels}</svg>`; }
/* Gestapelt: Kosten (grau, unten) + Gewinn (grün, oben) = Umsatz (Balkenhöhe).
   Verlustmonate erscheinen komplett rot. So sieht man auf einen Blick, wie viel
   vom Umsatz wirklich Gewinn ist – aussagekräftiger als getrennte Balken. */
function stackedChartSVG(items){ const W=340,H=164,padT=24,padB=26,padX=8;
  const maxV=Math.max(1,...items.map(o=>Math.max(o.revenue,o.cost))), plotH=H-padT-padB, base=H-padB, n=items.length, slot=(W-padX*2)/n, bw=Math.min(30,slot*0.52);
  let grid="",bars="",labels="",vlabels="";
  for(let g=0;g<=2;g++){ const y=padT+plotH*g/2; grid+=`<line x1="${padX}" y1="${y.toFixed(1)}" x2="${W-padX}" y2="${y.toFixed(1)}" class="grid"/>`; }
  items.forEach((it,i)=>{ const cx=padX+slot*i+slot/2, x=cx-bw/2, rev=it.revenue, cost=it.cost, prof=rev-cost;
    if(rev>0 || cost>0){
      if(prof>=0){ const hRev=rev/maxV*plotH, hCost=cost/maxV*plotH;
        bars+=`<rect x="${x.toFixed(1)}" y="${(base-hCost).toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(1,hCost).toFixed(1)}" rx="3" class="bar-cost"><title>${it.label} Kosten: ${eur(cost)}</title></rect>`;
        bars+=`<rect x="${x.toFixed(1)}" y="${(base-hRev).toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(1,hRev-hCost).toFixed(1)}" rx="3" class="bar"><title>${it.label} Gewinn: ${eur(prof)}</title></rect>`;
        vlabels+=`<text x="${cx.toFixed(1)}" y="${Math.max(9,base-hRev-4).toFixed(1)}" text-anchor="middle" class="val">${compactEur(rev)}</text>`;
      } else { const hRev=rev/maxV*plotH;
        bars+=`<rect x="${x.toFixed(1)}" y="${(base-hRev).toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(1,hRev).toFixed(1)}" rx="3" class="bar-neg"><title>${it.label} Verlust: ${eur(prof)}</title></rect>`;
        vlabels+=`<text x="${cx.toFixed(1)}" y="${Math.max(9,base-hRev-4).toFixed(1)}" text-anchor="middle" class="val val-neg">${compactEur(prof)}</text>`;
      }
    }
    labels+=`<text x="${cx.toFixed(1)}" y="${H-9}" text-anchor="middle" class="axis">${it.label}</text>`; });
  return `<svg viewBox="0 0 ${W} ${H}" class="chart" preserveAspectRatio="xMidYMid meet">${grid}${bars}${vlabels}${labels}</svg>`; }
function donutSVG(){
  const view=flips.filter(f=>inFilter(f.date));
  let ek=0, ship=0, profit=0;
  view.forEach(f=>{ const q=f.qty||1; ek+=num(f.ek)*q; ship+=num(f.ship)*q; profit+=flipProfit(f); });
  const pPos=Math.max(0,profit);
  const total=ek+ship+pPos;
  if(total<=0) return `<div class="c-sub text-[13px] text-center py-10">Noch keine Daten im Zeitraum.</div>`;
  const segs=[
    {label:"Gewinn",  val:pPos, color:"var(--accent)"},
    {label:"Einkauf", val:ek,   color:"var(--sub)"},
    {label:"Versand", val:ship, color:"var(--accent-3)"}
  ].filter(s=>s.val>0);
  const R=52, C=2*Math.PI*R, cx=70, cy=70; let off=0;
  const ring=segs.map(s=>{ const len=s.val/total*C; const dash=`${len} ${C-len}`; const el=`<circle cx="${cx}" cy="${cy}" r="${R}" fill="none" stroke="${s.color}" stroke-width="16" stroke-dasharray="${dash}" stroke-dashoffset="${-off}" transform="rotate(-90 ${cx} ${cy})" stroke-linecap="butt"/>`; off+=len; return el; }).join("");
  const center=`<text x="${cx}" y="${cy-4}" text-anchor="middle" fill="var(--text)" style="font:800 17px Nunito,sans-serif">${(pPos/total*100).toLocaleString("de-DE",{maximumFractionDigits:0})}%</text><text x="${cx}" y="${cy+13}" text-anchor="middle" fill="var(--sub)" style="font:600 10px -apple-system,sans-serif;letter-spacing:.06em">GEWINN</text>`;
  const legend=segs.map(s=>`<div class="flex items-center justify-between text-[12.5px] py-1"><span class="inline-flex items-center gap-2 c-sub"><i style="width:9px;height:9px;border-radius:3px;background:${s.color};display:inline-block"></i>${s.label}</span><span class="mono">${eur(s.val)}</span></div>`).join("");
  return `<div class="flex items-center gap-4"><svg viewBox="0 0 140 140" style="width:140px;height:140px;flex:0 0 140px">${ring}${center}</svg><div class="flex-1 min-w-0">${legend}</div></div>`;
}
function renderCharts(){ const b=monthlyBuckets(6);
  const sumP=b.reduce((s,o)=>s+o.profit,0), sumR=b.reduce((s,o)=>s+o.revenue,0);
  const foot = txt => `<p class="c-sub text-[11.5px] mt-2 pt-2" style="border-top:1px solid color-mix(in srgb,var(--line) 60%,transparent)">${txt}</p>`;
  $("#chart-profit").innerHTML  = barChartSVG(b,"profit") + foot(`Gewinn 6 Mon.: <b style="color:${sumP>=0?'var(--accent)':'var(--danger)'}">${sumP>=0?"+":""}${eur(sumP)}</b>`);
  $("#chart-revcost").innerHTML = stackedChartSVG(b)     + foot(`6 Mon.: Umsatz <b>${eur(sumR)}</b> · Gewinn <b style="color:${sumP>=0?'var(--accent)':'var(--danger)'}">${eur(sumP)}</b>`);
  $("#chart-split").innerHTML   = donutSVG(); }

/* Aufmerksamkeiten/To-Dos: Rückgabefristen, offene Erstattungen, offene Sendungen */
function renderAttention(){
  const card=$("#attention-card"); if(!card) return;
  const items=[];
  inventory.forEach(it=>{
    const st=invStatus(it);
    if(st!=="returned"){
      const dl=deadlineInfo(it.returnBy);
      if(dl && dl.days<=7){ items.push({ prio: dl.days, col:dl.col, icon:"⏰",
        text:`<b>${escapeHtml(it.name)}</b> — ${dl.txt}`, id:it.id, act:"inv" }); }
    }
    if(st==="ordered"||st==="transit"){
      items.push({ prio: 50, col:INV_STATUS[st].col, icon: st==="transit"?"🚚":"📦",
        text:`<b>${escapeHtml(it.name)}</b> — ${INV_STATUS[st].de}${trackUrl(it.buyCarrier,it.buyTracking)?" · Sendung verfolgbar":""}`, id:it.id, act:"inv" }); }
    if(st==="stock"){   // Ladenhüter: liegt zu lange im Regal
      const age=Math.floor((Date.now()-new Date(it.touchedAt||it.date||Date.now()).getTime())/86400000);
      if(age>=staleDays){ const red=age>=staleDays*2;
        items.push({ prio: red?10:20, col: red?"var(--danger)":"#f5a524", icon:"⏳",
          text:`<b>${escapeHtml(it.name)}</b> — liegt seit ${age} Tagen im Regal${red?" · Preis senken?":""}`, id:it.id, act:"inv" }); } }
    if(st==="returned" && it.supReturn && it.supReturn.refund!=="refunded"){
      items.push({ prio: 40, col:"#f5a524", icon:"↩",
        text:`<b>${escapeHtml(it.name)}</b> — Erstattung offen (${eur((it.supReturn.amount)||it.ek*it.qty)})`, id:it.id, act:"returned" }); }
  });
  items.sort((a,b)=>a.prio-b.prio);
  const box=$("#attention-list"), cnt=$("#attention-count");
  if(!items.length){ card.classList.add("hidden"); return; }
  card.classList.remove("hidden"); cnt.textContent=items.length;
  box.innerHTML=items.slice(0,12).map(a=>`<button class="att-row" data-act="${a.act}" data-id="${a.id}" style="display:flex;align-items:center;gap:10px;width:100%;text-align:left;background:var(--cell-2);border:1px solid var(--line);border-radius:12px;padding:10px 12px;cursor:pointer">
    <span style="flex:0 0 auto;width:26px;height:26px;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:14px;background:color-mix(in srgb,${a.col} 15%,transparent)">${a.icon}</span>
    <span class="text-[13px] leading-snug" style="min-width:0">${a.text}</span></button>`).join("");
  $$("#attention-list .att-row").forEach(b=>b.addEventListener("click",()=>{
    invFilter = b.dataset.act==="returned" ? "returned" : "active";
    invExpanded.add(b.dataset.id); setTab("inventory");
    setTimeout(()=>{ const el=[...$$("#inv-list .inv-head")].find(h=>h.dataset.toggle===b.dataset.id); if(el) el.scrollIntoView({behavior:"smooth",block:"center"}); },60);
  }));
}
/* ===== Rückgabefristen-Kalender (Dashboard) + iPhone-Export (.ics) ===== */
function renderDeadlines(){
  const box=$("#deadlines-list"); if(!box) return;
  const all=[];
  inventory.forEach(it=>{ if(invStatus(it)==="returned"||!it.returnBy) return; const dl=deadlineInfo(it.returnBy); if(!dl) return;
    all.push({ it, dl, ts:new Date(it.returnBy+"T12:00:00").getTime() }); });
  all.sort((a,b)=>a.ts-b.ts);
  const view=all.filter(x=>x.dl.days>=-3);   // knapp Abgelaufenes noch zeigen, uralte weg
  const cnt=$("#deadlines-count"); if(cnt) cnt.textContent=view.length;
  const exp=$("#deadlines-export"); if(exp) exp.style.display=all.length?"":"none";
  if(!view.length){ box.innerHTML=`<p class="c-sub text-[13px] py-5 text-center">Keine offenen Rückgabefristen 🎉<br><span class="text-[11.5px]">Fristen entstehen automatisch, sobald du beim Einkauf eine Einkaufsplattform mit Retourenzeit wählst.</span></p>`; return; }
  box.innerHTML=view.slice(0,40).map(x=>{ const d=new Date(x.it.returnBy+"T12:00:00");
    const day=d.toLocaleDateString("de-DE",{day:"2-digit"}), mon=d.toLocaleDateString("de-DE",{month:"short"}).replace(".","");
    const plat=(x.it.buyPlatformId&&buyPlatformById(x.it.buyPlatformId))?buyPlatformById(x.it.buyPlatformId).name:"";
    return `<button type="button" class="dl-row" data-id="${x.it.id}">
      <span class="dl-date" style="border-color:color-mix(in srgb,${x.dl.col} 45%,var(--line));color:${x.dl.col};background:color-mix(in srgb,${x.dl.col} 10%,transparent)"><span class="dl-day">${day}</span><span class="dl-mon">${mon}</span></span>
      <span class="dl-main"><span class="dl-name">${escapeHtml(x.it.name)}</span><span class="dl-sub" style="color:${x.dl.col}">${x.dl.txt}${plat?` · ${escapeHtml(plat)}`:""}</span></span>
    </button>`; }).join("");
  box.querySelectorAll(".dl-row").forEach(r=>r.addEventListener("click",()=>{ invFilter="active"; invExpanded.add(r.dataset.id); setTab("inventory");
    setTimeout(()=>{ const el=[...$$("#inv-list .inv-head")].find(h=>h.dataset.toggle===r.dataset.id); if(el) el.scrollIntoView({behavior:"smooth",block:"center"}); },80); }));
}
function buildDeadlinesICS(){
  const items=inventory.filter(it=>invStatus(it)!=="returned" && it.returnBy);
  const pad=n=>String(n).padStart(2,"0");
  const now=new Date(); const dstamp=now.getUTCFullYear()+pad(now.getUTCMonth()+1)+pad(now.getUTCDate())+"T"+pad(now.getUTCHours())+pad(now.getUTCMinutes())+pad(now.getUTCSeconds())+"Z";
  const esc=s=>String(s).replace(/\\/g,"\\\\").replace(/;/g,"\\;").replace(/,/g,"\\,").replace(/\r?\n/g,"\\n");
  const L=["BEGIN:VCALENDAR","VERSION:2.0","PRODID:-//Flipdeck//Rueckgabefristen//DE","CALSCALE:GREGORIAN","METHOD:PUBLISH","X-WR-CALNAME:Flipdeck Rückgabefristen","X-PUBLISHED-TTL:PT3H","REFRESH-INTERVAL;VALUE=DURATION:PT3H"];
  items.forEach(it=>{ const dstart=it.returnBy.replace(/-/g,"");
    const s=new Date(it.returnBy+"T00:00:00"), e=new Date(s.getTime()+86400000); const dend=e.getFullYear()+pad(e.getMonth()+1)+pad(e.getDate());
    const plat=(it.buyPlatformId&&buyPlatformById(it.buyPlatformId))?buyPlatformById(it.buyPlatformId).name:"";
    L.push("BEGIN:VEVENT","UID:flipdeck-"+it.id+"@flipdeck","DTSTAMP:"+dstamp,"DTSTART;VALUE=DATE:"+dstart,"DTEND;VALUE=DATE:"+dend,
      "SUMMARY:↩ Rückgabe: "+esc(it.name),
      "DESCRIPTION:"+esc("Rückgabefrist"+(plat?" bei "+plat:"")+(it.ek?" · EK "+eur(it.ek):"")+" — via Flipdeck"),
      "BEGIN:VALARM","ACTION:DISPLAY","DESCRIPTION:Rückgabefrist morgen","TRIGGER:-P1D","END:VALARM","END:VEVENT"); });
  L.push("END:VCALENDAR");
  return { ics:L.join("\r\n"), count:items.length };
}
function exportDeadlinesICS(){ const {ics,count}=buildDeadlinesICS(); if(!count){ showToast("Keine Rückgabefristen zum Exportieren"); return; } downloadFile("flipdeck-rueckgabefristen.ics", ics, "text/calendar"); showToast(`✓ ${count} Rückgabefristen als Kalender exportiert`); }

/* ===== Live-Kalender-Abo: .ics-Feed in den öffentlichen Storage (Token-URL), den iOS abonniert & selbst aktualisiert ===== */
function getCalToken(){ if(!fixCfg.calToken){ fixCfg.calToken="c"+Math.random().toString(36).slice(2,11)+Math.random().toString(36).slice(2,11); DB.saveFixCfg(fixCfg); } return fixCfg.calToken; }
function calFeedPath(){ return currentUser.id+"/fristen-"+getCalToken()+".ics"; }
function calFeedUrl(){ try{ return (sb.storage.from(IMG_BUCKET).getPublicUrl(calFeedPath()).data||{}).publicUrl || ""; }catch(e){ return ""; } }
async function uploadCalFeed(){ if(!sb||!currentUser||!currentUser.id) return "";
  try{ const {ics}=buildDeadlinesICS(); const blob=new Blob([ics],{type:"text/calendar; charset=utf-8"});
    const { error } = await sb.storage.from(IMG_BUCKET).upload(calFeedPath(), blob, { contentType:"text/calendar; charset=utf-8", upsert:true, cacheControl:"600" });
    if(error){ console.warn("[cal feed]", error.message); return ""; }
    return calFeedUrl();
  }catch(e){ console.warn("[cal feed]", e && e.message); return ""; } }
let _calSyncTimer=null;
function scheduleCalFeedSync(){ if(!fixCfg.calEnabled) return; clearTimeout(_calSyncTimer); _calSyncTimer=setTimeout(()=>{ uploadCalFeed().catch(()=>{}); }, 4000); }
async function openCalSubscribe(){
  fixCfg.calEnabled=true; DB.saveFixCfg(fixCfg);
  showToast("Live-Kalender wird vorbereitet …");
  const url=await uploadCalFeed();
  if(!url){ showToast("Konnte den Kalender nicht anlegen — Internet/Storage prüfen"); return; }
  const webcal=url.replace(/^https?:\/\//i,"webcal://");
  $("#modal-root").innerHTML=`<div class="overlay" id="ov"><div class="modal" style="max-width:470px">
    <div class="flex items-start justify-between gap-3 mb-1">
      <div><p class="font-bold text-[18px]">Live-Kalender abonnieren</p><p class="c-sub text-[12.5px] mt-0.5">Aktualisiert sich von allein — neue Rückgabefristen erscheinen automatisch im iPhone-Kalender.</p></div>
      <button id="cal-x" class="iconbtn" title="Schließen" aria-label="Schließen"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg></button>
    </div>
    <a href="${attrEsc(webcal)}" class="btn-accent w-full" style="display:flex;align-items:center;justify-content:center;gap:8px;text-decoration:none;margin:16px 0 6px">Auf diesem iPhone abonnieren ↗</a>
    <p class="c-sub text-[11.5px] leading-relaxed mb-4">Am <b>iPhone</b> antippen → Kalender öffnet sich → „Abonnieren". Am PC/Android nutze den Link unten.</p>
    <label class="label">Abo-Link (kopieren &amp; z. B. per iMessage/Mail aufs iPhone schicken)</label>
    <div class="pw-wrap"><input id="cal-url" class="field mono" readonly value="${attrEsc(webcal)}" style="font-size:11.5px;padding-right:46px"><button id="cal-copy" class="pw-eye" title="Kopieren" style="font-size:15px">⧉</button></div>
    <p class="c-sub text-[11px] leading-relaxed mt-3">Alternativ am iPhone: <b>Einstellungen → Kalender → Accounts → Account hinzufügen → Andere → Kalenderabo</b> → Link einfügen. iOS aktualisiert das Abo danach selbstständig.</p>
  </div></div>`;
  const close=()=>{ $("#modal-root").innerHTML=""; };
  $("#cal-x").addEventListener("click",close);
  $("#cal-copy").addEventListener("click",()=>{ try{ navigator.clipboard.writeText(webcal); showToast("Link kopiert"); }catch(e){ const i=$("#cal-url"); if(i){ i.select(); try{ document.execCommand("copy"); }catch(_){} showToast("Link kopiert"); } } });
}
if($("#deadlines-export")) $("#deadlines-export").addEventListener("click",e=>{ e.stopPropagation(); exportDeadlinesICS(); });
if($("#deadlines-subscribe")) $("#deadlines-subscribe").addEventListener("click",e=>{ e.stopPropagation(); openCalSubscribe(); });

/* Zeitabhängige Begrüßung + volles Datum (inkl. Wochentag) im Dashboard-Kopf */
function renderGreeting(){
  const h=$("#dash-greeting"), d=$("#dash-date"); if(!h||!d) return;
  const hr=new Date().getHours();
  const salut = hr<5 ? "Noch wach" : hr<11 ? "Guten Morgen" : hr<18 ? "Guten Tag" : hr<22 ? "Guten Abend" : "Noch wach";
  const uname = displayName();
  h.textContent = uname ? `${salut}, ${uname}` : salut;
  d.textContent = new Date().toLocaleDateString("de-DE",{weekday:"long",day:"numeric",month:"long",year:"numeric"});
}
/* Schnellzugriff auf bereits vorhandene, wertstiftende Bereiche der App */
const QUICKLINKS=[
  { tab:"tracker",   label:"Tracker",     icon:`<path d="M3 17l6-6 4 4 7-7"/><path d="M14 8h7v7"/>` },
  { tab:"inventory", label:"Bestand",     icon:`<path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><path d="m3.3 7 8.7 5 8.7-5M12 22V12"/>` },
  { tab:"fix",       label:"Fixkosten",   icon:`<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v6c0 1.66 3.58 3 8 3s8-1.34 8-3V5M4 11v6c0 1.66 3.58 3 8 3s8-1.34 8-3v-6"/>` },
  { tab:"report",    label:"Auswertung",  icon:`<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h5"/>` },
  { tab:"calc",      label:"Fee Calc",    icon:`<rect x="4" y="2" width="16" height="20" rx="2.5"/><path d="M8 6h8M8 10h.01M12 10h.01M16 10h.01M8 14h.01M12 14h.01M16 14h.01M8 18h4"/>` },
];
function renderQuicklinks(){
  const box=$("#dash-quicklinks"); if(!box) return;
  box.innerHTML=QUICKLINKS.map(q=>`<button data-qtab="${q.tab}" style="flex:0 0 auto;display:flex;align-items:center;gap:8px;padding:9px 15px;border-radius:999px;background:var(--cell);border:1px solid var(--line);cursor:pointer;white-space:nowrap">
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--brand)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${q.icon}</svg>
    <span class="text-[13px] font-semibold">${q.label}</span></button>`).join("");
  $$("#dash-quicklinks button").forEach(b=>b.addEventListener("click",()=>setTab(b.dataset.qtab)));
}
/* ===== Dashboard anpassen: Karten ein-/ausblenden (pro Konto gespeichert) ===== */
const DASH_CARDS = [
  {key:"profit",        label:"Nettogewinn",       sub:"Große Karte oben",     group:"kpi"},
  {key:"revenue",       label:"Gesamtumsatz",      sub:"eBay netto",           group:"kpi"},
  {key:"margin",        label:"Ø Marge",           sub:"Gewinn / Umsatz",      group:"kpi"},
  {key:"roi",           label:"Ø ROI",             sub:"Gewinn / Einsatz",     group:"kpi"},
  {key:"chart-profit",  label:"Profit-Verlauf",    sub:"6-Monats-Chart",       group:"detail"},
  {key:"chart-revcost", label:"Umsatz & Gewinn",   sub:"Balken je Monat",      group:"detail"},
  {key:"chart-split",   label:"Umsatz-Aufteilung", sub:"nach Plattform",       group:"detail"},
  {key:"attention",     label:"Aufmerksamkeiten",  sub:"Warnungen & Hinweise", group:"detail"},
  {key:"deadlines",     label:"Rückgabefristen",   sub:"Kalender & iPhone-Export", group:"detail"},
  {key:"history",       label:"Historie",          sub:"letzte Verkäufe",      group:"detail"}
];
function getDashCfg(){ let o=null; try{ o=JSON.parse(Store.get(uKey("dashcfg"))||"null"); }catch(e){} if(!o||typeof o!=="object") o={}; if(!Array.isArray(o.hidden)) o.hidden=[]; if(!Array.isArray(o.order)) o.order=[]; return o; }
function saveDashCfg(o){ Store.set(uKey("dashcfg"), JSON.stringify(o)); }
function dashOrderFor(group){ const cfg=getDashCfg(); const def=DASH_CARDS.filter(c=>c.group===group).map(c=>c.key); const seq=cfg.order.filter(k=>def.indexOf(k)>-1); def.forEach(k=>{ if(seq.indexOf(k)===-1) seq.push(k); }); return seq; }
function applyDashCfg(){ const cfg=getDashCfg();
  ["kpi","detail"].forEach(g=>{ dashOrderFor(g).forEach(key=>{ const el=document.querySelector('[data-dash="'+key+'"]'); if(el && el.parentNode) el.parentNode.appendChild(el); }); });
  DASH_CARDS.forEach(c=>{ const el=document.querySelector('[data-dash="'+c.key+'"]'); if(el) el.classList.toggle("dash-off", cfg.hidden.indexOf(c.key)>-1); }); }
const DASH_GRIP='<span class="dash-grip" aria-hidden="true"><svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="5" r="1.5"/><circle cx="15" cy="5" r="1.5"/><circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="9" cy="19" r="1.5"/><circle cx="15" cy="19" r="1.5"/></svg></span>';
function dashAfter(box,y){ const els=Array.prototype.slice.call(box.querySelectorAll(".dash-row:not(.dragging)")); let closest=null, closestOff=-Infinity; els.forEach(child=>{ const b=child.getBoundingClientRect(); const off=y-b.top-b.height/2; if(off<0 && off>closestOff){ closestOff=off; closest=child; } }); return closest; }
function saveDashOrder(){ const cfg=getDashCfg(); const seq=id=>{ const box=$("#"+id); return box?Array.prototype.slice.call(box.querySelectorAll(".dash-row")).map(r=>r.dataset.key):[]; };
  cfg.order=seq("dash-cfg-kpis").concat(seq("dash-cfg-detail")); saveDashCfg(cfg); applyDashCfg(); }
function enableDashDrag(box){
  box.querySelectorAll(".dash-row").forEach(row=>{
    row.addEventListener("dragstart",()=>row.classList.add("dragging"));
    row.addEventListener("dragend",()=>{ row.classList.remove("dragging"); row._dragged=true; setTimeout(()=>{ row._dragged=false; },60); saveDashOrder(); });
  });
  box.addEventListener("dragover",e=>{ e.preventDefault(); const d=box.querySelector(".dragging"); if(!d) return; const after=dashAfter(box,e.clientY); if(after==null) box.appendChild(d); else box.insertBefore(d,after); });
}
function renderDashManager(){ const hidden=getDashCfg().hidden;
  const build=(group,boxId)=>{ const box=$("#"+boxId); if(!box) return;
    box.innerHTML=dashOrderFor(group).map(key=>{ const c=DASH_CARDS.find(x=>x.key===key); return c?`<div class="pw-toggle dash-row" data-key="${c.key}" aria-pressed="${hidden.indexOf(c.key)>-1?"false":"true"}" draggable="true">${DASH_GRIP}<span class="pw-toggle-info"><span class="pw-toggle-name">${escapeHtml(c.label)}</span><span class="pw-toggle-set">${escapeHtml(c.sub)}</span></span><span class="pw-sw"></span></div>`:""; }).join("");
    enableDashDrag(box); };
  build("kpi","dash-cfg-kpis"); build("detail","dash-cfg-detail");
  $$(".dash-row").forEach(b=>b.addEventListener("click",()=>{ if(b._dragged) return; const key=b.dataset.key; const cfg=getDashCfg(); const idx=cfg.hidden.indexOf(key);
    if(idx>-1) cfg.hidden.splice(idx,1); else cfg.hidden.push(key);
    saveDashCfg(cfg); b.setAttribute("aria-pressed", cfg.hidden.indexOf(key)>-1?"false":"true"); applyDashCfg(); })); }
function dashReset(group){ const cfg=getDashCfg(); const keys=DASH_CARDS.filter(c=>c.group===group).map(c=>c.key); cfg.hidden=cfg.hidden.filter(k=>keys.indexOf(k)===-1); cfg.order=cfg.order.filter(k=>keys.indexOf(k)===-1); saveDashCfg(cfg); renderDashManager(); applyDashCfg(); showToast("Zurückgesetzt"); }
if($("#dash-reset-kpis")) $("#dash-reset-kpis").addEventListener("click",()=>dashReset("kpi"));
if($("#dash-reset-detail")) $("#dash-reset-detail").addEventListener("click",()=>dashReset("detail"));
if($("#dash-customize")) $("#dash-customize").addEventListener("click",()=>{ setTab("profil"); setSettingsCat("dashboard"); });
/* ===== Einstellungs-Hub: Kategorie-Wechsel (Seitenleiste) ===== */
function setSettingsCat(cat){ if(!document.querySelector('[data-spanel="'+cat+'"]')) cat="profil";
  $$("#settings-nav .settings-navi").forEach(b=>b.classList.toggle("is-active", b.dataset.scat===cat));
  $$(".settings-panel").forEach(p=>p.classList.toggle("hidden", p.dataset.spanel!==cat));
  if(cat==="daten"){ renderSnapshots(); renderInvFormatStatus(); }
  try{ Store.set(uKey("setcat"), cat); }catch(e){} }
$$("#settings-nav .settings-navi").forEach(b=>b.addEventListener("click",()=>setSettingsCat(b.dataset.scat)));
function renderDashboard(){ syncFilterButtons(); renderGreeting(); renderQuicklinks(); renderKPIs(); renderHistory(); renderCharts(); renderAttention(); renderDeadlines(); applyDashCfg(); }

/* ===== Features & Workflow (Konto-Schalter) ===== */
function getFeatCfg(){ let o=null; try{ o=JSON.parse(Store.get(uKey("featcfg"))||"null"); }catch(e){} if(!o||typeof o!=="object") o={}; return { images:o.images!==false, intake:o.intake===true, sellAvail:o.sellAvail===true }; }
function saveFeatCfg(o){ Store.set(uKey("featcfg"), JSON.stringify(o)); }
function applyFeatCfg(){ document.body.classList.toggle("no-images", !getFeatCfg().images); }
function renderFeatManager(){ const c=getFeatCfg(); const set=(id,on)=>{ const b=$("#"+id); if(b) b.setAttribute("aria-pressed", on?"true":"false"); }; set("feat-images",c.images); set("feat-intake",c.intake); set("feat-sellavail",c.sellAvail); }
function toggleFeat(key){ const c=getFeatCfg(); const next={images:c.images,intake:c.intake,sellAvail:c.sellAvail}; next[key]=!next[key]; saveFeatCfg(next); renderFeatManager(); applyFeatCfg(); if(typeof renderInventory==="function") renderInventory(); }
if($("#feat-images")) $("#feat-images").addEventListener("click",()=>toggleFeat("images"));
if($("#feat-intake")) $("#feat-intake").addEventListener("click",()=>toggleFeat("intake"));
if($("#feat-sellavail")) $("#feat-sellavail").addEventListener("click",()=>toggleFeat("sellAvail"));

/* ===== Einkaufsplattformen mit Retourenzeit → automatische Rückgabefrist (Risk-Management) =====
   Jeder Einkauf kann einer Plattform zugeordnet werden. Aus Bestelldatum + Retourenzeit
   berechnet Flipdeck die Rückgabefrist automatisch; sie erscheint im Aufmerksamkeiten-Banner
   und als Frist-Pill im Bestand. Gespeichert in fixCfg (synct über die Cloud). */
const DEFAULT_BUY_PLATFORMS = [
  {id:"bp_amazon", name:"Amazon", returnDays:30},
  {id:"bp_ebay", name:"eBay", returnDays:30},
  {id:"bp_zalando", name:"Zalando", returnDays:100},
  {id:"bp_nike", name:"Nike", returnDays:30},
  {id:"bp_kleinanzeigen", name:"Kleinanzeigen", returnDays:0}
];
function getBuyPlatforms(){ if(!Array.isArray(fixCfg.buyPlatforms)){ fixCfg.buyPlatforms = DEFAULT_BUY_PLATFORMS.map(p=>({...p})); } return fixCfg.buyPlatforms; }
function buyPlatformById(id){ return getBuyPlatforms().find(p=>p.id===id)||null; }
function addDaysISO(baseISO, days){ const d = baseISO ? new Date(baseISO+"T12:00:00") : new Date(); if(isNaN(d)) return ""; d.setDate(d.getDate()+(parseInt(days)||0)); return d.toISOString().slice(0,10); }
function refreshBuyPlatSelect(){ const sel=$("#iv-buyplatform"); if(!sel) return; const cur=sel.value;
  sel.innerHTML=`<option value="">— keine —</option>`+getBuyPlatforms().map(p=>`<option value="${p.id}">${escapeHtml(p.name)}${p.returnDays>0?` · ${p.returnDays} T Rückgabe`:""}</option>`).join("")+`<option value="__new__">＋ Neue Einkaufsplattform …</option>`;
  if(cur && (buyPlatformById(cur)||cur==="")) sel.value=cur; }
function applyBuyPlatToForm(){ const sel=$("#iv-buyplatform"); if(!sel) return; const p=buyPlatformById(sel.value); if(!p) return;
  if(p.returnDays>0 && $("#iv-returnby")){ $("#iv-returnby").value = addDaysISO($("#iv-orderdate")?$("#iv-orderdate").value:"", p.returnDays); } }
function renderBuyPlatManager(){ const box=$("#buyplat-list"); if(!box) return; const list=getBuyPlatforms();
  box.innerHTML = list.length ? list.map(p=>`<button type="button" class="fx-cat-chip buyplat-edit" data-id="${p.id}" title="Bearbeiten"><span class="fx-cat-ic" style="color:var(--brand);background:color-mix(in srgb,var(--brand) 15%,transparent);border:1px solid color-mix(in srgb,var(--brand) 32%,transparent)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M6 6v13a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V6M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/></svg></span>${escapeHtml(p.name)} · ${p.returnDays>0?p.returnDays+" T":"keine Frist"}</button>`).join("") : `<p class="c-sub text-[12.5px]">Noch keine Einkaufsplattform angelegt.</p>`;
  $$("#buyplat-list .buyplat-edit").forEach(b=>b.addEventListener("click",()=>openBuyPlatModal(b.dataset.id))); }
function openBuyPlatModal(id){
  const editing = id ? buyPlatformById(id) : null;
  $("#modal-root").innerHTML=`<div class="overlay" id="ov"><div class="modal" style="max-width:420px">
    <div class="flex items-start justify-between gap-3 mb-1">
      <div><p class="font-bold text-[18px]">${editing?"Einkaufsplattform bearbeiten":"Neue Einkaufsplattform"}</p><p class="c-sub text-[12.5px] mt-0.5">Shop/Händler mit Rückgabefrist — daraus wird die Frist automatisch berechnet.</p></div>
      <button id="bp-x" class="iconbtn" title="Schließen" aria-label="Schließen"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg></button>
    </div>
    <div class="my-4"><label class="label" for="bp-name">Name *</label><input id="bp-name" class="field" placeholder="z. B. Amazon, Nike, eBay" value="${editing?attrEsc(editing.name):""}"></div>
    <div class="mb-4"><label class="label" for="bp-days">Retourenzeit (Tage)</label><input id="bp-days" class="field tnum" inputmode="numeric" placeholder="z. B. 30" value="${editing?editing.returnDays:""}"><p class="c-sub text-[11.5px] mt-1.5">0 = keine Rückgabe (z. B. Privatkauf/Kleinanzeigen). Ändern aktualisiert alle verknüpften Einkäufe automatisch.</p></div>
    <div class="grid grid-cols-2 gap-3">${editing?`<button id="bp-del" class="btn-ghost" style="color:var(--danger)">Löschen</button>`:`<button id="bp-cancel" class="btn-ghost">Abbrechen</button>`}<button id="bp-save" class="btn-accent">${editing?"Speichern":"Anlegen"}</button></div>
  </div></div>`;
  const close=()=>{ $("#modal-root").innerHTML=""; };
  $("#bp-x").addEventListener("click",close); if($("#bp-cancel")) $("#bp-cancel").addEventListener("click",close);
  if($("#bp-del")) $("#bp-del").addEventListener("click",()=>{ inventory.forEach(it=>{ if(it.buyPlatformId===id) delete it.buyPlatformId; }); DB.saveInventory(inventory);
    fixCfg.buyPlatforms=getBuyPlatforms().filter(p=>p.id!==id); DB.saveFixCfg(fixCfg); close(); renderBuyPlatManager(); renderInventory(); showToast("Einkaufsplattform gelöscht"); });
  $("#bp-save").addEventListener("click",()=>{ const name=$("#bp-name").value.trim(); if(!name){ flashError($("#bp-name")); return; }
    const days=Math.max(0,parseInt($("#bp-days").value)||0); getBuyPlatforms(); let pid=id;
    if(editing){ const oldDays=editing.returnDays; Object.assign(editing,{name,returnDays:days});
      if(oldDays!==days){ inventory.forEach(it=>{ if(it.buyPlatformId===id){ it.returnBy = days>0 ? addDaysISO(it.orderDate, days) : ""; } }); DB.saveInventory(inventory); }
    } else { pid="bp"+Date.now(); fixCfg.buyPlatforms.push({id:pid,name,returnDays:days}); }
    DB.saveFixCfg(fixCfg); close(); renderBuyPlatManager(); renderInventory();
    if($("#iv-buyplatform")){ refreshBuyPlatSelect(); $("#iv-buyplatform").value=pid; applyBuyPlatToForm(); }
    showToast(editing?"Gespeichert":"Angelegt"); });
}
if($("#buyplat-new")) $("#buyplat-new").addEventListener("click",()=>openBuyPlatModal());
if($("#iv-buyplatform")) $("#iv-buyplatform").addEventListener("change",()=>{ const sel=$("#iv-buyplatform"); if(sel.value==="__new__"){ sel.value=""; openBuyPlatModal(); return; } applyBuyPlatToForm(); });
if($("#iv-orderdate")) $("#iv-orderdate").addEventListener("change",()=>{ const sel=$("#iv-buyplatform"); if(sel && sel.value && sel.value!=="__new__") applyBuyPlatToForm(); });

/* ===== Zahlungsmethoden (optional) — bei Einkäufen, Ausgaben & Verkäufen wählbar =====
   Reines Tracking: „womit habe ich bezahlt / wie wurde ich bezahlt". Gespeichert in fixCfg. */
const DEFAULT_PAY_METHODS = [
  {id:"pm_paypal", name:"PayPal",       color:"#60A5FA", icon:"card"},
  {id:"pm_card",   name:"Kreditkarte",  color:"#A78BFA", icon:"card"},
  {id:"pm_bank",   name:"Überweisung",  color:"#34D399", icon:"bank"},
  {id:"pm_cash",   name:"Bar",          color:"#FBBF24", icon:"coins"}
];
function getPayMethods(){ if(!Array.isArray(fixCfg.payMethods)){ fixCfg.payMethods = DEFAULT_PAY_METHODS.map(p=>({...p})); } return fixCfg.payMethods; }
function payMethodById(id){ return getPayMethods().find(p=>p.id===id)||null; }
function payOptions(sel, noNew){ return `<option value="">— keine —</option>`+getPayMethods().map(p=>`<option value="${p.id}"${sel===p.id?" selected":""}>${escapeHtml(p.name)}</option>`).join("")+(noNew?"":`<option value="__new__">＋ Neue Zahlungsmethode …</option>`); }
function refreshPaySelects(){ ["iv-paymethod","fx-paymethod","sell-paymethod"].forEach(id=>{ const sel=$("#"+id); if(!sel) return; const cur=sel.value; sel.innerHTML=payOptions(""); if(cur && (payMethodById(cur)||cur==="")) sel.value=cur; }); }
function payLinkedCount(id){ let n=0; inventory.forEach(it=>{ if(it.payMethodId===id) n++; }); if(typeof fixed!=="undefined") fixed.forEach(f=>{ if(f.payMethodId===id) n++; }); flips.forEach(f=>{ if(f.payMethodId===id) n++; }); return n; }
function renderPayMethodManager(){ const box=$("#paymethod-list"); if(!box) return; const list=getPayMethods();
  box.innerHTML = list.length ? list.map(p=>`<button type="button" class="fx-cat-chip paymethod-edit" data-id="${p.id}" title="Bearbeiten"><span class="fx-cat-ic" style="${catTint(p.color)}">${fixIconSVG(p.icon)}</span>${escapeHtml(p.name)}</button>`).join("") : `<p class="c-sub text-[12.5px]">Noch keine Zahlungsmethode angelegt.</p>`;
  $$("#paymethod-list .paymethod-edit").forEach(b=>b.addEventListener("click",()=>openPayMethodModal(b.dataset.id))); }
function openPayMethodModal(id, targetSel){
  const editing = id ? payMethodById(id) : null;
  let selColor = editing ? editing.color : FIX_COLORS[Math.floor(Math.random()*FIX_COLORS.length)];
  let selIcon  = editing ? editing.icon  : "card";
  const colorsHTML=FIX_COLORS.map(c=>`<button type="button" class="ec-swatch" data-color="${c}" style="background:${c}" aria-selected="${c===selColor?"true":"false"}"></button>`).join("");
  const iconsHTML=Object.keys(FIX_ICONS).map(k=>`<button type="button" class="ec-icobtn" data-icon="${k}" aria-selected="${k===selIcon?"true":"false"}">${fixIconSVG(k)}</button>`).join("");
  $("#modal-root").innerHTML=`<div class="overlay" id="ov"><div class="modal" style="max-width:440px">
    <div class="flex items-start justify-between gap-3 mb-1">
      <div><p class="font-bold text-[18px]">${editing?"Zahlungsmethode bearbeiten":"Neue Zahlungsmethode"}</p><p class="c-sub text-[12.5px] mt-0.5">Optional — nur zum Nachvollziehen, womit bezahlt wurde.</p></div>
      <button id="pm-x" class="iconbtn" title="Schließen" aria-label="Schließen"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg></button>
    </div>
    <div class="my-4"><label class="label" for="pm-name">Name *</label><input id="pm-name" class="field" placeholder="z. B. PayPal, Kreditkarte, Bar" value="${editing?attrEsc(editing.name):""}"></div>
    <div class="mb-4"><p class="label mb-2">Farbe</p><div id="pm-colors" class="ec-swatches">${colorsHTML}</div></div>
    <div class="mb-4"><p class="label mb-2">Icon</p><div id="pm-icons" class="ec-icons">${iconsHTML}</div></div>
    <div class="grid grid-cols-2 gap-3">${editing?`<button id="pm-del" class="btn-ghost" style="color:var(--danger)">Löschen</button>`:`<button id="pm-cancel" class="btn-ghost">Abbrechen</button>`}<button id="pm-save" class="btn-accent">${editing?"Speichern":"Anlegen"}</button></div>
  </div></div>`;
  const close=()=>{ $("#modal-root").innerHTML=""; };
  $("#pm-x").addEventListener("click",close); if($("#pm-cancel")) $("#pm-cancel").addEventListener("click",close);
  $$("#pm-colors .ec-swatch").forEach(b=>b.addEventListener("click",()=>{ selColor=b.dataset.color; $$("#pm-colors .ec-swatch").forEach(x=>x.setAttribute("aria-selected", x.dataset.color===selColor?"true":"false")); }));
  $$("#pm-icons .ec-icobtn").forEach(b=>b.addEventListener("click",()=>{ selIcon=b.dataset.icon; $$("#pm-icons .ec-icobtn").forEach(x=>x.setAttribute("aria-selected", x.dataset.icon===selIcon?"true":"false")); }));
  if($("#pm-del")) $("#pm-del").addEventListener("click",()=>{ if(payLinkedCount(id)>0){ showToast("Erst verknüpfte Buchungen umziehen — dann löschbar"); return; }
    fixCfg.payMethods=getPayMethods().filter(p=>p.id!==id); DB.saveFixCfg(fixCfg); close(); renderPayMethodManager(); refreshPaySelects(); showToast("Zahlungsmethode gelöscht"); });
  $("#pm-save").addEventListener("click",()=>{ const name=$("#pm-name").value.trim(); if(!name){ flashError($("#pm-name")); return; }
    getPayMethods(); let pid=id;
    if(editing){ Object.assign(editing,{name,color:selColor,icon:selIcon}); } else { pid="pm"+Date.now(); fixCfg.payMethods.push({id:pid,name,color:selColor,icon:selIcon}); }
    DB.saveFixCfg(fixCfg); close(); renderPayMethodManager(); refreshPaySelects();
    if(!editing && targetSel && $("#"+targetSel)) $("#"+targetSel).value=pid;
    showToast(editing?"Gespeichert":"Angelegt"); });
}
function onPaySelectNew(id){ const sel=$("#"+id); if(sel && sel.value==="__new__"){ sel.value=""; openPayMethodModal(null, id); } }
if($("#iv-paymethod")) $("#iv-paymethod").addEventListener("change",()=>onPaySelectNew("iv-paymethod"));
if($("#fx-paymethod")) $("#fx-paymethod").addEventListener("change",()=>onPaySelectNew("fx-paymethod"));
if($("#paymethod-new")) $("#paymethod-new").addEventListener("click",()=>openPayMethodModal());
$("#search").addEventListener("input", ()=>{ const x=$("#search-x"); if(x) x.classList.toggle("hidden", !$("#search").value); renderHistory(); });
$("#search-x").addEventListener("click", ()=>{ const s=$("#search"); s.value=""; $("#search-x").classList.add("hidden"); s.focus(); renderHistory(); });

/* Flip-Detail Modal */
function openFlipDetail(id){ const f=flips.find(x=>x.id===id); if(!f) return;
  const profit=flipProfit(f),rev=flipRevenue(f),margin=rev>0?profit/rev*100:0,pos=profit>=0;
  $("#modal-root").innerHTML=`<div class="overlay" id="ov"><div class="modal">
    <div class="flex items-start gap-4 mb-4">
      <span class="thumb" style="width:64px;height:64px;flex:0 0 64px">${ f.img?`<img src="${attrEsc(f.img)}" style="width:100%;height:100%;object-fit:cover">`:`<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="var(--sub)" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="4"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>` }</span>
      <div class="min-w-0"><p class="font-bold text-[16px] leading-snug">${escapeHtml(f.name)}</p><p class="c-sub text-[12px] mt-1">${fmtDate(f.date)}${f.ean?` · ${escapeHtml(f.ean)}`:""}</p></div>
    </div>
    <div class="rounded-[16px] p-4 mb-4" style="background:var(--cell-2)">
      <p class="label mb-1">Gewinn</p><p class="cozy text-[42px] leading-none" style="color:${pos?'var(--accent)':'var(--danger)'}">${pos?"+":""}${eur(profit)}</p>
      <div class="grid grid-cols-2 gap-y-2 mt-3 text-[13px]">
        <span class="c-sub">Stückzahl</span><span class="mono text-right">${f.qty}</span>
        <span class="c-sub">EK / Stück</span><span class="mono text-right">${eur(num(f.ek))}</span>
        <span class="c-sub">Auszahlung / Stück</span><span class="mono text-right">${eur(num(f.payout))}</span>
        <span class="c-sub">Versand / Stück</span><span class="mono text-right">${eur(num(f.ship))}</span>
        <span class="c-sub">Marge</span><span class="mono text-right">${pct(margin)}</span>
      </div>
    </div>
    ${ trackUrl(f.carrier,f.tracking) ? `<div class="mb-3">${trackLinkHTML(f.carrier,f.tracking,"Verkauf verfolgen")}</div>` : "" }
    <div class="mb-3">${researchHTML(f.name,f.ean)}</div>
    ${ f.returned ? `<div class="rounded-[14px] p-3 mb-3" style="background:color-mix(in srgb,#f5a524 12%,transparent);border:1px solid color-mix(in srgb,#f5a524 40%,var(--line))"><p class="text-[12.5px] font-semibold" style="color:#f5a524">↩ Als Kundenretoure gebucht${f.returnDate?` · ${fmtDate(f.returnDate)}`:""}</p><p class="c-sub text-[11px] mt-0.5">Dieser Verkauf zählt nicht mehr für Umsatz &amp; Gewinn.</p></div>` : "" }
    <p class="label mb-2">Aktionen</p>
    <div class="grid grid-cols-2 gap-2 mb-2">
      <button id="fd-restock" class="btn-ghost" style="display:flex;align-items:center;justify-content:center;gap:7px;font-size:13px"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><path d="m3.3 7 8.7 5 8.7-5M12 22V12"/></svg>In Bestand</button>
      <button id="fd-relist" class="btn-ghost" style="display:flex;align-items:center;justify-content:center;gap:7px;font-size:13px"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M3 17l6-6 4 4 7-7"/><path d="M14 8h7v7"/></svg>Neuer Verkauf</button>
      <button id="fd-share" class="btn-ghost" style="display:flex;align-items:center;justify-content:center;gap:7px;font-size:13px"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4"/></svg>Als Bild</button>
      <button id="fd-return" class="btn-ghost" style="display:flex;align-items:center;justify-content:center;gap:7px;font-size:13px;${f.returned?'':'color:#f5a524'}"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10H9"/></svg>${f.returned?'Retoure rückg.':'Kundenretoure'}</button>
    </div>
    <p class="c-sub text-[11px] leading-relaxed mb-3">„In Bestand"/„Neuer Verkauf" übernehmen Bild, Name, EAN, EK &amp; Versand. Kategorie, Menge, Preis &amp; Datum bitte prüfen.</p>
    <button id="fd-close" class="btn-ghost w-full">Schließen</button>
  </div></div>`;
  $("#ov").addEventListener("click",e=>{ if(e.target.id==="ov") $("#modal-root").innerHTML=""; });
  $("#fd-close").addEventListener("click",()=> $("#modal-root").innerHTML="");
  $("#fd-restock").addEventListener("click",()=>{ $("#modal-root").innerHTML=""; restockToInventory(f); });
  $("#fd-relist").addEventListener("click",()=>{ $("#modal-root").innerHTML=""; relistAsSale(f); });
  $("#fd-share").addEventListener("click",()=> exportSaleImage(f));
  $("#fd-return").addEventListener("click",()=>{ if(f.returned){ undoCustomerReturn(f.id); } else { $("#modal-root").innerHTML=""; openCustomerReturn(f.id); } });
}

/* Aus einem (verkauften) Artikel heraus erneut anlegen – spart komplettes Neu-Erfassen.
   Kategorie ist an Verkäufen nicht gespeichert, bleibt daher auf Standard. */
function restockToInventory(f){
  setTab("inventory");
  resetInvForm();               // setzt editingInvId=null + Standardwerte
  setInvForm(true);
  $("#iv-name").value = f.name || "";
  $("#iv-ean").value  = f.ean || "";
  $("#iv-qty").value  = "1";
  $("#iv-vk").value   = (num(f.payout)||0).toFixed(2).replace(".",",");   // Startwert = letzte Auszahlung
  $("#iv-ek").value   = (num(f.ek)||0).toFixed(2).replace(".",",");
  $("#iv-ship").value = (num(f.ship)||0).toFixed(2).replace(".",",");
  if(f.img) setPendingInvImg(f.img); else resetInvImage();
  window.scrollTo({top:0,behavior:"smooth"});
  showToast("✓ In die Bestandsmaske übernommen – prüfen & speichern");
}
function relistAsSale(f){
  setTab("tracker");
  resetDealForm();              // setzt editingDealId=null, Datum heute, Modus „pro Stück“
  dealFormOpen=true; $("#dt-form").classList.remove("hidden");
  $("#dt-toggle-ic").style.transform="rotate(45deg)"; $("#dt-toggle").querySelector("span").textContent=t("ui.close");
  $("#f-name").value  = f.name || "";
  $("#f-ean").value   = f.ean || "";
  $("#f-qty").value   = "1";
  $("#f-ek").value    = (num(f.ek)||0).toFixed(2).replace(".",",");
  $("#f-payout").value= (num(f.payout)||0).toFixed(2).replace(".",",");
  $("#f-ship").value  = (num(f.ship)||0).toFixed(2).replace(".",",");
  $("#f-date").value  = todayISOInput();
  if(f.img) setPendingImg(f.img); else resetImage();
  flipFormPreview();
  window.scrollTo({top:0,behavior:"smooth"});
  showToast("✓ Als neuen Verkauf vorbereitet – Datum & Preis prüfen, dann speichern");
}

/* ===== Kundenretoure: Verkauf zurückdrehen (optional zurück ins Lager) ===== */
function openCustomerReturn(id){ const f=flips.find(x=>x.id===id); if(!f) return;
  $("#modal-root").innerHTML=`<div class="overlay" id="ov"><div class="modal">
    <p class="font-bold text-[16px] mb-1">Kundenretoure</p>
    <p class="c-sub text-[12.5px] mb-4 leading-relaxed">„${escapeHtml(f.name)}" wird als retourniert markiert und zählt <b>nicht mehr</b> für Umsatz &amp; Gewinn. Der Eintrag bleibt zur Nachvollziehbarkeit erhalten.</p>
    <label style="display:flex;align-items:flex-start;gap:10px;margin-bottom:16px;cursor:pointer;user-select:none">
      <input id="cr-restock" type="checkbox" checked style="width:18px;height:18px;accent-color:var(--brand);flex:0 0 auto;margin-top:1px">
      <span><span class="text-[13.5px] font-semibold">Artikel zurück ins Lager</span><span class="c-sub text-[12px]" style="display:block;line-height:1.4">${f.qty||1}× wieder als verkaufsbereiter Bestand aufnehmen.</span></span>
    </label>
    <div class="grid grid-cols-2 gap-3"><button id="cr-cancel" class="btn-ghost">Abbrechen</button><button id="cr-ok" class="btn-accent">Retoure buchen</button></div>
  </div></div>`;
  $("#ov").addEventListener("click",e=>{ if(e.target.id==="ov") $("#modal-root").innerHTML=""; });
  $("#cr-cancel").addEventListener("click",()=>$("#modal-root").innerHTML="");
  $("#cr-ok").addEventListener("click",()=>{
    const restock=$("#cr-restock").checked;
    f.returned=true; f.returnDate=new Date().toISOString(); DB.saveFlips(flips);
    if(restock){
      const it=f.invId && inventory.find(x=>x.id===f.invId);
      if(it){ it.qty=(it.qty||0)+(f.qty||1); it.touchedAt=new Date().toISOString(); if(invStatus(it)==="returned"){ it.status="stock"; delete it.supReturn; } }
      else addInventoryItem({ name:f.name, ean:f.ean||"", qty:f.qty||1, vk:num(f.payout), ek:num(f.ek), ship:num(f.ship), catPct:12, adPct:0, regionPct:0, status:"stock", img:f.img||null, tags:["Retoure"] });
      DB.saveInventory(inventory);
    }
    $("#modal-root").innerHTML=""; renderDashboard(); renderTrackerList(); renderInventory(); if(typeof renderReport==="function") renderReport();
    showToast(restock?"✓ Retoure gebucht – Artikel zurück im Lager":"✓ Retoure gebucht");
  });
}
function undoCustomerReturn(id){ const f=flips.find(x=>x.id===id); if(!f) return;
  delete f.returned; delete f.returnDate; DB.saveFlips(flips);
  $("#modal-root").innerHTML=""; renderDashboard(); renderTrackerList(); if(typeof renderReport==="function") renderReport();
  showToast("Retoure rückgängig – Verkauf zählt wieder"); }

/* ===== Verkaufs-Grafik-Export (PNG für Social Media) ===== */
function exportSaleImage(f){
  const qty = f.qty||1;
  const ekPer = num(f.ek), payoutPer = num(f.payout);
  const profitTotal = flipProfit(f), revTotal = flipRevenue(f);
  const margin = revTotal>0 ? profitTotal/revTotal*100 : 0, pos = profitTotal>=0;
  const profitPerUnit = profitTotal/qty;
  const multi = qty>1;

  const W=1080, H = multi ? 1220 : 1060;
  const c=document.createElement("canvas"); c.width=W; c.height=H;
  const g=c.getContext("2d");
  const accent = pos ? "#34D399" : "#FB7185";
  const accentSoft = pos ? "#6EE7B7" : "#FDA4AF";

  // ---- Glass-Helfer -------------------------------------------------
  const bg = () => {
    const grad=g.createLinearGradient(0,0,W,H);
    grad.addColorStop(0,"#0A0E1A"); grad.addColorStop(.55,"#111A2E"); grad.addColorStop(1,"#0D1526");
    g.fillStyle=grad; g.fillRect(0,0,W,H);
  };
  // Frosted-Glass-Panel mit Schatten, Sheen & feinem Rand
  const glass = (x,y,w,h,r=32,opacity=.055) => {
    g.save();
    g.shadowColor="rgba(0,0,0,.45)"; g.shadowBlur=50; g.shadowOffsetY=22;
    g.fillStyle=`rgba(255,255,255,${opacity})`; roundRect(g,x,y,w,h,r); g.fill();
    g.restore();
    g.save(); roundRect(g,x,y,w,h,r); g.clip();
    const sheen=g.createLinearGradient(x,y,x,y+h*0.7);
    sheen.addColorStop(0,"rgba(255,255,255,.10)"); sheen.addColorStop(1,"rgba(255,255,255,0)");
    g.fillStyle=sheen; g.fillRect(x,y,w,h*0.7);
    g.restore();
    g.save(); g.strokeStyle="rgba(255,255,255,.14)"; g.lineWidth=1.5; roundRect(g,x+.75,y+.75,w-1.5,h-1.5,r); g.stroke(); g.restore();
  };
  // kleine Stat-Karte (Label oben, Wert unten)
  const chip = (x,y,w,h,label,value,valueColor="#F8FAFC") => {
    glass(x,y,w,h,22,.045);
    g.fillStyle="#8B96AE"; g.font="700 21px Nunito, sans-serif"; g.textAlign="left";
    g.fillText(label.toUpperCase(), x+26, y+42);
    g.fillStyle=valueColor; g.font="800 34px Nunito, sans-serif";
    g.fillText(value, x+26, y+h-28);
  };
  // rechts-ausgerichtete Pille
  const pillRight = (rightX,y,text,fg,bgc) => {
    g.font="700 26px Nunito, sans-serif";
    const tw=g.measureText(text).width, pw=tw+44, ph=54;
    glass(rightX-pw, y, pw, ph, 27, .07);
    g.fillStyle=bgc?bgc:"transparent"; if(bgc){ roundRect(g,rightX-pw,y,pw,ph,27); g.fill(); }
    g.fillStyle=fg; g.textAlign="left"; g.fillText(text, rightX-pw+22, y+ph/2+9);
    return pw;
  };

  let triedNoImg=false;
  const draw=(img)=>{
    bg();

    // ── Kopf-Karte: Bild · Eyebrow · Titel · Datum · Menge ──────────
    const headerY=60, headerH=multi?400:400;
    glass(60,headerY,W-120,headerH,40,.05);
    const imgSize=280, imgX=112, imgY=headerY+52;
    if(img){ g.save(); roundRect(g,imgX,imgY,imgSize,imgSize,28); g.clip(); const r=Math.max(imgSize/img.width,imgSize/img.height); const iw=img.width*r, ih=img.height*r; g.drawImage(img,imgX+(imgSize-iw)/2,imgY+(imgSize-ih)/2,iw,ih); g.restore(); g.strokeStyle="rgba(255,255,255,.14)"; g.lineWidth=1.5; roundRect(g,imgX+.75,imgY+.75,imgSize-1.5,imgSize-1.5,28); g.stroke(); }
    else { g.fillStyle="rgba(255,255,255,.07)"; roundRect(g,imgX,imgY,imgSize,imgSize,28); g.fill(); }

    const txX=imgX+imgSize+46, txW=(60+W-120)-txX-46;
    g.textAlign="left";
    g.fillStyle="#8B96AE"; g.font="700 26px Nunito, sans-serif"; g.fillText("FLIPDECK · SALE", txX, headerY+62);
    g.fillStyle="#F8FAFC"; g.font="800 46px Nunito, sans-serif";
    wrapText(g, f.name, txX, headerY+128, txW, 54, 3);

    // Datum + Menge-Pille am unteren Rand der Kopf-Karte
    const bottomRowY=headerY+headerH-90;
    g.fillStyle="#8B96AE"; g.font="600 27px Nunito, sans-serif"; g.fillText(fmtDate(f.date), txX, bottomRowY+38);
    pillRight(60+(W-120)-40, bottomRowY, `${qty} Stück`, "#C7D2FE", "rgba(124,138,255,.16)");

    // ── Gewinn-Hero-Karte ────────────────────────────────────────────
    const heroY=headerY+headerH+28, heroH=280;
    glass(60,heroY,W-120,heroH,40,.06);
    pillRight(60+(W-120)-40, heroY+34, `${pct(margin)} Marge`, pos?"#6EE7B7":"#FDA4AF", pos?"rgba(52,211,153,.14)":"rgba(251,113,133,.14)");
    g.fillStyle="#8B96AE"; g.font="700 28px Nunito, sans-serif"; g.fillText("GEWINN GESAMT", 112, heroY+62);
    const numGrad=g.createLinearGradient(112,0,780,0); numGrad.addColorStop(0,accent); numGrad.addColorStop(1,accentSoft);
    g.fillStyle=numGrad; g.font="800 118px Nunito, sans-serif";
    g.fillText((pos?"+":"")+eur(profitTotal), 112, heroY+218);

    // ── Kennzahlen-Grid ──────────────────────────────────────────────
    const gridY=heroY+heroH+28, gap=22, colW=(W-120-2*gap)/3, chipH=150;
    chip(60, gridY, colW, chipH, "Menge", `${qty} Stk`);
    chip(60+colW+gap, gridY, colW, chipH, "EK/Stk", eur(ekPer));
    chip(60+2*(colW+gap), gridY, colW, chipH, "Auszahlung/Stk", eur(payoutPer));

    if(multi){
      const row2Y=gridY+chipH+gap, col2W=(W-120-gap)/2;
      chip(60, row2Y, col2W, chipH, "Ø Gewinn/Stk", (profitPerUnit>=0?"+":"")+eur(profitPerUnit), accent);
      chip(60+col2W+gap, row2Y, col2W, chipH, "Auszahlung gesamt", eur(revTotal));
    }

    g.fillStyle="#5C6785"; g.font="600 26px Nunito, sans-serif"; g.textAlign="center"; g.fillText("erstellt mit Flipdeck", W/2, H-46); g.textAlign="left";

    try {
      c.toBlob(b=>{ if(!b){ showToast("Export fehlgeschlagen"); return; } const url=URL.createObjectURL(b); const a=document.createElement("a"); a.href=url; a.download=`flipdeck-sale-${(f.name||"deal").replace(/[^\w]+/g,"-").slice(0,32)}.png`; a.click(); setTimeout(()=>URL.revokeObjectURL(url),3000); showToast("✓ Verkaufs-Grafik gespeichert"); }, "image/png");
    } catch(e){   // Canvas durch fremdes Bild „tainted“ (CORS) -> ohne Bild neu zeichnen
      if(!triedNoImg){ triedNoImg=true; draw(null); } else showToast("Export nicht möglich (Bildquelle blockiert)");
    }
  };
  if(f.img){ const im=new Image(); im.crossOrigin="anonymous"; im.onload=()=>draw(im); im.onerror=()=>draw(null); im.src=f.img; }
  else draw(null);
}
function roundRect(g,x,y,w,h,r){ g.beginPath(); g.moveTo(x+r,y); g.arcTo(x+w,y,x+w,y+h,r); g.arcTo(x+w,y+h,x,y+h,r); g.arcTo(x,y+h,x,y,r); g.arcTo(x,y,x+w,y,r); g.closePath(); }
function wrapText(g,text,x,y,maxW,lh,maxLines){ const words=String(text||"").split(/\s+/); let line="",lines=0;
  for(let i=0;i<words.length;i++){ const test=line?line+" "+words[i]:words[i];
    if(g.measureText(test).width>maxW && line){ g.fillText(line,x,y); y+=lh; line=words[i]; if(++lines>=maxLines-1){ /* Rest kürzen */ let rest=words.slice(i).join(" "); while(g.measureText(rest+"…").width>maxW && rest.length>1) rest=rest.slice(0,-1); g.fillText(rest+ (words.slice(i).join(" ").length>rest.length?"…":""), x, y); return; } }
    else line=test; }
  if(line) g.fillText(line,x,y); }


/* ===== 8 · TRACKER (Deals) ===== */
let trackRange=7, editingDealId=null, pendingImg=null;
const inTrackRange = iso => (Date.now()-new Date(iso).getTime())<=trackRange*86400000;
const dealIconSVG=`<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--sub)" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="4"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>`;

function dealCard(f){
  const profit=flipProfit(f), rev=flipRevenue(f), margin=rev>0?profit/rev*100:0, pos=profit>=0; const plat=PLATFORMS[f.platform]||PLATFORMS.ebay;
  return `<div class="deal-tile" data-id="${f.id}">
    <div class="deal-tile-img">${ f.img?`<img class="dt-bg" src="${attrEsc(f.img)}" alt="" aria-hidden="true"><img class="dt-fg" src="${attrEsc(f.img)}" alt="">`:dealIconSVG }
      <div class="deal-tile-actions">
        <button class="iconbtn deal-edit" data-id="${f.id}" title="Bearbeiten">${icoEdit}</button>
        <button class="iconbtn danger deal-del" data-id="${f.id}" title="Löschen">${icoTrash}</button>
      </div>
    </div>
    <div style="padding:14px 15px 16px">
      <div class="flex items-center gap-2 mb-2 flex-wrap"><span class="pill ${plat.pill}">${plat.label}</span><span class="c-sub text-[11.5px]">${fmtDate(f.date)}</span>${f.qty>1?`<span class="pill pill-mut">×${f.qty}</span>`:""}${f.returned?`<span class="pill" style="border:1px solid color-mix(in srgb,#f5a524 45%,var(--line));color:#f5a524">↩ Retoure</span>`:""}</div>
      <p class="font-semibold text-[14px] leading-snug truncate mb-2.5"${f.returned?' style="text-decoration:line-through;opacity:.7"':''}>${escapeHtml(f.name)}</p>
      <p class="label" style="margin-bottom:3px">Gewinn</p>
      <p class="cozy" style="font-size:30px;line-height:1;color:${pos?'var(--accent)':'var(--danger)'}">${pos?"+":""}${eur(profit)}</p>
      <span class="pill ${pos?'pill-accent':'pill-mut'}" style="margin-top:9px;display:inline-block">${pct(margin)} Marge</span>
    </div></div>`;
}
/* Zeitraum-Filter: relative Tage + Kalender-Perioden */
function inPeriod(iso, p){
  const t=new Date(iso), now=new Date();
  if(p==="all") return true;
  if(p==="7"||p==="30"||p==="365") return (Date.now()-t.getTime())<=parseInt(p)*86400000;
  const sow=ref=>{ const x=new Date(ref); const day=(x.getDay()+6)%7; x.setHours(0,0,0,0); x.setDate(x.getDate()-day); return x; };
  if(p==="tw"){ return t>=sow(now); }
  if(p==="lw"){ const s=sow(now), ls=new Date(s); ls.setDate(ls.getDate()-7); return t>=ls && t<s; }
  if(p==="tm"){ return t.getFullYear()===now.getFullYear() && t.getMonth()===now.getMonth(); }
  if(p==="lm"){ const lm=new Date(now.getFullYear(),now.getMonth()-1,1); return t.getFullYear()===lm.getFullYear() && t.getMonth()===lm.getMonth(); }
  if(p==="ty"){ return t.getFullYear()===now.getFullYear(); }
  return true;
}
/* Verkäufe-Ansicht: „grouped" (nach Produkt gestapelt) ist Standard; „cards" wenn bewusst gewählt. */
let trackView = Store.get("fg_trackview")==="cards" ? "cards" : "grouped";
let trackGrpExpanded = new Set();
function groupedTrackerHTML(list){
  const groups=new Map();
  list.forEach(f=>{ const key=((f.ean||"").trim()) || (f.name||"").trim().toLowerCase() || f.id;
    if(!groups.has(key)) groups.set(key,{key, name:f.name, img:null, sales:[], units:0, profit:0, last:0});
    const g=groups.get(key); g.sales.push(f); g.units+=(f.qty||1); g.profit+=flipProfit(f);
    const t=new Date(f.date).getTime(); if(t>g.last) g.last=t; if(!g.img && f.img) g.img=f.img; if(!g.name) g.name=f.name; });
  return [...groups.values()].sort((a,b)=>b.last-a.last).map(g=>{
    const open=trackGrpExpanded.has(g.key), pos=g.profit>=0;
    const rows=g.sales.map(f=>{ const p=flipProfit(f), pp=p>=0, plat=PLATFORMS[f.platform]||PLATFORMS.ebay;
      return `<button type="button" class="grp-sale" data-id="${f.id}">
        <span class="c-sub" style="font-size:12px;flex:0 0 auto;min-width:58px">${fmtDate(f.date)}</span>
        <span style="flex:1;min-width:0" class="truncate"><span class="pill ${plat.pill}" style="font-size:10px">${plat.label}</span>${f.qty>1?` <span class="c-sub">×${f.qty}</span>`:""}${f.returned?` <span style="color:#f5a524">↩</span>`:""}</span>
        <span class="mono c-sub" style="font-size:12px;flex:0 0 auto">${eur(num(f.payout))}</span>
        <span class="mono" style="font-weight:700;flex:0 0 auto;min-width:66px;text-align:right;color:${pp?'var(--accent)':'var(--danger)'}">${pp?"+":""}${eur(p)}</span>
      </button>`; }).join("");
    return `<div class="grp-item" style="border:1px solid var(--line);border-radius:15px;background:var(--cell-2);overflow:hidden">
      <button type="button" class="grp-head" data-key="${attrEsc(g.key)}" style="display:flex;align-items:center;gap:14px;width:100%;text-align:left;padding:14px 16px;background:none;border:0;cursor:pointer">
        <span style="flex:0 0 auto;width:56px;height:56px;border-radius:13px;overflow:hidden;display:flex;align-items:center;justify-content:center;background:var(--cell)">${g.img?`<img src="${attrEsc(g.img)}" style="width:100%;height:100%;object-fit:cover">`:dealIconSVG}</span>
        <span style="flex:1;min-width:0"><span class="font-semibold text-[15.5px] truncate" style="display:block;margin-bottom:2px">${escapeHtml(g.name||"—")}</span><span class="c-sub text-[12.5px]">${g.sales.length} ${g.sales.length===1?"Verkauf":"Verkäufe"} · ${g.units} Stück · zuletzt ${fmtDate(new Date(g.last).toISOString())}</span></span>
        <span class="mono" style="font-weight:800;font-size:16.5px;flex:0 0 auto;color:${pos?'var(--accent)':'var(--danger)'}">${pos?"+":""}${eur(g.profit)}</span>
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="var(--sub)" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" style="flex:0 0 auto;transition:transform .2s;transform:rotate(${open?90:0}deg)"><path d="m9 18 6-6-6-6"/></svg>
      </button>
      <div class="grp-body ${open?'':'hidden'}" style="padding:0 14px 10px">${rows}</div>
    </div>`; }).join("");
}
function renderTrackerList(){
  const period = $("#track-period") ? $("#track-period").value : "30";
  const q = $("#track-search") ? $("#track-search").value.trim().toLowerCase() : "";
  const list=flips.slice().filter(f=>inPeriod(f.date,period)).sort((a,b)=>new Date(b.date)-new Date(a.date))
    .filter(f=>!q || f.name.toLowerCase().includes(q) || (f.ean||"").toLowerCase().includes(q));
  const rev=list.reduce((s,f)=>s+flipRevenue(f),0);
  const profit=list.reduce((s,f)=>s+flipProfit(f),0);
  const margin=rev>0?profit/rev*100:0;
  if($("#tk-rev")){ $("#tk-rev").textContent=eur(rev);
    $("#tk-profit").textContent=(profit>=0?"+":"")+eur(profit); $("#tk-profit").style.color=profit>=0?"var(--accent)":"var(--danger)";
    $("#tk-margin").textContent=pct(margin); }
  const box=$("#track-list");
  $$("#track-view button").forEach(x=>x.setAttribute("aria-selected", x.dataset.view===trackView));
  $("#track-empty").classList.toggle("hidden", list.length>0);
  if(trackView==="grouped"){
    box.className="flex flex-col gap-2.5";
    box.innerHTML=groupedTrackerHTML(list);
    $$("#track-list .grp-head").forEach(b=>b.addEventListener("click",()=>{ const k=b.dataset.key; if(trackGrpExpanded.has(k)) trackGrpExpanded.delete(k); else trackGrpExpanded.add(k); renderTrackerList(); }));
    $$("#track-list .grp-sale").forEach(b=>b.addEventListener("click",()=>openFlipDetail(b.dataset.id)));
  } else {
    box.className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4";
    box.innerHTML=list.map(dealCard).join("");
    $$("#track-list .deal-edit").forEach(b=>b.addEventListener("click",e=>{ e.stopPropagation(); openDealEdit(b.dataset.id); }));
    $$("#track-list .deal-del").forEach(b=>b.addEventListener("click",e=>{ e.stopPropagation(); deleteDeal(b.dataset.id); }));
    $$("#track-list .deal-tile").forEach(el=>el.addEventListener("click",()=>openFlipDetail(el.dataset.id)));
  }
}
$$("#track-view button").forEach(b=>b.addEventListener("click",()=>{ trackView=b.dataset.view==="grouped"?"grouped":"cards"; Store.set("fg_trackview",trackView); $$("#track-view button").forEach(x=>x.setAttribute("aria-selected", x.dataset.view===trackView)); renderTrackerList(); }));
$("#track-period").addEventListener("change",renderTrackerList);
if($("#track-search")) $("#track-search").addEventListener("input",()=>{ const x=$("#track-search-x"); if(x) x.classList.toggle("hidden",!$("#track-search").value); renderTrackerList(); });
if($("#track-search-x")) $("#track-search-x").addEventListener("click",()=>{ const s=$("#track-search"); s.value=""; $("#track-search-x").classList.add("hidden"); s.focus(); renderTrackerList(); });

/* Collapsible Deal-Formular */
let dealFormOpen=false;
function setDealForm(open){ dealFormOpen=open; $("#dt-form").classList.toggle("hidden",!open);
  $("#dt-toggle-ic").style.transform=open?"rotate(45deg)":"rotate(0deg)";
  $("#dt-toggle").querySelector("span").textContent=open?t("ui.close"):t("track.add");
  if(!open) resetDealForm(); }
function resetDealForm(){ editingDealId=null; ["f-name","f-ean","f-ek","f-payout","f-ship"].forEach(id=>$("#"+id).value=""); $("#f-qty").value="1"; $("#f-date").value=todayISOInput(); resetImage(); setFlipMode("each"); flipFormPreview(); $("#dt-form-title").textContent="Neuen Deal erfassen"; $("#add-flip").textContent="Deal speichern"; }
$("#dt-toggle").addEventListener("click",()=>setDealForm(!dealFormOpen));
$("#dt-cancel").addEventListener("click",()=>setDealForm(false));

let flipMode="each"; // 'each' | 'total'
function setFlipMode(m){ flipMode=m;
  $("#f-mode-each").setAttribute("aria-selected", m==="each"?"true":"false");
  $("#f-mode-total").setAttribute("aria-selected", m==="total"?"true":"false");
  const suf = m==="total" ? "gesamt" : "€ / Stück";
  $("#lbl-ek").textContent = m==="total" ? "EK gesamt" : "EK € / Stück";
  $("#lbl-ship").textContent = m==="total" ? "Versand gesamt" : "Versand € / Stück";
  $("#lbl-payout").textContent = m==="total" ? "Auszahlung gesamt" : "Auszahlung € / Stück";
  flipFormPreview(); }
function flipFormPreview(){ const q=parseInt($("#f-qty").value)||1;
  const ek=num($("#f-ek").value), pay=num($("#f-payout").value), sh=num($("#f-ship").value);
  const p = flipMode==="total" ? (pay-ek-sh) : (pay-ek-sh)*q;
  const el=$("#f-preview"); el.textContent=(p>=0?"+":"")+eur(p); el.style.color=p>=0?"var(--accent)":"var(--danger)"; }
["f-ek","f-payout","f-ship","f-qty"].forEach(id=>$("#"+id).addEventListener("input",flipFormPreview));
$("#f-mode-each").addEventListener("click",()=>setFlipMode("each"));
$("#f-mode-total").addEventListener("click",()=>setFlipMode("total"));
const qtyEl=$("#f-qty");
function clampQty(){ const v=parseInt(qtyEl.value); if(!v||v<1) qtyEl.value=1; }
qtyEl.addEventListener("input",flipFormPreview); qtyEl.addEventListener("change",()=>{ clampQty(); flipFormPreview(); }); qtyEl.addEventListener("blur",clampQty);
$("#drop").addEventListener("click",()=>$("#img-input").click());
function setPendingImg(src){ pendingImg=src; $("#drop").classList.add("has"); $("#drop-empty").classList.add("hidden"); const p=$("#drop-preview"); p.src=src; p.classList.remove("hidden"); }
$("#img-input").addEventListener("change",e=>{ const f=e.target.files[0]; if(!f) return; readImageScaled(f,800,setPendingImg); });
["dragover","dragenter"].forEach(ev=>$("#drop").addEventListener(ev,e=>{ e.preventDefault(); $("#drop").style.borderColor="var(--accent)"; }));
["dragleave","dragend","drop"].forEach(ev=>$("#drop").addEventListener(ev,e=>{ e.preventDefault(); $("#drop").style.borderColor=""; }));
$("#drop").addEventListener("drop",e=>{ const f=e.dataTransfer.files[0]; if(f&&f.type.startsWith("image/")) readImageScaled(f,800,setPendingImg); });
$("#img-url-btn").addEventListener("click",e=>{ e.stopPropagation(); const u=$("#img-url").value.trim(); if(u){ setPendingImg(u); $("#img-url").value=""; showToast("✓ Bild geladen"); } });
$("#img-url").addEventListener("keydown",e=>{ if(e.key==="Enter"){ e.preventDefault(); $("#img-url-btn").click(); } });
function resetImage(){ pendingImg=null; $("#drop").classList.remove("has"); $("#drop-empty").classList.remove("hidden"); $("#drop-preview").classList.add("hidden"); }
$("#drop-x").addEventListener("click", e=>{ e.stopPropagation(); resetImage(); showToast("Bild entfernt"); });
function flashError(el){ el.classList.add("err"); setTimeout(()=>el.classList.remove("err"),1300); }

$("#add-flip").addEventListener("click", async ()=>{
  const req=[["f-name",v=>v.trim()!==""],["f-ek",v=>v.trim()!==""],["f-payout",v=>v.trim()!==""]]; let bad=false;
  req.forEach(([id,ok])=>{ const el=$("#"+id); if(!ok(el.value)){ flashError(el); bad=true; } });
  if(bad){ showToast("Bitte Pflichtfelder ausfüllen"); return; }
  clampQty(); const dateVal=$("#f-date").value||todayISOInput();
  const q=Math.max(1,parseInt($("#f-qty").value)||1);
  const ekIn=num($("#f-ek").value), payIn=num($("#f-payout").value), shIn=num($("#f-ship").value);
  const data={ name:$("#f-name").value.trim(), ean:$("#f-ean").value.trim(), qty:q,
    ek: flipMode==="total"?ekIn/q:ekIn, payout: flipMode==="total"?payIn/q:payIn, ship: flipMode==="total"?shIn/q:shIn,
    date:new Date(dateVal+"T12:00:00").toISOString() };
  // Bild NICHT als Base64 im flips-JSON ablegen -> in den Storage auslagern, nur URL speichern
  const btn=$("#add-flip"); const label=btn.textContent;
  if(isDataUrl(pendingImg)){ btn.disabled=true; btn.textContent="Bild wird hochgeladen…"; }
  const imgSrc = await persistImage(pendingImg);
  btn.disabled=false; btn.textContent=label;
  if(editingDealId){
    const f=flips.find(x=>x.id===editingDealId);
    if(f){ Object.assign(f,data); f.img = imgSrc || null; }
    DB.saveFlips(flips); highlightId=editingDealId; showToast("✓ Deal aktualisiert");
  } else {
    const flip=Object.assign({id:"f"+Date.now(), img:imgSrc||null}, data);
    flips.push(flip); DB.saveFlips(flips); highlightId=flip.id; showToast("✓ Deal erfolgreich gespeichert");
  }
  setDealForm(false); renderTrackerList(); renderDashboard();
  setTimeout(()=>{ highlightId=null; renderTrackerList(); },1500);
});

function openDealEdit(id){ const f=flips.find(x=>x.id===id); if(!f) return; editingDealId=id;
  $("#f-name").value=f.name; $("#f-ean").value=f.ean||""; $("#f-qty").value=f.qty; $("#f-ek").value=f.ek; $("#f-payout").value=f.payout; $("#f-ship").value=f.ship||""; setFlipMode("each");
  $("#f-date").value=new Date(f.date).toISOString().slice(0,10);
  pendingImg=f.img||null;
  if(f.img){ $("#drop").classList.add("has"); $("#drop-empty").classList.add("hidden"); $("#drop-preview").src=f.img; $("#drop-preview").classList.remove("hidden"); } else resetImage();
  $("#dt-form-title").textContent="Deal bearbeiten"; $("#add-flip").textContent="Änderungen speichern";
  setTab("tracker"); dealFormOpen=true; $("#dt-form").classList.remove("hidden"); $("#dt-toggle-ic").style.transform="rotate(45deg)"; $("#dt-toggle").querySelector("span").textContent=t("ui.close");
  flipFormPreview(); window.scrollTo({top:0,behavior:"smooth"}); }

function deleteDeal(id){ flips=flips.filter(x=>x.id!==id); DB.saveFlips(flips); renderTrackerList(); renderDashboard(); showToast("Deal gelöscht"); }


/* ===== 9 · FEE CALC ===== */
let regionPct=0, last={}, kuMode=true, vkUst=0, ekUst=0, packMode=true;
/* Verkaufsplattformen: steuert Pill-Anzeige + sinnvollen Gebühren-Default im Verkaufs-Dialog.
   hasFees=false -> beim Öffnen des Verkaufs-Dialogs wird "Ohne Marktplatz-Gebühren" vorausgewählt. */
const PLATFORMS = {
  ebay:          { label:"eBay",            pill:"pill-blue", hasFees:true,  img:"ebay",          bg:"#ffffff" },
  ebay_privat:   { label:"eBay · Privat",   pill:"pill-blue", hasFees:true,  ebayPrivate:true, img:"ebay", bg:"#ffffff" },
  kleinanzeigen: { label:"Kleinanzeigen",   pill:"pill-mut",  hasFees:false, img:"kleinanzeigen", bg:"#c3e94e" },
  vinted:        { label:"Vinted",          pill:"pill-mut",  hasFees:false, img:"vinted",        bg:"#007782" },
  amazon:        { label:"Amazon",          pill:"pill-mut",  hasFees:true,  img:"amazon",        bg:"#ffffff" },
  kaufland:      { label:"Kaufland",        pill:"pill-mut",  hasFees:true,  img:"kaufland",      bg:"#ffffff" },
  etsy:          { label:"Etsy",            pill:"pill-mut",  hasFees:true,  tile:"linear-gradient(135deg,#f1641e,#d24d0e)", fg:"#fff", mark:"E" },
  privat:        { label:"Privat/Freunde",  pill:"pill-mut",  hasFees:false, tile:"#475569", fg:"#e2e8f0", svg:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/></svg>' },
  kein:          { label:"Kein Marktplatz", pill:"pill-mut",  hasFees:false, tile:"#3b4457", fg:"#cbd5e1", svg:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="m6 6 12 12"/></svg>' },
  sonstige:      { label:"Sonstige",        pill:"pill-mut",  hasFees:false, tile:"#3b4457", fg:"#cbd5e1", svg:'<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="6" cy="12" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="18" cy="12" r="1.7"/></svg>' },
};
const platformOptions = sel => Object.entries(PLATFORMS).map(([k,v])=>`<option value="${k}"${sel===k?" selected":""}>${v.label}</option>`).join("");

/* ===== Marktplatz-Icon (echtes Logo-PNG oder farbige Kachel) ===== */
function platformIcon(key){
  const p = PLATFORMS[key] || PLATFORMS.ebay;
  if(p.img) return `<span class="plat-ic plat-ic-logo" style="background:${p.bg||"#fff"}"><img src="./logos/${p.img}.png" alt="" loading="lazy"></span>`;
  const inner = p.svg ? p.svg : (p.mark||"?");
  return `<span class="plat-ic" style="background:${p.tile};color:${p.fg}">${inner}</span>`;
}
/* Welche Marktplätze im Verkauf-Dropdown erscheinen (im Profil einstellbar) */
const DEFAULT_ENABLED_PLATFORMS = ["ebay","ebay_privat","kleinanzeigen","vinted","amazon","kaufland","privat","kein"];
function getEnabledPlatforms(){
  let arr=null; try{ arr=JSON.parse(Store.get(uKey("platforms_enabled"))||"null"); }catch(e){}
  if(!Array.isArray(arr) || !arr.length) arr = DEFAULT_ENABLED_PLATFORMS.slice();
  arr = arr.filter(k=>PLATFORMS[k]);
  return arr.length ? arr : ["ebay"];
}
function setEnabledPlatforms(arr){ Store.set(uKey("platforms_enabled"), JSON.stringify((arr||[]).filter(k=>PLATFORMS[k]))); }
function enabledPlatformEntries(){ const en=getEnabledPlatforms(); return Object.entries(PLATFORMS).filter(([k])=>en.includes(k)); }
function platformMenuHTML(sel){
  return enabledPlatformEntries().map(([k,v])=>`
    <button type="button" class="plat-item${k===sel?" sel":""}" data-plat="${k}" role="option" aria-selected="${k===sel}">
      ${platformIcon(k)}
      <span class="plat-nm-wrap"><span class="plat-name">${v.label}</span><span class="plat-sub${v.hasFees?"":" free"}">${v.hasFees?"Marktplatz-Gebühren":"ohne Gebühren"}</span></span>
      <svg class="plat-check" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
    </button>`).join("");
}
function platformTriggerInner(sel){
  const v = PLATFORMS[sel] || PLATFORMS.ebay;
  return `${platformIcon(sel)}
    <span class="plat-name" id="sell-platform-name">${v.label}</span>
    <span class="plat-fee ${v.hasFees?"fee-yes":"fee-no"}" id="sell-platform-fee">${v.hasFees?"Gebühren":"0 €"}</span>
    <svg class="plat-chev" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>`;
}
function selectSellPlatform(k){
  if(!PLATFORMS[k]) return;
  const hidden=$("#sell-platform"), btn=$("#sell-platform-btn"); if(!hidden||!btn) return;
  hidden.value=k; btn.innerHTML=platformTriggerInner(k); hidden.dispatchEvent(new Event("change"));
}
function attachPlatformDropdown(){
  const hidden=$("#sell-platform"), btn=$("#sell-platform-btn"); if(!hidden||!btn) return;
  let menu=null;
  const close=()=>{ if(menu){ menu.remove(); menu=null; } btn.setAttribute("aria-expanded","false"); document.removeEventListener("click",onDoc,true); window.removeEventListener("resize",close); };
  const place=()=>{ const r=btn.getBoundingClientRect(); menu.style.minWidth=r.width+"px"; menu.style.left=r.left+"px"; menu.style.top=(r.bottom+6)+"px"; const mb=menu.getBoundingClientRect(); if(mb.bottom>innerHeight-10) menu.style.top=Math.max(10, r.top-mb.height-6)+"px"; };
  const onDoc=e=>{ if(menu && !menu.contains(e.target) && !btn.contains(e.target)) close(); };
  const open=()=>{ menu=document.createElement("div"); menu.className="plat-menu"; menu.setAttribute("role","listbox"); menu.innerHTML=platformMenuHTML(hidden.value); document.body.appendChild(menu); place(); btn.setAttribute("aria-expanded","true"); menu.querySelectorAll(".plat-item").forEach(it=>it.addEventListener("click",()=>{ selectSellPlatform(it.getAttribute("data-plat")); close(); })); document.addEventListener("click",onDoc,true); window.addEventListener("resize",close); };
  btn.addEventListener("click",e=>{ e.stopPropagation(); menu?close():open(); });
}
/* Profil → Marktplätze ein-/ausblenden */
function renderPlatManager(){
  const box=$("#plat-manage-list"); if(!box) return;
  const en=getEnabledPlatforms();
  box.innerHTML=Object.entries(PLATFORMS).map(([k,v])=>`
    <button type="button" class="pw-toggle plat-manage-row" data-plat="${k}" aria-pressed="${en.includes(k)?"true":"false"}">
      ${platformIcon(k)}
      <span class="pw-toggle-info"><span class="pw-toggle-name">${v.label}</span><span class="pw-toggle-set">${v.ebayPrivate?"privat · innerdeutsch 0 €, Ausland 5 %":(v.hasFees?"mit Gebühren":"ohne Gebühren")}</span></span>
      <span class="pw-sw"></span>
    </button>`).join("");
  box.querySelectorAll(".plat-manage-row").forEach(row=>row.addEventListener("click",()=>{
    const k=row.getAttribute("data-plat"); let en=getEnabledPlatforms();
    if(en.includes(k)){ if(en.length<=1){ showToast("Mindestens ein Marktplatz muss aktiv bleiben"); return; } en=en.filter(x=>x!==k); }
    else { en=Object.keys(PLATFORMS).filter(x=>en.includes(x)||x===k); }
    setEnabledPlatforms(en); row.setAttribute("aria-pressed", en.includes(k)?"true":"false");
  }));
}
/* Eigene Marktplätze: vom Nutzer angelegt, ohne Gebühren-Automatik (echte Gebühren baut
   noah auf Feedback ein). Gespeichert in fixCfg.customMarkets, beim Laden in PLATFORMS
   gespiegelt, damit alle bestehenden Lookups (Verkauf, Anzeige, Report) greifen. */
function getCustomMarkets(){ if(!Array.isArray(fixCfg.customMarkets)) fixCfg.customMarkets=[]; return fixCfg.customMarkets; }
function syncCustomMarkets(){
  Object.keys(PLATFORMS).forEach(k=>{ if(PLATFORMS[k] && PLATFORMS[k].custom) delete PLATFORMS[k]; });
  getCustomMarkets().forEach(cm=>{ if(!cm||!cm.id) return;
    PLATFORMS[cm.id]={ label:cm.name||"Marktplatz", pill:"pill-mut", hasFees:false, custom:true,
      tile:cm.color||"#475569", fg:"#fff", mark:((cm.name||"?").trim().charAt(0)||"?").toUpperCase() }; });
}
function openCustomMarketModal(){
  let selColor = FIX_COLORS[Math.floor(Math.random()*FIX_COLORS.length)];
  const colorsHTML=FIX_COLORS.map(c=>`<button type="button" class="ec-swatch" data-color="${c}" style="background:${c}" aria-selected="${c===selColor?"true":"false"}"></button>`).join("");
  const listHTML=()=>{ const cm=getCustomMarkets(); if(!cm.length) return `<p class="c-sub text-[12px]">Noch keine eigenen Marktplätze.</p>`;
    return cm.map(m=>`<div class="flex items-center justify-between gap-2 rounded-[12px] p-2.5" style="background:var(--cell-2);border:1px solid var(--line)"><div class="flex items-center gap-2 min-w-0"><span class="plat-ic" style="background:${m.color||'#475569'};color:#fff;width:26px;height:26px;border-radius:8px;flex:0 0 auto;display:inline-flex;align-items:center;justify-content:center;font-size:12px;font-weight:800">${escapeHtml(((m.name||'?').trim().charAt(0)||'?').toUpperCase())}</span><span class="font-semibold text-[13.5px] truncate">${escapeHtml(m.name)}</span></div><button class="iconbtn danger cm-del" data-id="${m.id}" title="Löschen">${icoTrash}</button></div>`).join(""); };
  $("#modal-root").innerHTML=`<div class="overlay" id="ov"><div class="modal" style="max-width:440px">
    <div class="flex items-start justify-between gap-3 mb-1">
      <div><p class="font-bold text-[18px]">Eigener Marktplatz</p><p class="c-sub text-[12.5px] mt-0.5">Für Marktplätze, die (noch) nicht dabei sind.</p></div>
      <button id="cm-x" class="iconbtn" title="Schließen" aria-label="Schließen"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg></button>
    </div>
    <div class="my-4"><label class="label" for="cm-name">Name *</label><input id="cm-name" class="field" placeholder="z. B. Momox, Rebuy, Discogs …"></div>
    <div class="mb-4"><p class="label mb-2">Farbe</p><div id="cm-colors" class="ec-swatches">${colorsHTML}</div></div>
    <div class="rounded-[12px] p-3 mb-4" style="background:var(--cell-2);border:1px solid var(--line)"><p class="c-sub text-[12px] leading-relaxed">Eigene Marktplätze laufen <b>ohne Gebühren-Automatik</b> — du trägst die Auszahlung selbst ein. Soll die echte Gebühren-Struktur eingebaut werden? <button type="button" id="cm-feedback" style="background:none;border:0;padding:0;color:var(--brand);font-weight:700;cursor:pointer">Per Feedback melden ↗</button></p></div>
    <button id="cm-add" class="btn-accent w-full" style="margin-bottom:16px">Anlegen</button>
    <p class="label mb-2">Deine Marktplätze</p>
    <div id="cm-list" class="flex flex-col gap-2">${listHTML()}</div>
  </div></div>`;
  const close=()=>{ $("#modal-root").innerHTML=""; };
  $("#cm-x").addEventListener("click",close);
  $$("#cm-colors .ec-swatch").forEach(b=>b.addEventListener("click",()=>{ selColor=b.dataset.color; $$("#cm-colors .ec-swatch").forEach(x=>x.setAttribute("aria-selected",x.dataset.color===selColor?"true":"false")); }));
  $("#cm-feedback").addEventListener("click",()=>{ close(); if(typeof openFeedbackModal==="function") openFeedbackModal(); });
  const bindDel=()=>{ $$("#cm-list .cm-del").forEach(b=>b.addEventListener("click",()=>{ const id=b.dataset.id;
    fixCfg.customMarkets=getCustomMarkets().filter(m=>m.id!==id); DB.saveFixCfg(fixCfg);
    setEnabledPlatforms(getEnabledPlatforms().filter(x=>x!==id)); syncCustomMarkets();
    $("#cm-list").innerHTML=listHTML(); bindDel(); renderPlatManager(); showToast("Marktplatz gelöscht"); })); };
  bindDel();
  $("#cm-add").addEventListener("click",()=>{ const name=$("#cm-name").value.trim(); if(!name){ flashError($("#cm-name")); return; }
    const id="cm"+Date.now(); getCustomMarkets().push({id,name,color:selColor}); DB.saveFixCfg(fixCfg); syncCustomMarkets();
    setEnabledPlatforms(Object.keys(PLATFORMS).filter(x=>getEnabledPlatforms().includes(x)||x===id));
    $("#cm-name").value=""; $("#cm-list").innerHTML=listHTML(); bindDel(); renderPlatManager(); showToast("✓ Marktplatz angelegt"); });
}
if($("#plat-add-custom")) $("#plat-add-custom").addEventListener("click",openCustomMarketModal);
let defaultPlatform = "ebay", defaultUstRate = 19;
const vatF = () => kuMode ? 1.19 : 1;
function calc(){ const vkRaw=num($("#c-vk").value),ekRaw=num($("#c-ek").value),ship=num($("#c-ship").value),adP=num($("#c-ad").value),catP=num($("#c-cat").value);
  const vk = vkUst ? vkRaw/(1+vkUst/100) : vkRaw;
  const ek = ekUst ? ekRaw/(1+ekUst/100) : ekRaw;
  $("#vk-net").textContent = vkUst ? "netto "+eur(vk) : "";
  $("#ek-net").textContent = ekUst ? "netto "+eur(ek) : "";
  const V=vatF();
  const pack = packMode ? 1 : 0;
  const trans=transFee(vk), fvf=vk*catP/100*V, ad=vk*adP/100*V, intl=vk*regionPct/100*V;
  const fees=trans+fvf+ad+intl, payout=vk-fees, profit=payout-ek-ship-pack, margin=vk>0?profit/vk*100:0;
  last={vk,ek,ship,adP,catP,regionPct,payout,fees,profit,margin,pack};
  const rp=$("#r-profit"); rp.textContent=(profit>=0?"+":"")+eur(profit); rp.style.color=profit>=0?"var(--accent)":"var(--danger)";
  $("#r-payout").textContent=eur(payout); $("#r-fees").textContent=eur(fees); $("#r-margin").textContent=pct(margin);
  $("#b-vk").textContent="+ "+eur(vk); $("#b-fvf").textContent="- "+eur(fvf); $("#b-trans").textContent="- "+eur(trans);
  $("#b-ad-l").textContent=`Anzeigengebühr (${adP.toLocaleString("de-DE")} %)`; $("#b-ad").textContent="- "+eur(ad);
  $("#b-int-l").textContent=`Auslandsgebühr (${regionPct.toLocaleString("de-DE")} %)`; $("#b-int").textContent="- "+eur(intl);
  $("#b-ship").textContent="- "+eur(ship); $("#b-total").textContent="- "+eur(fees);
  $("#b-ku-note").textContent = kuMode ? "inkl. 19 % MwSt." : "netto";
  renderGoalStatus(vk,ek,ship,catP+adP+regionPct,margin,profit); }

/* Zielmargen-Ampel: gedeckt / knapp / verfehlt + fehlender VK */
function renderGoalStatus(vk,ek,ship,combined,margin,profit){
  const box=$("#r-goal"); if(!box) return;
  const goalPct=targetMargin()*100;
  const head=$("#r-goal-head"), sub=$("#r-goal-sub"), ic=$("#r-goal-ic"), fill=$("#r-goal-fill"), mark=$("#r-goal-mark");
  if(!(vk>0)){ box.style.background="transparent"; box.style.borderColor="var(--line)";
    ic.innerHTML=`<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--sub)" stroke-width="2.1" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 8h.01M11 12h1v4h1"/></svg>`;
    head.textContent=`Zielmarge ${pct(goalPct)}`; head.style.color="var(--text)";
    sub.textContent="Verkaufspreis eingeben, um die Zielmarge zu prüfen.";
    fill.style.width="0%"; mark.style.left="100%"; return; }

  const need = targetVK(ek,ship,combined,targetMargin(),0);   // VK für Zielmarge
  const gap  = need===Infinity ? Infinity : need-vk;          // >0 = zu billig
  const hit  = margin>=goalPct;
  const near = !hit && margin>=goalPct-3;                     // knapp darunter
  const col  = hit?"var(--accent)": near?"var(--warn, #f5a524)":"var(--danger)";
  const soft = hit?"var(--accent-soft)": near?"transparent":"var(--danger-soft)";

  box.style.background=soft; box.style.borderColor=`color-mix(in srgb, ${col} 42%, var(--line))`;
  ic.innerHTML = hit
    ? `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="${col}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="m8.5 12 2.5 2.5L16 9.5"/></svg>`
    : `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="${col}" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/></svg>`;

  head.style.color=col;
  head.textContent = hit
    ? `Zielmarge ${pct(goalPct)} gedeckt`
    : (profit<0 ? `Verlust — Zielmarge ${pct(goalPct)} verfehlt` : `Zielmarge ${pct(goalPct)} nicht erreicht`);

  if(hit){
    const buffer = vk-need;   // wie viel VK-Luft nach unten
    sub.textContent = `Aktuell ${pct(margin)} · ${buffer>0?`${eur(buffer)} Puffer bis zum Ziel-VK`:"exakt auf Ziel"}`;
  } else if(need===Infinity){
    sub.textContent = `Aktuell ${pct(margin)} · Bei diesen Gebühren ist die Zielmarge rechnerisch nicht erreichbar.`;
  } else {
    sub.innerHTML = `Aktuell ${pct(margin)} · <b style="color:${col}">${eur(gap)} zu wenig</b> — Ziel-VK ${eur(need)}`;
  }

  /* Balken: Marge relativ zum Ziel, Marker sitzt bei 100 % = Ziel */
  const ratio = goalPct>0 ? Math.max(0, margin)/goalPct : 0;
  const scale = Math.max(1.25, ratio);                 // Skala wächst mit, Ziel nie am Rand
  fill.style.width = Math.min(100, (ratio/scale)*100).toFixed(1)+"%";
  fill.style.background = col;
  mark.style.left = ((1/scale)*100).toFixed(1)+"%";
}
["c-vk","c-ek","c-ship","c-ad"].forEach(id=>$("#"+id).addEventListener("input",calc));
$("#c-cat").addEventListener("change",calc);
$("#c-pack").addEventListener("change",()=>{ packMode=$("#c-pack").checked; Store.set("fg_pack", packMode?"1":"0"); calc(); });
/* USt-Schieberegler (toggle, gegenseitig exklusiv pro Feld) */
$$(".ust").forEach(b=>b.addEventListener("click",()=>{
  const field=b.dataset.field, rate=parseInt(b.dataset.rate);
  if(field==="vk") vkUst=(vkUst===rate?0:rate); else ekUst=(ekUst===rate?0:rate);
  const cur = field==="vk"?vkUst:ekUst;
  $$(`.ust[data-field="${field}"]`).forEach(x=>x.setAttribute("aria-selected", parseInt(x.dataset.rate)===cur));
  calc();
}));
$$("#c-region button").forEach(btn=>btn.addEventListener("click",()=>{ regionPct=num(btn.dataset.pct); $$("#c-region button").forEach(b=>b.setAttribute("aria-selected",b===btn)); calc(); }));
$("#c-reset").addEventListener("click",()=>{ $("#c-vk").value=""; $("#c-ek").value=""; $("#c-ship").value=shipDefStr(); $("#c-ad").value="0"; $("#c-cat").value="12"; regionPct=0; vkUst=0; ekUst=0; $$(".ust").forEach(x=>x.setAttribute("aria-selected","false")); $$("#c-region button").forEach(b=>b.setAttribute("aria-selected",b.dataset.pct==="0")); calc(); });
let calcs=[];
const catLabel=()=>$("#c-cat").selectedOptions[0].textContent.split("·")[0].trim();
$("#c-save").addEventListener("click",()=>{ calc();
  calcs.unshift({id:Date.now(),vk:$("#c-vk").value,ek:$("#c-ek").value,ship:$("#c-ship").value,ad:$("#c-ad").value,cat:$("#c-cat").value,region:regionPct,label:catLabel(),profit:last.profit});
  calcs=calcs.slice(0,20); DB.saveCalcs(calcs); renderCalcHistory(); showToast("✓ Berechnung im Verlauf gesichert"); });
$("#hist-clear").addEventListener("click",()=>{ calcs=[]; DB.saveCalcs(calcs); renderCalcHistory(); });
function renderCalcHistory(){ const box=$("#calc-hist"); const sel=$("#hist-count-sel");
  if(sel && !sel.options.length){ for(let i=1;i<=20;i++){ const o=document.createElement("option"); o.value=i; o.textContent=i+(i===1?" Eintrag":" Einträge"); sel.appendChild(o); } sel.value=DB.getSetting("calcHistN","5"); sel.addEventListener("change",()=>{ DB.setSetting("calcHistN",sel.value); renderCalcHistory(); }); }
  const n=parseInt(sel?sel.value:"5")||5;
  box.innerHTML=""; $("#calc-hist-empty").classList.toggle("hidden",calcs.length>0);
  calcs.slice(0,n).forEach(c=>{ const pos=c.profit>=0; const el=document.createElement("button");
    el.style.cssText="text-align:left;background:var(--cell-2);border:1px solid var(--line);border-radius:14px;padding:11px 13px;cursor:pointer;width:100%;transition:border-color .15s ease;";
    el.onmouseenter=()=>el.style.borderColor="var(--accent)"; el.onmouseleave=()=>el.style.borderColor="var(--line)";
    el.innerHTML=`<div class="flex items-center justify-between gap-2"><div class="min-w-0"><p class="text-[13px] font-semibold truncate">${escapeHtml(c.label)} · VK ${eur(num(c.vk))}</p><p class="c-sub text-[11px] mono mt-0.5">EK ${eur(num(c.ek))} · Versand ${eur(num(c.ship))} · Werbung ${num(c.ad).toLocaleString("de-DE")} %</p></div><span class="mono font-bold text-[14px] shrink-0" style="color:${pos?'var(--accent)':'var(--danger)'}">${pos?"+":""}${eur(c.profit)}</span></div>`;
    el.addEventListener("click",()=>loadCalc(c)); box.appendChild(el); }); }
function loadCalc(c){ $("#c-vk").value=c.vk; $("#c-ek").value=c.ek; $("#c-ship").value=c.ship; $("#c-ad").value=c.ad; $("#c-cat").value=c.cat;
  regionPct=num(c.region); $$("#c-region button").forEach(b=>b.setAttribute("aria-selected",num(b.dataset.pct)===regionPct)); calc(); $("#calc-view").scrollIntoView({behavior:"smooth",block:"start"}); }
$("#c-tracker").addEventListener("click",()=>{ calc();
  const flip={id:"f"+Date.now(),name:catLabel()+" Deal",ean:"",qty:1,ek:num($("#c-ek").value),payout:last.payout,ship:num($("#c-ship").value),date:new Date().toISOString(),img:null};
  flips.push(flip); DB.saveFlips(flips); highlightId=flip.id; filterMode="range"; activeRange=7; activeMonth=null;
  setTab("dashboard"); window.scrollTo({top:0,behavior:"smooth"}); setTimeout(()=>{ highlightId=null; renderHistory(); },1500); showToast("✓ Deal in den Tracker übernommen"); });

/* ===== 9b · BREAK-EVEN-HELFER (Schnell-Check für unterwegs) =====
   „Ich zahle X € — ab welchem VK lohnt es sich?" Nutzt dieselbe Rechenlogik
   (targetVK / minProtectVK) wie der Bestand, honoriert KU-Modus & Zielmarge. */
let beFeePct = 12;
function renderBreakEven(){
  const minEl=$("#be-min"); if(!minEl) return;              // View evtl. noch nicht im DOM
  const tgtEl=$("#be-tgt"), minSub=$("#be-min-sub"), tgtSub=$("#be-tgt-sub"), hint=$("#be-hint");
  const ek=num($("#be-ek").value), ship=num($("#be-ship").value), goal=targetMargin();
  tgtSub.textContent = `Zielmarge ${pct(goal*100)}`;
  minSub.textContent = "5 % Marge · nie darunter";
  if(!(ek>0)){ minEl.textContent="—"; tgtEl.textContent="—";
    hint.textContent="Kaufpreis eingeben, um Mindest- und Ziel-VK zu sehen."; return; }
  const minVK=minProtectVK(ek,ship,beFeePct), tgtVK=targetVK(ek,ship,beFeePct,goal,0);
  const up = v => Math.ceil(v*100)/100;                      // Preisuntergrenze immer aufrunden
  const fmt = v => v===Infinity ? "—" : eur(up(v));
  minEl.textContent=fmt(minVK); tgtEl.textContent=fmt(tgtVK);
  if(tgtVK===Infinity){
    hint.textContent="Bei diesem Gebührensatz ist die Zielmarge rechnerisch nicht erreichbar.";
  } else {
    const ev=evalVK(up(tgtVK),ek,ship,beFeePct);
    hint.innerHTML = `Bei Ziel-VK ${eur(up(tgtVK))} bleiben <b style="color:var(--accent)">${eur(ev.profit)}</b> Gewinn. Unter ${eur(up(minVK))} lohnt sich der Kauf nicht.` + (kuMode?' · <span class="c-sub">inkl. MwSt-Modus</span>':'');
  }
}
["be-ek","be-ship"].forEach(id=>{ const el=$("#"+id); if(el) el.addEventListener("input",renderBreakEven); });
$$("#be-card .be-fee-btn").forEach(b=>b.addEventListener("click",()=>{
  beFeePct=num(b.dataset.pct);
  $$("#be-card .be-fee-btn").forEach(x=>x.setAttribute("aria-selected", x===b));
  renderBreakEven();
}));
/* Umschalter: Standard 'calc' (normaler Rechner), optional 'be' (Schnell-Check).
   Letzte Wahl wird gemerkt, Voreinstellung bleibt der normale Gebührenrechner. */
let calcMode = Store.get("fg_calcmode")==="be" ? "be" : "calc";
function setCalcMode(m, persist){
  calcMode = (m==="be") ? "be" : "calc";
  $$("#calc-mode button").forEach(b=>b.setAttribute("aria-selected", b.dataset.mode===calcMode));
  $("#be-card").classList.toggle("hidden", calcMode!=="be");
  $("#calc-standard").classList.toggle("hidden", calcMode!=="calc");
  if(persist!==false) Store.set("fg_calcmode", calcMode);
  if(calcMode==="be") renderBreakEven();
}
$$("#calc-mode button").forEach(b=>b.addEventListener("click",()=>setCalcMode(b.dataset.mode)));

/* ===== Kaufland Global Marketplace · Gebührenrechner (Stand 2026, Kaufland.de) =====
   Verkaufsprovision auf den Verkaufspreis (netto). Kein Auslandsentgelt, keine
   Fixgebühr je Bestellung außer Medien-Zuschlag (0,70 €). Grundgebühr (Abo) ist
   monatlich — gehört in die Fixkosten, nicht in die Stück-Rechnung.
   MwSt. auf Gebühren folgt dem konto-weiten Kleinunternehmer-Modus (vatF). */
const KAUFLAND_CATS = [
  {pct:13, pctPL:10, label:"Standard / alle anderen"},
  {pct:7,  pctPL:4,  label:"Computer, Elektronik, Reifen, Felgen"},
  {pct:7,  pctPL:7,  label:"Haushaltselektronik (Großgeräte)"},
  {pct:10, pctPL:7,  label:"Werkzeug & Gartengeräte"},
  {pct:10, pctPL:8,  label:"Parfüm"},
  {pct:13, pctPL:7,  label:"Kleingeräte, Fahrräder & E-Bikes, Elektronik-Zubehör"},
  {pct:13, pctPL:8,  label:"Körperpflege & Gesundheit, Auto & Motorrad"},
  {pct:13, pctPL:9,  label:"Baumarkt"},
  {pct:13, pctPL:10, label:"Möbel, Sport, Spielzeug, Lebensmittel"},
  {pct:13, pctPL:9,  label:"Medien", fixed:0.70},
  {pct:14, pctPL:9,  label:"Garten"},
  {pct:14, pctPL:10, label:"Matratzen, Küche, Kleidung, Schuhe, Fitness"},
  {pct:16, pctPL:12, label:"Schmuck"}
];
function kauflandPct(cat, isPL){ return isPL ? cat.pctPL : cat.pct; }
let klPackMode = Store.get("fg_kpack")==="1";
let klRegion = Store.get("fg_kregion")==="pl" ? "pl" : "de";
let kLast = {};
function fillKauflandCats(){ const sel=$("#k-cat"); if(!sel) return; const cur=sel.value; const isPL=klRegion==="pl";
  sel.innerHTML=KAUFLAND_CATS.map((c,i)=>`<option value="${i}">${escapeHtml(c.label)} · ${kauflandPct(c,isPL)} %${c.fixed?" + "+eur(c.fixed):""}</option>`).join("");
  if(cur) sel.value=cur; }
function kauflandCalc(){ if(!$("#k-vk")) return;
  const vk=num($("#k-vk").value), ek=num($("#k-ek").value), ship=num($("#k-ship").value);
  const cat=KAUFLAND_CATS[parseInt($("#k-cat").value)||0]||KAUFLAND_CATS[0];
  const isPL=klRegion==="pl", pctUsed=kauflandPct(cat,isPL);
  const V=vatF(), pack=klPackMode?1:0;
  const comm=vk*pctUsed/100*V, media=(cat.fixed||0)*V, fees=comm+media;
  const payout=vk-fees, profit=payout-ek-ship-pack, margin=vk>0?profit/vk*100:0;
  kLast={vk,ek,ship,pack,catPct:pctUsed,fees,payout,profit,margin};
  const rp=$("#k-profit"); rp.textContent=(profit>=0?"+":"")+eur(profit); rp.style.color=profit>=0?"var(--accent)":"var(--danger)";
  $("#k-payout").textContent=eur(payout); $("#k-fees").textContent=eur(fees); $("#k-margin").textContent=pct(margin);
  $("#kb-vk").textContent="+ "+eur(vk);
  $("#kb-comm-l").textContent=`Verkaufsprovision (${pctUsed.toLocaleString("de-DE")} %${isPL?" · PL":""})`;
  $("#kb-comm").textContent="- "+eur(comm);
  $("#kb-media-row").style.display=(cat.fixed>0)?"":"none"; $("#kb-media").textContent="- "+eur(media);
  $("#kb-ship").textContent="- "+eur(ship);
  $("#kb-pack-row").style.display=(pack>0)?"":"none"; $("#kb-pack").textContent="- "+eur(pack);
  $("#kb-total").textContent="- "+eur(fees);
  $("#kb-ku-note").textContent = kuMode ? "inkl. 19 % MwSt." : "netto"; }
if($("#k-cat")){ ["k-vk","k-ek","k-ship"].forEach(id=>$("#"+id).addEventListener("input",kauflandCalc)); $("#k-cat").addEventListener("change",kauflandCalc); }
if($("#k-pack")) $("#k-pack").addEventListener("change",()=>{ klPackMode=$("#k-pack").checked; Store.set("fg_kpack",klPackMode?"1":"0"); kauflandCalc(); });
$$("#k-region button").forEach(b=>b.addEventListener("click",()=>{ klRegion=b.dataset.region==="pl"?"pl":"de"; Store.set("fg_kregion",klRegion); $$("#k-region button").forEach(x=>x.setAttribute("aria-selected", x.dataset.region===klRegion)); fillKauflandCats(); kauflandCalc(); }));
if($("#k-inv")) $("#k-inv").addEventListener("click",()=>{ kauflandCalc(); setTab("inventory"); setInvForm(true);
  $("#iv-name").value="Kaufland Deal"; $("#iv-ean").value=""; $("#iv-qty").value="1";
  $("#iv-vk").value=(kLast.vk||0).toFixed(2).replace(".",","); $("#iv-ek").value=(kLast.ek||0).toFixed(2).replace(".",",");
  $("#iv-ship").value=(kLast.ship||0).toFixed(2).replace(".",",");
  window.scrollTo({top:0,behavior:"smooth"}); showToast("✓ Werte ins Inventory übernommen – prüfen & speichern"); });

/* Marktplatz-Umschalter: eBay-Rechner (mit Modus-Umschalter) vs Kaufland-Rechner.
   Beim Öffnen des Gebühren-Tabs wird der Standard-Marktplatz des Kontos gezeigt. */
let calcMarket = "ebay";
function setCalcMarket(mkt, persist){
  calcMarket = (mkt==="kaufland") ? "kaufland" : "ebay";
  $$("#calc-market button").forEach(b=>b.setAttribute("aria-selected", b.dataset.market===calcMarket));
  const isK = calcMarket==="kaufland";
  if($("#calc-mode")) $("#calc-mode").classList.toggle("hidden", isK);
  if($("#calc-kaufland")) $("#calc-kaufland").classList.toggle("hidden", !isK);
  if(isK){ if($("#be-card")) $("#be-card").classList.add("hidden"); if($("#calc-standard")) $("#calc-standard").classList.add("hidden"); fillKauflandCats(); if($("#k-pack")) $("#k-pack").checked=klPackMode; $$("#k-region button").forEach(x=>x.setAttribute("aria-selected", x.dataset.region===klRegion)); kauflandCalc(); }
  else { setCalcMode(calcMode, false); }
  if(persist!==false) Store.set(uKey("calcmarket"), calcMarket); }
$$("#calc-market button").forEach(b=>b.addEventListener("click",()=>setCalcMarket(b.dataset.market)));
setCalcMode(calcMode, false);   // Ausgangszustand ohne erneutes Schreiben herstellen

/* ===== 10 · INVENTORY + PREISSCHUTZ ===== */
let inventory=[], fixed=[], fixCfg={revenue:4000,packages:60,baseMargin:15};
let invQuery="", invSort="recent", invExpanded=new Set();
let invFilter="active", bulkMode=false, bulkSel=new Set();   // v4.1: Status-Filter + Bulk-Auswahl
let staleDays = parseInt(DB.getSetting("stale","30")) || 30;   // Ladenhüter-Schwelle (gelb); rot = 2×

/* ===== Versandkosten-Vorlagen (Presets + Standard) =====
   Der Standard (def) ist überall vorausgewählt; die Presets erscheinen als
   Dropdown (datalist) an jedem Versand-Feld – frei überschreibbar bleibt es.
   Gespeichert pro User in Supabase (app_state 'shipcfg'), also geräteübergreifend. */
function defaultShipCfg(){ return { def:6.19, presets:[
  {label:"Warensendung / Brief", amount:1.95},
  {label:"DHL Päckchen", amount:4.79},
  {label:"Paket bis 2 kg", amount:5.49},
  {label:"Paket bis 5 kg", amount:6.19},
  {label:"Paket bis 10 kg", amount:8.49}
] }; }
function normalizeShipCfg(o){
  const d = (o && typeof o==="object") ? o : {};
  let presets = Array.isArray(d.presets) ? d.presets
      .map(p=>({ label:String((p&&p.label)||"").trim(), amount:num(p&&p.amount) }))
      .filter(p=>isFinite(p.amount) && p.amount>=0)
    : defaultShipCfg().presets;
  // pro Betrag nur eine Vorlage (Betrag ist der eindeutige Schlüssel für Standard/Löschen)
  const seen=new Set();
  presets = presets.filter(p=>{ const k=p.amount.toFixed(2); if(seen.has(k)) return false; seen.add(k); return true; });
  let def = num(d.def); if(!isFinite(def) || def<0) def = 6.19;
  return { def, presets };
}
let shipCfg = defaultShipCfg();
const shipDef = () => (shipCfg && isFinite(num(shipCfg.def))) ? num(shipCfg.def) : 6.19;
const shipDefStr = () => String(shipDef()).replace(".",",");
/* Das eigene Dropdown (siehe attachShipDropdown) liest shipCfg direkt –
   ein <datalist> ist nicht mehr nötig. Funktion bleibt als No-op erhalten,
   damit bestehende Aufrufer unverändert funktionieren. */
function renderShipPresets(){ /* no-op: Custom-Dropdown liest shipCfg live */ }

/* ===== Eigenes Versand-Dropdown (zuverlässig, zeigt IMMER alle Vorlagen) ===== */
const SHIP_FIELD_IDS = ["c-ship","be-ship","iv-ship","f-ship"];
function shipMenuClose(){ const m=document.getElementById("ship-menu-live"); if(m) m.remove();
  document.removeEventListener("mousedown", shipMenuOutside, true);
  window.removeEventListener("scroll", shipMenuClose, true); window.removeEventListener("resize", shipMenuClose); }
function shipMenuOutside(e){ const m=document.getElementById("ship-menu-live");
  if(m && !m.contains(e.target) && !(e.target.closest && e.target.closest(".ship-dd-btn"))) shipMenuClose(); }
function shipMenuOpen(input){
  shipMenuClose();
  const presets=shipCfg.presets.slice().sort((a,b)=>a.amount-b.amount);
  const m=document.createElement("div"); m.id="ship-menu-live"; m.className="ship-menu"; m._for=input;
  m.innerHTML = presets.length ? presets.map(p=>{
    const isDef=Math.abs(p.amount-shipDef())<0.005;
    return `<button type="button" class="ship-menu-item" data-amt="${p.amount.toFixed(2)}"><span class="mono">${eur(p.amount)}</span><span class="ship-menu-lbl">${escapeHtml(p.label||'')}</span>${isDef?'<span class="ship-menu-def">Standard</span>':''}</button>`;
  }).join("") : `<div class="ship-menu-empty">Keine Vorlagen — im Profil unter „Versandkosten-Vorlagen" anlegen.</div>`;
  document.body.appendChild(m);
  const r=input.getBoundingClientRect();
  m.style.left=Math.round(r.left)+"px"; m.style.top=Math.round(r.bottom+4)+"px"; m.style.minWidth=Math.round(r.width)+"px";
  m.querySelectorAll(".ship-menu-item").forEach(b=>b.addEventListener("click",()=>{
    input.value=String(num(b.dataset.amt)).replace(".",","); input.dispatchEvent(new Event("input",{bubbles:true})); input.focus(); shipMenuClose();
  }));
  setTimeout(()=>{ document.addEventListener("mousedown", shipMenuOutside, true);
    window.addEventListener("scroll", shipMenuClose, true); window.addEventListener("resize", shipMenuClose); }, 0);
}
function attachShipDropdown(input){
  if(!input || input.dataset.shipDd) return; input.dataset.shipDd="1";
  const wrap=document.createElement("span"); wrap.className="ship-dd-wrap";
  input.parentNode.insertBefore(wrap, input); wrap.appendChild(input);
  input.style.paddingRight="40px";
  const btn=document.createElement("button"); btn.type="button"; btn.className="ship-dd-btn"; btn.tabIndex=-1; btn.setAttribute("aria-label","Versand-Vorlagen wählen");
  btn.innerHTML=`<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>`;
  btn.addEventListener("click",e=>{ e.preventDefault(); e.stopPropagation();
    const cur=document.getElementById("ship-menu-live"); if(cur && cur._for===input) shipMenuClose(); else shipMenuOpen(input); });
  wrap.appendChild(btn);
}
function initShipDropdowns(){ SHIP_FIELD_IDS.forEach(id=>attachShipDropdown(document.getElementById(id))); }
/* Standard in die Eingabefelder setzen (nur wenn der Nutzer nichts anderes drin hat) */
function applyShipDefaults(){
  [["c-ship"],["iv-ship"],["be-ship"]].forEach(([id])=>{ const el=document.getElementById(id); if(el) el.value=shipDefStr(); });
  if(typeof calc==="function") calc();
  if(typeof renderBreakEven==="function") renderBreakEven();
}
/* Normalisieren + Dropdown aktualisieren + im Hintergrund speichern (UI blockiert nie
   auf den Netz-Roundtrip; Fehler zeigt die Speicher-Fehler-Leiste via dbSave). */
function persistShip(){ shipCfg=normalizeShipCfg(shipCfg); renderShipPresets(); DB.saveShipCfg(shipCfg); }

/* ===== eBay-Gebühren-Schema (Stand 01.07.2026) =====
   Artikel speichern nur den %-Satz, nicht die Kategorie. Alte Sätze, deren
   Kategorien sich teilweise geändert haben, müssen vom Nutzer geprüft werden.
   FEE_VER stempelt geprüfte/neue Artikel, damit sie nicht erneut auftauchen. */
const FEE_VER = 2;
const FEE_CHANGED_RATES = [6.5, 11, 12];   // alte Sätze mit möglichen Änderungen
/* Vorschläge je altem Satz: [neuer %, Label] – erste Option = „bleibt gleich“ */
const FEE_MIGRATE_OPTIONS = {
  "6.5": [ [6.5,"Münzen / Auto-Entertainment / Felgen"], [7,"Elektronik & Geräte (neu)"] ],
  "11":  [ [11,"Cards / Modellbau / Instrumente / Uhren"], [12,"Elektronik-Zubehör (neu)"] ],
  "12":  [ [12,"Standard / Mode / Spielzeug / Medien"], [13,"Garten & Terrasse / Heimwerker (neu)"], [14,"Business / Sport / Möbel / Baby … (neu)"] ]
};
function feeMigrationList(){ return inventory.filter(it=> (it.feeVer||1) < FEE_VER && FEE_CHANGED_RATES.includes(num(it.catPct)) ); }
function stampAllFeeVer(){ inventory.forEach(it=>{ if(!it.feeVer||it.feeVer<FEE_VER) it.feeVer=FEE_VER; }); DB.saveInventory(inventory); }

/* --- Fixkosten-Aggregate + DYNAMISCHER MARGEN-ALGORITHMUS ---
   Ersetzt den statischen 15 %-Puffer:
   • fixedShare = monatliche Fixkosten / monatlicher Umsatz  (Effizienz-Kennzahl)
     -> Je höher der Umsatz, desto kleiner der Anteil -> niedrigere Zielmarge.
   • fixedPerPackage = Fixkosten / Pakete  -> fließt als Overhead in den
     Break-Even jedes Artikels ein (weniger Pakete => höherer Mindest-VK). */
/* Wiederkehrende Ausgaben: frei wählbares Intervall (Tag/Woche/Monat/Jahr/alle X Tage).
   Jeder Betrag wird auf einen MONATSWERT normalisiert, damit „Ausgaben/Monat",
   Break-Even, Zielmarge, Report & Aufschlüsselung alle stimmig bleiben. */
const DAYS_PER_MONTH = 30.4375;
function fixTodayISO(){ const d=new Date(); return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0"); }
function fixIntervalDays(f){ const iv=f&&f.interval;
  if(iv==="day") return 1; if(iv==="week") return 7; if(iv==="year") return 365.25;
  if(iv==="custom") return Math.max(1, num(f.intervalDays)||30);
  return DAYS_PER_MONTH; /* month (Standard, auch für Alt-Einträge ohne interval) */ }
function fixMonthly(f){ return num(f.amount) * (DAYS_PER_MONTH / fixIntervalDays(f)); }
function fixIntervalShort(f){ const iv=f&&f.interval;
  if(iv==="day") return "/Tag"; if(iv==="week") return "/Wo"; if(iv==="year") return "/Jahr";
  if(iv==="custom") return "/"+Math.max(1,num(f.intervalDays)||30)+" T"; return "/M"; }
function fixIntervalLabel(f){ const iv=f&&f.interval;
  if(iv==="day") return "täglich"; if(iv==="week") return "wöchentlich"; if(iv==="year") return "jährlich";
  if(iv==="custom") return "alle "+Math.max(1,num(f.intervalDays)||30)+" Tage"; return "monatlich"; }
function fixNextDue(f){ if(!f||!f.anchor) return null;
  const today=new Date(); today.setHours(0,0,0,0);
  let d=new Date(f.anchor+"T00:00:00"); if(isNaN(d)) return null;
  // Nächste Fälligkeit liegt STRIKT in der Zukunft: das Startdatum / die letzte Zahlung
  // gilt als erledigt, also mindestens ein Intervall weiter (kein „heute fällig" beim Anlegen).
  const iv=f.interval;
  if(!iv||iv==="month"){ while(d<=today) d.setMonth(d.getMonth()+1); }
  else if(iv==="year"){ while(d<=today) d.setFullYear(d.getFullYear()+1); }
  else { const step=Math.round(fixIntervalDays(f))||1, ms=step*86400000;
    if(d.getTime()<=today.getTime()){ const n=Math.floor((today.getTime()-d.getTime())/ms)+1; d=new Date(d.getTime()+n*ms); } }
  return d; }
function fixNextDueTxt(f){ const nd=fixNextDue(f); if(!nd) return "";
  const today=new Date(); today.setHours(0,0,0,0);
  const days=Math.round((nd-today)/86400000);
  const dstr=nd.toLocaleDateString("de-DE",{day:"2-digit",month:"short"}).replace(".","");
  if(days<=0) return "heute fällig"; if(days===1) return "morgen · "+dstr;
  return "in "+days+" T · "+dstr; }
function fixedTotal(){ return fixed.reduce((s,f)=>s+fixMonthly(f),0); }
/* Auto-Statistik aus dem Tracker für einen Zeitraum (Tage) */
let fixPeriod = parseInt(Store.get("fg_fixperiod")||"30") || 30;
function recentStats(days){
  const since = Date.now() - days*86400000;
  const view = flips.filter(f=>new Date(f.date).getTime()>=since);
  const revenue = view.reduce((s,f)=>s+flipRevenue(f),0);
  const packages = view.reduce((s,f)=>s+(f.qty||1),0);
  return { revenue, packages, count:view.length };
}
/* Fixkosten sind monatlich erfasst -> auf den Zeitraum skalieren */
function fixedPeriodTotal(){ return fixedTotal() * (fixPeriod/30); }
function fixedPerPackage(){ const {packages}=recentStats(fixPeriod); return fixedPeriodTotal()/Math.max(1,packages); }
function targetMargin(){ const m=num(fixCfg.baseMargin); return (isFinite(m)&&m>0?m:15)/100; }

/* ===== Verkaufs-Chronik pro Bestandsartikel =====
   Neue Verkäufe tragen invId. Ältere Deals (vor v3.0) werden über EAN,
   ersatzweise über den Namen, zugeordnet – so ist die Historie sofort gefüllt. */
function salesForItem(it){
  const key=(it.ean||"").trim(), nm=(it.name||"").trim().toLowerCase();
  return flips.filter(f=>{
    if(f.invId) return f.invId===it.id;
    if(key && (f.ean||"").trim()===key) return true;
    return !f.ean && !key && (f.name||"").trim().toLowerCase()===nm;
  }).sort((a,b)=>new Date(b.date)-new Date(a.date));
}
function salesHistoryHTML(it){
  const s=salesForItem(it);
  if(!s.length) return `<div class="sale-log empty"><span class="c-sub text-[12px]">${lang==="en"?"No sales yet for this item.":"Noch keine Verkäufe für diesen Artikel."}</span></div>`;
  const units=s.reduce((n,f)=>n+(f.qty||1),0), tot=s.reduce((n,f)=>n+flipProfit(f),0);
  const rows=s.slice(0,6).map(f=>{ const p=flipProfit(f), pos=p>=0, q=f.qty||1;
    return `<div class="sale-row">
      <span class="sale-date">${fmtDate(f.date)}</span>
      <span class="sale-qty">${q}×</span>
      <span class="sale-vk mono">${eur(num(f.payout))}</span>
      <span class="sale-p mono" style="color:${pos?'var(--accent)':'var(--danger)'}">${pos?"+":""}${eur(p)}</span>
    </div>`; }).join("");
  const more = s.length>6 ? `<p class="c-sub text-[11px] mt-2">+ ${s.length-6} ${lang==="en"?"more":"weitere"}</p>` : "";
  return `<div class="sale-log">
    <div class="sale-head">
      <span class="text-[11px] font-semibold uppercase tracking-wider c-sub">${lang==="en"?"Sales history":"Verkaufs-Chronik"}</span>
      <span class="c-sub text-[11px] mono">${units} ${lang==="en"?"sold":"verkauft"} · <b style="color:${tot>=0?'var(--accent)':'var(--danger)'}">${tot>=0?"+":""}${eur(tot)}</b></span>
    </div>
    ${rows}${more}
  </div>`;
}
function dynTargetMargin(){ return targetMargin(); } /* fix statt dynamisch */
const BREAK_EVEN_MARGIN = 0.05;

function evalVK(vk,ek,ship,combinedPct){ const V=vatF(); const fees=transFee(vk)+vk*combinedPct/100*V,payout=vk-fees,profit=payout-ek-ship; return {fees,payout,profit,margin:vk>0?profit/vk*100:0}; }
/* eBay-Kategorie-% grob auf die passende Kaufland-Provision mappen (Elektronik→Elektronik usw.). */
function ebayPctToKauflandPct(ebayPct){ ebayPct=num(ebayPct);
  if(ebayPct>0 && ebayPct<=7) return 7;    // Elektronik / Geräte / Reifen
  if(ebayPct>=16) return 16;               // Uhren & Schmuck
  if(ebayPct>=14) return 14;               // Kleidung / Sport / Möbel-Zone
  return 13;                               // Standard / Mode / Medien / Garten
}
/* Marktplatz-abhängige Gewinn-Projektion für den Bestand-Deal-Score: rechnet mit dem
   Gebührenmodell des angegebenen Marktplatzes statt fix eBay-gewerblich. */
function mpEval(platKey, vk, ek, ship, item){
  const V=vatF(); const p=PLATFORMS[platKey]||PLATFORMS.ebay; let fees;
  if(!p.hasFees || p.ebayPrivate) fees=0;                                   // gebührenfrei / eBay-Privat (Inland-Projektion)
  else if(platKey==="kaufland") fees=vk*ebayPctToKauflandPct(item.catPct)/100*V;
  else fees=transFee(vk)+vk*(num(item.catPct)+num(item.adPct)+num(item.regionPct))/100*V;   // eBay gewerblich
  const payout=vk-fees, profit=payout-ek-ship;
  return {fees,payout,profit,margin:vk>0?profit/vk*100:0};
}
/* Deal-Score: kompakte Note A–E aus dem ROI (Gewinn/Einsatz) — gute Deals auf einen Blick */
function dealGrade(profit, ek){ const roi = ek>0 ? profit/ek*100 : (profit>0?200:-1);
  if(profit<0) return {g:"E", col:"var(--danger)", roi};
  if(roi>=50) return {g:"A", col:"var(--accent)", roi};
  if(roi>=30) return {g:"B", col:"var(--accent)", roi};
  if(roi>=15) return {g:"C", col:"#f5a524", roi};
  if(roi>=5)  return {g:"D", col:"#f5a524", roi};
  return {g:"E", col:"var(--danger)", roi}; }
/* Wiederverwendbares Erklär-Fenster: „wofür ist das + wie wird gerechnet". */
/* ===== App-Download (öffentlich, für alle) · direkte GitHub-Release-Asset-Links =====
   Windows-.exe liegt im Release v1.1.0, die Mac-.dmgs im Release desktop-v1.1.0. */
const DL_WIN = "https://github.com/Noah1g/flipdeck/releases/download/v1.1.0/Flipdeck-Setup.exe";
const DL_MAC_ARM = "https://github.com/Noah1g/flipdeck/releases/download/desktop-v1.1.0/Flipdeck-mac-arm64.dmg";
const DL_MAC_X64 = "https://github.com/Noah1g/flipdeck/releases/download/desktop-v1.1.0/Flipdeck-mac-x64.dmg";
function openDownloadModal(){
  const ua=navigator.userAgent||""; const isMac=/Mac/i.test(ua)&&!/iPhone|iPad|iPod/i.test(ua); const isWin=/Win/i.test(ua);
  const opt=(rec,icon,title,sub,url)=>`<a href="${url}" target="_blank" rel="noopener noreferrer" class="dl-opt" style="display:flex;align-items:center;gap:12px;padding:13px 14px;border-radius:13px;border:1px solid ${rec?'color-mix(in srgb,var(--brand) 45%,var(--line))':'var(--line)'};background:${rec?'color-mix(in srgb,var(--brand) 10%,transparent)':'color-mix(in srgb,var(--cell-2) 60%,transparent)'};text-decoration:none;color:var(--text);margin-bottom:10px">
      <span style="font-size:22px;flex:0 0 auto;line-height:1">${icon}</span>
      <span style="flex:1;min-width:0"><span class="font-semibold text-[14px]" style="display:block">${title}${rec?' <span class="pill pill-accent" style="font-size:10px">dein System</span>':''}</span><span class="c-sub text-[12px]">${sub}</span></span>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--sub)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="flex:0 0 auto"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>
    </a>`;
  $("#modal-root").innerHTML=`<div class="overlay" id="ov"><div class="modal" style="max-width:430px">
    <div class="flex items-start justify-between gap-3 mb-3"><div><p class="font-bold text-[18px]">Flipdeck-App laden</p><p class="c-sub text-[12.5px] mt-0.5">Wähle dein System — der Rest läuft im Browser weiter.</p></div><button id="dl-x" class="iconbtn" title="Schließen"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg></button></div>
    ${opt(isWin,"🪟","Windows","Installations-Datei (.exe)",DL_WIN)}
    ${opt(isMac,"💻","macOS · Apple Silicon","M1/M2/M3/M4 (.dmg)",DL_MAC_ARM)}
    ${opt(false,"💻","macOS · Intel","ältere Intel-Macs (.dmg)",DL_MAC_X64)}
    <p class="c-sub text-[11px] leading-relaxed mt-1">Am <b>Mac</b> beim ersten Start: Rechtsklick auf die App → „Öffnen" (einmalig). <b>Windows</b>: .exe ausführen.</p>
  </div></div>`;
  const close=()=>{ $("#modal-root").innerHTML=""; };
  $("#dl-x").addEventListener("click",close); const ov=$("#ov"); if(ov) ov.addEventListener("click",e=>{ if(e.target===ov) close(); });
}
document.addEventListener("click", function(e){ const a=e.target.closest && e.target.closest(".js-dl"); if(!a) return; e.preventDefault(); openDownloadModal(); });

function openInfoModal(title, bodyHTML){
  $("#modal-root").innerHTML=`<div class="overlay" id="ov"><div class="modal" style="max-width:420px">
    <div class="flex items-start justify-between gap-3 mb-3">
      <p class="font-bold text-[17px]">${escapeHtml(title)}</p>
      <button id="info-x" class="iconbtn" title="Schließen" aria-label="Schließen"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg></button>
    </div>
    <div class="text-[13.5px] leading-relaxed">${bodyHTML}</div>
    <button id="info-ok" class="btn-accent w-full" style="margin-top:16px">Verstanden</button>
  </div></div>`;
  const close=()=>{ $("#modal-root").innerHTML=""; };
  $("#info-x").addEventListener("click",close); $("#info-ok").addEventListener("click",close);
  const ov=$("#ov"); if(ov) ov.addEventListener("click",e=>{ if(e.target===ov) close(); });
}
function dealScoreInfoHTML(ds){
  const acc="var(--accent)", warn="#f5a524", dng="var(--danger)";
  const row=(g,txt,col)=>`<div style="display:flex;align-items:center;gap:9px;margin:6px 0"><span class="pill" style="border:1px solid color-mix(in srgb,${col} 45%,var(--line));color:${col};background:color-mix(in srgb,${col} 12%,transparent);font-weight:800;min-width:28px;text-align:center">${g}</span><span class="c-sub" style="color:var(--text)">${txt}</span></div>`;
  const cur = ds ? `<div class="rounded-[12px] p-3 mb-3" style="background:color-mix(in srgb,${ds.col} 12%,transparent);border:1px solid color-mix(in srgb,${ds.col} 35%,var(--line))"><b style="color:${ds.col}">Dieser Deal: ${escapeHtml(ds.g)}</b> · ROI ${pct(isFinite(ds.roi)?ds.roi:0)}</div>` : "";
  // Marktplatz-Aufschlüsselung: nur die für DICH relevanten Marktplätze (Standard-Typ + genutzte).
  let comp="";
  if(ds && isFinite(ds.vk) && ds.vk>0 && isFinite(ds.ek)){
    const V=vatF(), vk=ds.vk, ek=ds.ek, ship=ds.ship||0, comb=isFinite(ds.comb)?ds.comb:0, cat=isFinite(ds.cat)?ds.cat:comb;
    const mk=profit=>dealGrade(profit, ek);
    const enabled=(typeof getEnabledPlatforms==="function")?getEnabledPlatforms():[];
    const priv=(typeof defaultPlatform!=="undefined" && defaultPlatform==="ebay_privat");
    const rows=[];
    if(priv) rows.push(["eBay Privat (Inland)", mk(vk - ek - ship)]);
    else     rows.push(["eBay gewerblich", mk(vk - (transFee(vk)+vk*comb/100*V) - ek - ship)]);
    if(enabled.includes("kaufland")){ const kp=ebayPctToKauflandPct(cat); rows.push([`Kaufland (${kp} %)`, mk(vk - vk*kp/100*V - ek - ship)]); }
    if(rows.length>=2){
      const cline=r=>`<div style="display:flex;align-items:center;justify-content:space-between;gap:9px;margin:6px 0"><span style="color:var(--text)">${r[0]}</span><span style="display:inline-flex;align-items:center;gap:8px"><span class="c-sub" style="font-size:12px">ROI ${pct(r[1].roi)}</span><span class="pill" style="border:1px solid color-mix(in srgb,${r[1].col} 45%,var(--line));color:${r[1].col};background:color-mix(in srgb,${r[1].col} 12%,transparent);font-weight:800;min-width:26px;text-align:center">${r[1].g}</span></span></div>`;
      const dLbl=(typeof PLATFORMS!=="undefined" && PLATFORMS[defaultPlatform]) ? PLATFORMS[defaultPlatform].label : "deinem Standard-Marktplatz";
      comp = `<div style="border-top:1px solid var(--line);margin-top:14px;padding-top:12px">
        <p style="font-weight:600" class="mb-1">Je nach Marktplatz <span class="c-sub" style="font-weight:400">· bei VK ${eur(vk)}</span></p>
        ${rows.map(cline).join("")}
        <p class="c-sub text-[11px] mt-2 leading-relaxed">Der ◆-Score auf der Karte rechnet mit deinem Standard-Marktplatz (<b>${escapeHtml(dLbl)}</b>). Beim Verkauf-Eintragen zählt der real gewählte.</p></div>`;
    }
  }
  return `${cur}<p class="mb-3" style="color:var(--text)">Der <b>Deal-Score</b> zeigt auf einen Blick, wie profitabel ein Verkauf ist — gemessen am <b>ROI</b> (Rendite): <b>Gewinn ÷ Einkaufspreis</b>. Beispiel: 30 € Gewinn auf 60 € Einkauf = 50 % ROI.</p>
    ${row("A","ROI ≥ 50 % — Top-Deal",acc)}
    ${row("B","ROI ≥ 30 % — stark",acc)}
    ${row("C","ROI ≥ 15 % — solide",warn)}
    ${row("D","ROI ≥ 5 % — dünn",warn)}
    ${row("E","darunter oder Verlust",dng)}${comp}`;
}
/* Info-„i" überall antippbar machen — der reine Hover-Tooltip funktioniert am
   Handy nicht. Tippen öffnet die Erklärung als Fenster (Zweck + Rechenweg). */
document.addEventListener("click", e=>{ const i=e.target.closest && e.target.closest(".info-i"); if(!i) return;
  e.preventDefault(); e.stopPropagation(); const tip=i.getAttribute("data-tip"); if(tip) openInfoModal("Erklärung", `<p style="color:var(--text)">${escapeHtml(tip)}</p>`); });
function targetVK(ek,ship,combinedPct,goal,fpp){ fpp=fpp||0; const V=vatF(), k=1-V*combinedPct/100, denom=k-goal; if(denom<=0) return Infinity; let vk=((kuMode?0.54:0.42)+ek+ship+fpp)/denom; if(vk<=10) vk=((kuMode?0.45:0.35)+ek+ship+fpp)/denom; return vk; }
function minProtectVK(ek,ship,combinedPct){ return targetVK(ek,ship,combinedPct, BREAK_EVEN_MARGIN, 0); }

/* In Inventory übernehmen: überträgt die berechneten Werte direkt in die Inventory-Eingabemaske */
$("#c-inv").addEventListener("click",()=>{ calc();
  setTab("inventory");
  setInvForm(true);
  $("#iv-name").value = catLabel()+" Deal";
  $("#iv-ean").value = "";
  $("#iv-qty").value = "1";
  $("#iv-vk").value = (last.vk||0).toFixed(2).replace(".",",");
  $("#iv-ek").value = (last.ek||0).toFixed(2).replace(".",",");
  $("#iv-ship").value = (last.ship||0).toFixed(2).replace(".",",");
  $("#iv-cat").value = String(last.catP);
  $("#iv-ad").value = (last.adP||0).toLocaleString("de-DE");
  $("#iv-region").value = String(last.regionPct);
  window.scrollTo({top:0,behavior:"smooth"});
  showToast("✓ Werte ins Inventory übernommen – prüfen & speichern");
});
function addInventoryItem(d){ const now=new Date().toISOString(); inventory.unshift(Object.assign({id:"i"+Date.now(),date:now,touchedAt:now,feeVer:FEE_VER},d)); DB.saveInventory(inventory); }

/* ===================================================================
   v4.1 · WORKFLOW, RETOUREN, TRACKING, RECHERCHE — Helfer
   =================================================================== */
/* Workflow-Status eines Bestandsartikels: Bestellt → Unterwegs → Lager (→ Verkauf).
   'returned' = an Lieferant zurückgeschickt (eigene Retoure). */
const INV_STATUS = {
  ordered:  { de:"Bestellt",  en:"Ordered",   col:"#8b93a7", ring:"rgba(139,147,167,.5)" },
  transit:  { de:"Unterwegs", en:"In transit",col:"var(--brand)", ring:"color-mix(in srgb,var(--brand) 55%,transparent)" },
  stock:    { de:"Im Lager",  en:"In stock",  col:"var(--accent)", ring:"color-mix(in srgb,var(--accent) 55%,transparent)" },
  returned: { de:"Retoure",   en:"Returned",  col:"#f5a524", ring:"rgba(245,165,36,.55)" }
};
const invStatus = it => INV_STATUS[it && it.status] ? it.status : "stock";
const nextStatusOf = s => s==="ordered" ? "transit" : s==="transit" ? "stock" : "stock";
const isActiveStock = it => invStatus(it)!=="returned";

/* Sendungsverfolgung – nur Deep-Links, keine API. */
const CARRIERS = {
  dhl:   { label:"DHL",           url:n=>`https://www.dhl.de/de/privatkunden/pakete-empfangen/verfolgen.html?piececode=${encodeURIComponent(n)}` },
  hermes:{ label:"Hermes",        url:n=>`https://www.myhermes.de/empfangen/sendungsverfolgung/sendungsinformation/#${encodeURIComponent(n)}` },
  gls:   { label:"GLS",           url:n=>`https://gls-group.com/DE/de/paketverfolgung?match=${encodeURIComponent(n)}` },
  dpd:   { label:"DPD",           url:n=>`https://my.dpd.de/redirect.aspx?action=1&parcelno=${encodeURIComponent(n)}` },
  ups:   { label:"UPS",           url:n=>`https://www.ups.com/track?tracknum=${encodeURIComponent(n)}` },
  post:  { label:"Deutsche Post", url:n=>`https://www.deutschepost.de/sendung/simpleQuery.html?locale=de_DE&sendungsnummer=${encodeURIComponent(n)}` },
  dpd_at:{ label:"Österr. Post",  url:n=>`https://www.post.at/sv/sendungsdetails?snr=${encodeURIComponent(n)}` }
};
const carrierOptions = sel => `<option value="">— Dienst —</option>` + Object.entries(CARRIERS).map(([k,v])=>`<option value="${k}"${sel===k?" selected":""}>${v.label}</option>`).join("");
const trackUrl = (carrier,no) => (carrier && CARRIERS[carrier] && no && String(no).trim()) ? CARRIERS[carrier].url(String(no).trim()) : null;
function trackLinkHTML(carrier,no,labelPrefix){
  const u=trackUrl(carrier,no); if(!u) return "";
  return `<a href="${u}" target="_blank" rel="noopener noreferrer" class="inline-flex items-center gap-1.5 c-accent" style="font-size:12px;font-weight:600;text-decoration:none">
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="3" width="15" height="13" rx="2"/><path d="M16 8h4l3 3v5h-7z"/><circle cx="5.5" cy="18.5" r="2"/><circle cx="18.5" cy="18.5" r="2"/></svg>
    ${labelPrefix||"Sendung verfolgen"} · ${CARRIERS[carrier].label} ↗</a>`;
}

/* Rückgabefrist Lieferant: Farbe + Text je nach verbleibenden Tagen */
function deadlineInfo(iso){
  if(!iso) return null;
  const end=new Date(iso+"T23:59:59"); if(isNaN(end)) return null;
  const days=Math.ceil((end.getTime()-Date.now())/86400000);
  let col, urgent=false, txt;
  if(days<0){ col="var(--danger)"; urgent=true; txt=`Rückgabefrist abgelaufen (vor ${-days} T)`; }
  else if(days<=2){ col="var(--danger)"; urgent=true; txt=`Rückgabe: noch ${days} ${days===1?"Tag":"Tage"}`; }
  else if(days<=7){ col="var(--warn, #f5a524)"; txt=`Rückgabe: noch ${days} Tage`; }
  else { col="var(--accent)"; txt=`Rückgabe bis ${new Date(iso).toLocaleDateString("de-DE",{day:"numeric",month:"short"})}`; }
  return { days, col, urgent, txt };
}

/* Preis-Recherche – Deep-Links zu idealo, eBay (verkaufte Artikel) und Kaufland */
function researchLinks(name, ean){
  const q=encodeURIComponent((name||"").trim());
  const e=(ean||"").trim(), key=e?encodeURIComponent(e):q;
  return {
    idealo:   `https://www.idealo.de/preisvergleich/MainSearchProductCategory.html?q=${key}`,
    ebaySold: `https://www.ebay.de/sch/i.html?_nkw=${key}&LH_Sold=1&LH_Complete=1`,
    kaufland: `https://www.kaufland.de/item/search/?q=${key}`
  };
}
function researchHTML(name, ean){
  const L=researchLinks(name, ean);
  const a=(href,label)=>`<a href="${href}" target="_blank" rel="noopener noreferrer" class="btn-ghost" style="flex:1 1 0;min-width:0;padding:9px 8px;font-size:12px;font-weight:600;display:flex;align-items:center;justify-content:center;gap:5px">${label}<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M7 17 17 7M9 7h8v8"/></svg></a>`;
  return `<div><p class="label mb-1.5">Preis-Recherche</p><div class="flex gap-2">${a(L.idealo,"idealo")}${a(L.ebaySold,"eBay verkauft")}${a(L.kaufland,"Kaufland")}</div></div>`;
}
const parseTags = s => (s||"").split(",").map(t=>t.trim()).filter(Boolean).slice(0,12);
const tagsChipsHTML = tags => (tags&&tags.length) ? `<span class="inv-tags">${tags.map(t=>`<span class="tagchip">${escapeHtml(t)}</span>`).join("")}</span>` : "";

/* Direkt-Eingabe im Inventory (einklappbar + Bild-Upload + Bearbeiten) */
let invFormOpen=false, pendingInvImg=null, editingInvId=null;

/* ===== BILDER IN SUPABASE STORAGE =====
   Bilder lagen bisher als Base64 im JSON-Blob -> jeder Speichervorgang schrieb
   alle Bilder erneut mit. Jetzt: Datei landet im Storage-Bucket, im Datensatz
   steht nur noch die URL. Alte Base64-Bilder funktionieren weiter (Fallback),
   lassen sich aber über "Bilder auslagern" in der Auswertung migrieren. */
const IMG_BUCKET = "product-images";
const isDataUrl = s => typeof s === "string" && s.startsWith("data:");

async function uploadImage(dataUrl){
  if(!isDataUrl(dataUrl)) return dataUrl;                 // externe URL: unveraendert
  if(!currentUser || !currentUser.id) throw new Error("kein User aktiv");
  const blob = await (await fetch(dataUrl)).blob();
  const ext  = (blob.type && blob.type.includes("png")) ? "png" : "jpg";
  const path = `${currentUser.id}/${Date.now()}-${Math.random().toString(36).slice(2,8)}.${ext}`;
  const { error } = await sb.storage.from(IMG_BUCKET)
    .upload(path, blob, { contentType: blob.type || "image/jpeg", upsert:false });
  if(error) throw new Error(error.message);
  const { data } = sb.storage.from(IMG_BUCKET).getPublicUrl(path);
  if(!data || !data.publicUrl) throw new Error("keine öffentliche URL erhalten");
  return data.publicUrl;
}

/* Bild sichern: gelingt der Upload nicht, bleibt das Base64-Bild erhalten
   (lieber ein grosser Datensatz als ein verlorenes Bild). */
async function persistImage(src){
  if(!isDataUrl(src)) return src || null;
  try { return await uploadImage(src); }
  catch(e){
    console.warn("[img upload]", e.message);
    showToast("⚠ Bild-Upload fehlgeschlagen — Bild wird lokal gespeichert");
    return src;
  }
}
function resetInvForm(){ editingInvId=null; ["iv-name","iv-ean","iv-vk","iv-ek","iv-orderdate","iv-returnby","iv-tracking","iv-tags"].forEach(id=>$("#"+id).value=""); $("#iv-qty").value="1"; $("#iv-ship").value=shipDefStr(); $("#iv-ad").value="0"; $("#iv-cat").value="12"; $("#iv-region").value="0"; $("#iv-status").value="stock"; $("#iv-carrier").value=""; if($("#iv-noinputvat")) $("#iv-noinputvat").checked=false; if($("#iv-buyplatform")){ refreshBuyPlatSelect(); $("#iv-buyplatform").value=""; } if($("#iv-paymethod")){ refreshPaySelects(); $("#iv-paymethod").value=""; } resetInvImage(); $("#iv-add").textContent="Hinzufügen"; }
function setInvForm(open){ invFormOpen=open; $("#iv-form").classList.toggle("hidden",!open);
  $("#iv-toggle-ic").style.transform = open ? "rotate(45deg)" : "rotate(0deg)";
  $("#iv-toggle").querySelector("span").textContent = open ? t("ui.close") : t("inv.add");
  if(!open) resetInvForm(); }
$("#iv-toggle").addEventListener("click",()=>setInvForm(!invFormOpen));
$("#iv-cancel").addEventListener("click",()=>setInvForm(false));
$("#iv-drop").addEventListener("click",()=>$("#iv-img-input").click());
function setPendingInvImg(src){ pendingInvImg=src; $("#iv-drop").classList.add("has"); $("#iv-drop-empty").classList.add("hidden"); const p=$("#iv-drop-preview"); p.src=src; p.classList.remove("hidden"); }
$("#iv-img-input").addEventListener("change",e=>{ const f=e.target.files[0]; if(!f) return; readImageScaled(f,800,setPendingInvImg); });
["dragover","dragenter"].forEach(ev=>$("#iv-drop").addEventListener(ev,e=>{ e.preventDefault(); $("#iv-drop").style.borderColor="var(--accent)"; }));
["dragleave","dragend","drop"].forEach(ev=>$("#iv-drop").addEventListener(ev,e=>{ e.preventDefault(); $("#iv-drop").style.borderColor=""; }));
$("#iv-drop").addEventListener("drop",e=>{ const f=e.dataTransfer.files[0]; if(f&&f.type.startsWith("image/")) readImageScaled(f,800,setPendingInvImg); });
$("#iv-img-url-btn").addEventListener("click",e=>{ e.stopPropagation(); const u=$("#iv-img-url").value.trim(); if(u){ setPendingInvImg(u); $("#iv-img-url").value=""; showToast("✓ Bild geladen"); } });
$("#iv-img-url").addEventListener("keydown",e=>{ if(e.key==="Enter"){ e.preventDefault(); $("#iv-img-url-btn").click(); } });
function resetInvImage(){ pendingInvImg=null; $("#iv-drop").classList.remove("has"); $("#iv-drop-empty").classList.remove("hidden"); $("#iv-drop-preview").classList.add("hidden"); }
$("#iv-drop-x").addEventListener("click", e=>{ e.stopPropagation(); resetInvImage(); showToast("Bild entfernt"); });
/* iv-ekust entfernt: Vorsteuer läuft jetzt automatisch über die Profil-Steuerart (siehe ekVatRate);
   Ausnahme "kein Vorsteuerabzug" liegt als optionaler Schalter im Workflow-Block (#iv-noinputvat). */
$("#iv-add").addEventListener("click", async ()=>{
  const req=[["iv-name",v=>v.trim()!==""],["iv-vk",v=>v.trim()!==""],["iv-ek",v=>v.trim()!==""]]; let bad=false;
  req.forEach(([id,ok])=>{ const el=$("#"+id); if(!ok(el.value)){ flashError(el); bad=true; } });
  if(bad){ showToast("Bitte Pflichtfelder ausfüllen"); return; }
  const data={ name:$("#iv-name").value.trim(), ean:$("#iv-ean").value.trim(), qty:Math.max(1,parseInt($("#iv-qty").value)||1), vk:num($("#iv-vk").value), ek:num($("#iv-ek").value), ship:num($("#iv-ship").value), catPct:num($("#iv-cat").value), adPct:num($("#iv-ad").value), regionPct:num($("#iv-region").value), feeVer:FEE_VER, noInputVat:!!($("#iv-noinputvat")&&$("#iv-noinputvat").checked),
    status:$("#iv-status").value||"stock", orderDate:$("#iv-orderdate").value||"", returnBy:$("#iv-returnby").value||"", buyPlatformId:(($("#iv-buyplatform")&&$("#iv-buyplatform").value!=="__new__")?$("#iv-buyplatform").value:""), payMethodId:(($("#iv-paymethod")&&$("#iv-paymethod").value!=="__new__")?$("#iv-paymethod").value:""), buyCarrier:$("#iv-carrier").value||"", buyTracking:$("#iv-tracking").value.trim(), tags:parseTags($("#iv-tags").value) };

  const btn=$("#iv-add"); const label=btn.textContent;
  if(isDataUrl(pendingInvImg)){ btn.disabled=true; btn.textContent="Bild wird hochgeladen…"; }
  const imgSrc = await persistImage(pendingInvImg);
  btn.disabled=false; btn.textContent=label;

  if(editingInvId){
    const it=inventory.find(x=>x.id===editingInvId);
    if(it){ Object.assign(it,data); it.img = imgSrc || null; if(it.supReturn) it.status="returned"; }  // Lieferanten-Retoure nicht durch Bearbeiten aufheben
    DB.saveInventory(inventory); setInvForm(false); renderInventory(); showToast("✓ Artikel aktualisiert");
  } else {
    addInventoryItem(Object.assign({img:imgSrc||null}, data));
    setInvForm(false); renderInventory(); showToast("✓ Im Inventory gespeichert");
  }
});
$("#iv-qty").addEventListener("change",()=>{ if((parseInt($("#iv-qty").value)||1)<1) $("#iv-qty").value=1; });
/* Bestand -> Tracker: Verkaufs-Menü (Stückzahl, Datum, Preis, Porto anpassbar) */
function openAccountSetup(){
  $("#modal-root").innerHTML=`<div class="overlay" id="ov"><div class="modal">
    <div class="flex items-start justify-between gap-3 mb-1">
      <div><p class="font-bold text-[18px]">Ersteinrichtung</p><p class="c-sub text-[12.5px] mt-0.5">Ein paar Standardwerte, die Flipdeck sich für dich merkt — jederzeit im Profil-Tab änderbar.</p></div>
      <button id="as-skip" class="iconbtn" title="Später" aria-label="Schließen"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg></button>
    </div>
    <div class="my-4">
      <p class="label mb-2">Steuerstatus</p>
      <div class="seg" style="width:100%">
        <button type="button" id="as-ku" data-v="1" aria-selected="${kuMode?"true":"false"}" style="flex:1">Kleinunternehmer (§19 UStG)</button>
        <button type="button" id="as-reg" data-v="0" aria-selected="${kuMode?"false":"true"}" style="flex:1">Regelbesteuert</button>
      </div>
      <p class="c-sub text-[11.5px] mt-1.5">Bestimmt, ob eBay dir MwSt. auf Gebühren berechnet — und ob Verkaufspreise im Verkaufs-Dialog standardmäßig MwSt. enthalten.</p>
    </div>
    <div id="as-rate-wrap" class="mb-4${kuMode?" hidden":""}">
      <label class="label mb-2" for="as-rate">Standard-MwSt.-Satz</label>
      <select id="as-rate" class="field"><option value="19"${defaultUstRate===19?" selected":""}>19 % (Regelsteuersatz)</option><option value="7"${defaultUstRate===7?" selected":""}>7 % (Ermäßigt)</option><option value="0"${defaultUstRate===0?" selected":""}>0 % (Steuerbefreit)</option></select>
    </div>
    <div class="mb-4">
      <label class="label mb-2" for="as-platform">Standard-Verkaufsplattform</label>
      <select id="as-platform" class="field">${platformOptions(defaultPlatform)}</select>
      <p class="c-sub text-[11.5px] mt-1.5">Wird im Verkaufs-Dialog vorausgewählt — bei gebührenfreien Plattformen wird „Ohne Marktplatz-Gebühren" automatisch gesetzt.</p>
    </div>
    <button id="as-save" class="btn-accent w-full">Fertig ↗</button>
  </div></div>`;
  const syncKuButtons=on=>{ $("#as-ku").setAttribute("aria-selected",on?"true":"false"); $("#as-reg").setAttribute("aria-selected",on?"false":"true"); $("#as-rate-wrap").classList.toggle("hidden",on); };
  $("#as-ku").addEventListener("click",()=>syncKuButtons(true));
  $("#as-reg").addEventListener("click",()=>syncKuButtons(false));
  $("#as-skip").addEventListener("click",()=>{ DB.saveTaxCfg({ kuMode, defaultUstRate, defaultPlatform, onboarded:true }); Store.set(uKey("onboarded"),"1"); $("#modal-root").innerHTML=""; startTourIfNew(); });
  $("#as-save").addEventListener("click",()=>{
    kuMode = $("#as-ku").getAttribute("aria-selected")==="true";
    defaultUstRate = num($("#as-rate").value);
    defaultPlatform = $("#as-platform").value||"ebay";
    Store.set("fg_ku", kuMode?"1":"0");
    Store.set(uKey("ustrate"), String(defaultUstRate));
    Store.set(uKey("platform"), defaultPlatform);
    Store.set(uKey("onboarded"),"1");
    DB.saveTaxCfg({ kuMode, defaultUstRate, defaultPlatform, onboarded:true });
    calc(); renderInventory(); renderBreakEven();
    $("#modal-root").innerHTML=""; showToast("✓ Standardwerte gespeichert"); startTourIfNew();
  });
}
/* Effektiver Vorsteuer-Satz auf den EK eines Bestandsartikels:
   - Kleinunternehmer (kuMode): nie (kein Vorsteuerabzug)
   - Regelbesteuert + Ausnahme "kein Vorsteuerabzug" (it.noInputVat): voller EK
   - sonst Regelbesteuert: Standard-MwSt-Satz aus dem Profil wird herausgerechnet */
function ekVatRate(it){ if(kuMode) return 0; if(it && it.noInputVat) return 0; return num(defaultUstRate)||0; }
function openSellModal(id){ const it=inventory.find(x=>x.id===id); if(!it) return;
  const maxQty=Math.max(1,it.qty);
  const opts=Array.from({length:maxQty},(_,i)=>`<option value="${i+1}">${i+1} ${maxQty===1?"Stück":"Stück"}</option>`).join("");
  const initPlat = getEnabledPlatforms().includes(defaultPlatform) ? defaultPlatform : getEnabledPlatforms()[0];
  $("#modal-root").innerHTML=`<div class="overlay" id="ov"><div class="modal modal-sell">
    <div class="ms-head">
      <span class="thumb">${it.img?`<img src="${attrEsc(it.img)}" style="width:100%;height:100%;object-fit:cover">`:dealIconSVG}</span>
      <div class="ms-head-txt">
        <div class="ms-head-title">${escapeHtml(it.name)}</div>
        <div class="ms-head-sub">Als Verkauf in den Tracker übernehmen · ${maxQty} im Bestand</div>
      </div>
      <button id="sell-x" class="iconbtn" title="Schließen" aria-label="Schließen"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg></button>
    </div>
    <div class="ms-body">
      <div class="ms-sec" style="margin-top:2px"><span class="ms-sec-dot"></span><span class="ms-sec-t">Verkauf</span><span class="ms-sec-line"></span></div>
      <div class="grid grid-cols-2 gap-3">
        <div><label class="label" for="sell-qty">Stückzahl</label><select id="sell-qty" class="field">${opts}</select></div>
        <div><label class="label" for="sell-date">Verkaufsdatum</label><input id="sell-date" class="field" type="date" value="${todayISOInput()}"></div>
        <div><label class="label" for="sell-vk">Verkaufspreis € / Stück</label><input id="sell-vk" class="field tnum" inputmode="decimal" value="${String(it.vk).replace('.',',')}"></div>
        <div><label class="label" for="sell-ship">Porto € (Bestellung) <span class="info-i" data-tip="Porto fällt nur EINMAL pro Bestellung an – auch bei Mehrfachkauf. Nicht pro Stück eingeben.">i</span></label><input id="sell-ship" class="field tnum" inputmode="decimal" value="${String(it.ship).replace('.',',')}"></div>
      </div>

      <div class="ms-sec"><span class="ms-sec-dot"></span><span class="ms-sec-t">Marktplatz</span><span class="ms-sec-line"></span></div>
      <label class="label" for="sell-platform-btn">Verkauft auf</label>
      <div class="plat-dd">
        <input type="hidden" id="sell-platform" value="${initPlat}">
        <button type="button" class="plat-trigger" id="sell-platform-btn" aria-haspopup="listbox" aria-expanded="false">${platformTriggerInner(initPlat)}</button>
      </div>
      <div class="plat-note${PLATFORMS[initPlat].hasFees?"":" free"}" id="plat-note"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 8h.01M11 12h1v4h1"/></svg><span class="plat-note-t"></span></div>

      <div id="sell-ad-section">
        <div class="ms-sec"><span class="ms-sec-dot"></span><span class="ms-sec-t">Gebühren &amp; Werbung</span><span class="ms-sec-line"></span></div>
        <div class="flex items-center justify-between mb-1.5">
          <label class="label" for="sell-ad" style="margin:0">Bewerben % <span class="info-i" data-tip="Tatsächlich angefallene Werbe-Gebühr für DIESEN Verkauf. Eine geschaltete Promo wird nicht immer fällig – hier auf den real fälligen Wert anpassen oder auf 0 setzen.">i</span></label>
          <span class="c-sub text-[11px]">geplant: ${String(it.adPct).replace('.',',')} %${it.adPct>0?` · <button type="button" id="sell-ad-zero" style="background:none;border:0;cursor:pointer;color:var(--brand);font-weight:600;font-size:11px;padding:0">auf 0 setzen</button>`:""}</span>
        </div>
        <input id="sell-ad" class="field tnum" inputmode="decimal" value="${String(it.adPct).replace('.',',')}">
      </div>
      <div id="sell-kaufland" class="hidden">
        <div class="ms-sec"><span class="ms-sec-dot"></span><span class="ms-sec-t">Kaufland-Gebühren</span><span class="ms-sec-line"></span></div>
        <label class="label" for="sell-k-cat">Kaufland-Kategorie &amp; Zielland</label>
        <select id="sell-k-cat" class="field" style="margin-bottom:8px"></select>
        <div class="calc-switch" id="sell-k-region" role="tablist" style="grid-template-columns:1fr 1fr">
          <button type="button" data-region="de" role="tab" aria-selected="true">DE &amp; West-EU</button>
          <button type="button" data-region="pl" role="tab" aria-selected="false">Polen (PL)</button>
        </div>
        <p class="c-sub text-[11px] mt-1.5">Bestimmt die Verkaufsprovision für diesen Verkauf. „Bewerben %" kommt on top.</p>
      </div>
      <div id="sell-ebp" class="hidden">
        <div class="ms-sec"><span class="ms-sec-dot"></span><span class="ms-sec-t">eBay-Gebühr (Privatverkäufer)</span><span class="ms-sec-line"></span></div>
        <div class="calc-switch" id="sell-ebp-region" role="tablist" style="grid-template-columns:1fr 1fr">
          <button type="button" data-intl="0" role="tab" aria-selected="true">Innerhalb Deutschlands</button>
          <button type="button" data-intl="1" role="tab" aria-selected="false">Ins Ausland · 5 %</button>
        </div>
        <p class="c-sub text-[11px] mt-1.5">Privatverkäufer zahlen innerdeutsch <b>keine</b> Gebühr. Bei Lieferadresse im Ausland zieht eBay <b>5 %</b> auf (Artikel + Porto) ab.</p>
      </div>

      <div id="sell-private-fields">
        <div class="ms-sec"><span class="ms-sec-dot"></span><span class="ms-sec-t">Versand &amp; Zahlung</span><span class="ms-sec-line"></span></div>
        <div class="grid grid-cols-2 gap-3">
          <div><label class="label" for="sell-carrier">Versand (Verkauf)</label><select id="sell-carrier" class="field">${carrierOptions("")}</select></div>
          <div><label class="label" for="sell-tracking">Sendungsnr.</label><input id="sell-tracking" class="field" placeholder="optional"></div>
        </div>
        <div class="mt-3"><label class="label" for="sell-paymethod">Erhalten auf <span class="c-sub" style="font-weight:400">(Zahlungsmethode, optional)</span></label><select id="sell-paymethod" class="field">${payOptions("",true)}</select></div>
      </div>

      <div class="ms-sec"><span class="ms-sec-dot"></span><span class="ms-sec-t">Preis-Recherche</span><span class="ms-sec-line"></span></div>
      ${researchHTML(it.name,it.ean)}
      ${kuMode?"":`<p class="c-sub text-[11.5px] mt-3">Regelbesteuert: ${String(defaultUstRate).replace(".",",")} % MwSt. werden aus dem Verkaufspreis herausgerechnet (Kontoeinstellung).</p>`}

      <div class="ms-sec"><span class="ms-sec-dot"></span><span class="ms-sec-t">Optionen</span><span class="ms-sec-line"></span></div>
      <label class="opt-row"><input id="sell-pack" type="checkbox" checked><span><span class="opt-t">Verpackungs-Pauschale 1 €</span><span class="opt-s">Karton, Klebeband &amp; Co. — einmal pro Bestellung abgezogen</span></span></label>

      <div class="ms-profit">
        <div class="ms-profit-top"><span class="label" style="margin:0">Gewinn gesamt</span><span id="sell-profit" class="ms-profit-val c-accent">0,00 €</span></div>
        <p id="sell-sub" class="c-sub text-[11.5px] mt-1.5">—</p>
      </div>
    </div>
    <div class="ms-foot"><button id="sell-cancel" class="btn-ghost">Abbrechen</button><button id="sell-confirm" class="btn-accent">Verkauf eintragen ↗</button></div>
  </div></div>`;
  /* Fix-Gebühr (transFee) fällt bei eBay NUR EINMAL pro Bestellung an, nicht pro Stück –
     deshalb hier auf den Gesamt-Verkaufswert (vk*q) rechnen statt den Pro-Stück-Wert mit q zu multiplizieren.
     Ist "Verkaufspreis enthält USt" aktiv, wird die USt vor der Gewinnrechnung herausgerechnet –
     sie ist eine Steuerschuld ans Finanzamt, kein eigener Ertrag. */
  const _ekR = ekVatRate(it); const ekNet = _ekR ? it.ek/(1+_ekR/100) : it.ek;
  let sellKRegion = klRegion;   // DE-Zone / PL für Kaufland-Verkäufe in diesem Dialog
  let sellEbpIntl = false;      // eBay-Privat: Verkauf ins Ausland (5 %)?
  const calcSale=(q,vk,shipTot,noFee,pack,adPct,ustRate)=>{
    const plat=$("#sell-platform").value;
    const V=vatF();
    const vkNet = ustRate ? vk/(1+ustRate/100) : vk;
    const ustPerUnit = vk - vkNet;
    let feesTotal;
    if(noFee){ feesTotal=0; }
    else if(PLATFORMS[plat] && PLATFORMS[plat].ebayPrivate){
      feesTotal = sellEbpIntl ? (vkNet*q + shipTot)*0.05 : 0;   // Privat: innerdeutsch 0 €, Ausland 5 % auf (Artikel + Porto)
    }
    else if(plat==="kaufland"){
      const kc=$("#sell-k-cat"); const cat=KAUFLAND_CATS[(kc?parseInt(kc.value):0)||0]||KAUFLAND_CATS[0];
      const p=kauflandPct(cat, sellKRegion==="pl");   // Kaufland kennt kein eBay-artiges „Bewerben %"
      feesTotal = (vkNet*q*p/100 + (cat.fixed||0)*q) * V;   // Provision + Medien-Zuschlag je Artikel
    } else {
      const combined=it.catPct+adPct+it.regionPct;
      feesTotal = transFee(vkNet) + vkNet*q*combined/100*V;
    }
    const payoutTotal = vkNet*q - feesTotal;
    const payoutPer = q>0 ? payoutTotal/q : payoutTotal;
    const ustTotal = ustPerUnit*q;
    const tot = payoutTotal - ekNet*q - shipTot - (pack?1:0);
    const margin = (vkNet*q)>0 ? tot/(vkNet*q)*100 : 0;
    return { payoutPer, payoutTotal, tot, margin, ustTotal };
  };
  /* Gebühren fallen an, wenn der gewählte Marktplatz sie hat (kein Haken mehr –
     der Marktplatz entscheidet). Porto wird NICHT mehr automatisch auf 0 gesetzt. */
  const updatePlatNote=()=>{ const plat=$("#sell-platform").value; const v=PLATFORMS[plat]||PLATFORMS.ebay; const noFee=!v.hasFees; const note=$("#plat-note"); if(!note) return;
    note.className="plat-note"+(noFee||v.ebayPrivate?" free":""); const t=note.querySelector(".plat-note-t");
    if(t) t.textContent = v.ebayPrivate ? "Privatverkauf: innerdeutsch gebührenfrei, ins Ausland 5 % (Artikel + Porto)." : (noFee ? "Gebührenfrei — es werden keine Marktplatz-Gebühren abgezogen." : "Marktplatz-Gebühren werden automatisch berücksichtigt."); };
  const recompute=()=>{ const q=parseInt($("#sell-qty").value)||1, vk=num($("#sell-vk").value), shipTot=num($("#sell-ship").value);
    const noFee=!PLATFORMS[$("#sell-platform").value].hasFees, pack=$("#sell-pack")&&$("#sell-pack").checked;
    const adPct=num($("#sell-ad").value);
    const ustRate = kuMode ? 0 : defaultUstRate;
    const {payoutTotal,tot,margin,ustTotal}=calcSale(q,vk,shipTot,noFee,pack,adPct,ustRate);
    $("#sell-profit").textContent=(tot>=0?"+":"")+eur(tot); $("#sell-profit").style.color=tot>=0?"var(--accent)":"var(--danger)";
    $("#sell-sub").textContent=`${noFee?"Ohne Gebühren · ":""}Auszahlung gesamt ${eur(payoutTotal)} · EK ${eur(it.ek)}/Stk${_ekR?` (netto ${eur(ekNet)})`:""} · Porto ${eur(shipTot)}${pack?" · +1€ Verpackung":""} · Marge ${pct(margin)}${ustTotal>0?` · davon ${eur(ustTotal)} USt ans Finanzamt`:""}`; };
  /* Felder je Marktplatz: Versand/Sendungsnr./Zahlungsmethode nur bei gebührenfreien
     (privaten) Verkäufen; Kaufland-Kategorie nur bei Kaufland. */
  const fillSellKCat=()=>{ const sel=$("#sell-k-cat"); if(!sel) return; const cur=sel.value||"0"; const isPL=sellKRegion==="pl";
    sel.innerHTML=KAUFLAND_CATS.map((c,i)=>`<option value="${i}">${escapeHtml(c.label)} · ${kauflandPct(c,isPL)} %${c.fixed?" + "+eur(c.fixed):""}</option>`).join(""); sel.value=cur; };
  const updateSellFields=()=>{ const plat=$("#sell-platform").value; const v=PLATFORMS[plat]||PLATFORMS.ebay; const isEbp=!!v.ebayPrivate;
    const pf=$("#sell-private-fields"); if(pf) pf.classList.toggle("hidden", !!v.hasFees);
    const kp=$("#sell-kaufland"); if(kp) kp.classList.toggle("hidden", plat!=="kaufland");
    const ebp=$("#sell-ebp"); if(ebp) ebp.classList.toggle("hidden", !isEbp);
    const ads=$("#sell-ad-section"); if(ads) ads.classList.toggle("hidden", plat==="kaufland" || isEbp); };
  fillSellKCat();
  $$("#sell-k-region button").forEach(x=>x.setAttribute("aria-selected", x.dataset.region===sellKRegion));
  if($("#sell-k-cat")) $("#sell-k-cat").addEventListener("change",recompute);
  $$("#sell-k-region button").forEach(b=>b.addEventListener("click",()=>{ sellKRegion=b.dataset.region==="pl"?"pl":"de"; $$("#sell-k-region button").forEach(x=>x.setAttribute("aria-selected", x.dataset.region===sellKRegion)); fillSellKCat(); recompute(); }));
  $$("#sell-ebp-region button").forEach(b=>b.addEventListener("click",()=>{ sellEbpIntl=b.dataset.intl==="1"; $$("#sell-ebp-region button").forEach(x=>x.setAttribute("aria-selected", (x.dataset.intl==="1")===sellEbpIntl)); recompute(); }));
  ["sell-qty","sell-vk","sell-ship","sell-ad"].forEach(x=>$("#"+x).addEventListener("input",recompute));
  if($("#sell-ad-zero")) $("#sell-ad-zero").addEventListener("click",()=>{ $("#sell-ad").value="0"; recompute(); });
  $("#sell-pack").addEventListener("change",recompute);
  $("#sell-platform").addEventListener("change",()=>{ updatePlatNote(); updateSellFields(); recompute(); });
  attachPlatformDropdown();
  updatePlatNote(); updateSellFields(); recompute();
  attachShipDropdown($("#sell-ship"));   // Versand-Vorlagen auch im Verkauf-Dialog
  /* Kein Schließen bei Klick außerhalb: verhindert versehentliches Zuklappen beim Markieren von Zahlen. Nur „Abbrechen“ / „X“ schließt. */
  $("#sell-cancel").addEventListener("click",()=>$("#modal-root").innerHTML="");
  if($("#sell-x")) $("#sell-x").addEventListener("click",()=>$("#modal-root").innerHTML="");
  $("#sell-confirm").addEventListener("click",()=>{
    const q=Math.min(maxQty,parseInt($("#sell-qty").value)||1), vk=num($("#sell-vk").value), shipTot=num($("#sell-ship").value);
    const noFee=!PLATFORMS[$("#sell-platform").value].hasFees, pack=$("#sell-pack")&&$("#sell-pack").checked;
    const adPct=num($("#sell-ad").value);
    const ustRate = kuMode ? 0 : defaultUstRate;
    const {payoutPer}=calcSale(q,vk,shipTot,noFee,pack,adPct,ustRate);
    const shipPer = (shipTot + (pack?1:0))/q;
    const dateVal=$("#sell-date").value||todayISOInput();
    const platform=$("#sell-platform").value||"ebay";
    flips.unshift({ id:"f"+Date.now(), invId:it.id, name:it.name, ean:it.ean||"", qty:q, ek:it.ek, payout:payoutPer, ship:shipPer, date:new Date(dateVal+"T12:00:00").toISOString(), img:it.img||null, carrier:($("#sell-carrier")?$("#sell-carrier").value:"")||"", tracking:($("#sell-tracking")?$("#sell-tracking").value.trim():""), payMethodId:($("#sell-paymethod")?$("#sell-paymethod").value:""), platform, ustRate });
    DB.saveFlips(flips);
    it.qty-=q; it.touchedAt=new Date().toISOString(); if(it.qty<=0) inventory=inventory.filter(x=>x.id!==it.id);
    DB.saveInventory(inventory);
    $("#modal-root").innerHTML=""; renderInventory(); renderTrackerList(); renderDashboard();
    showToast(`✓ ${q}× „${it.name}" als Verkauf eingetragen`);
  });
}
function openInvEdit(id){ const it=inventory.find(x=>x.id===id); if(!it) return; editingInvId=id; $("#iv-name").value=it.name; $("#iv-ean").value=it.ean||""; $("#iv-qty").value=it.qty; $("#iv-vk").value=String(it.vk).replace(".",","); $("#iv-ek").value=String(it.ek).replace(".",","); $("#iv-ship").value=String(it.ship).replace(".",","); $("#iv-cat").value=String(it.catPct); $("#iv-ad").value=String(it.adPct).replace(".",","); $("#iv-region").value=String(it.regionPct);
  if($("#iv-noinputvat")) $("#iv-noinputvat").checked=!!it.noInputVat;
  $("#iv-status").value = invStatus(it)==="returned" ? "stock" : invStatus(it);
  $("#iv-orderdate").value = it.orderDate||""; $("#iv-returnby").value = it.returnBy||"";
  refreshBuyPlatSelect(); if($("#iv-buyplatform")) $("#iv-buyplatform").value = (it.buyPlatformId && buyPlatformById(it.buyPlatformId)) ? it.buyPlatformId : "";
  refreshPaySelects(); if($("#iv-paymethod")) $("#iv-paymethod").value = (it.payMethodId && payMethodById(it.payMethodId)) ? it.payMethodId : "";
  $("#iv-carrier").value = it.buyCarrier||""; $("#iv-tracking").value = it.buyTracking||"";
  $("#iv-tags").value = (it.tags||[]).join(", ");
  // Der Workflow-Block ist normal zugeklappt. Hat der Artikel dort aber Daten,
  // klappt er beim Bearbeiten auf – sonst uebersieht man sie und loescht sie versehentlich.
  const _more=document.querySelector(".iv-more");
  if(_more) _more.open = !!(it.orderDate||it.returnBy||it.buyCarrier||it.buyTracking||(it.tags&&it.tags.length)||(invStatus(it)!=="stock")||it.noInputVat);
  pendingInvImg=it.img||null;
  if(it.img){ $("#iv-drop").classList.add("has"); $("#iv-drop-empty").classList.add("hidden"); $("#iv-drop-preview").src=it.img; $("#iv-drop-preview").classList.remove("hidden"); } else resetInvImage();
  $("#iv-add").textContent="Änderungen speichern";
  invFormOpen=true; $("#iv-form").classList.remove("hidden"); $("#iv-toggle-ic").style.transform="rotate(45deg)"; $("#iv-toggle").querySelector("span").textContent=t("ui.close");
  window.scrollTo({top:0,behavior:"smooth"}); }

function renderInventory(){ const list=$("#inv-list"); applyFeatCfg(); scheduleCalFeedSync();
  const goal=targetMargin(), goalPct=goal*100;

  /* 1) Kennzahlen nur über AKTIVEN Bestand (Lieferanten-Retouren zählen nicht) */
  let units=0,cap=0,prof=0;
  const rows = inventory.map(it=>{
    const combined=it.catPct+it.adPct+it.regionPct;
    const ev=mpEval(defaultPlatform,it.vk,it.ek,it.ship,it);   // Deal-Score folgt dem Standard-Marktplatz des Kontos
    const minVK=minProtectVK(it.ek,it.ship,combined), tgtVK=targetVK(it.ek,it.ship,combined,goal,0);
    const ageDays=Math.floor((Date.now()-new Date(it.touchedAt||it.date||Date.now()).getTime())/86400000);
    const st=invStatus(it);
    if(st!=="returned"){ units+=it.qty; cap+=it.ek*it.qty; prof+=ev.profit*it.qty; }
    return { it, st, combined, ev, minVK, tgtVK, ageDays,
      healthy:ev.margin>=goalPct, loss:ev.profit<0,
      dl:(st!=="returned"?deadlineInfo(it.returnBy):null),
      dsort:new Date(it.date||it.touchedAt||0).getTime() };
  });
  $("#inv-kpi-units").textContent=units; $("#inv-kpi-cap").textContent=eur(cap);
  const pe=$("#inv-kpi-prof"); pe.textContent=eur(prof); pe.style.color=prof>=0?"var(--accent)":"var(--danger)";
  const roiEl=$("#inv-kpi-roi"); if(roiEl){ const roi=cap>0?prof/cap*100:0; roiEl.textContent=pct(roi); roiEl.style.color=roi>=0?"var(--accent)":"var(--danger)"; }

  $("#inv-empty").classList.toggle("hidden", inventory.length>0);

  const mig=feeMigrationList();
  const mb=$("#fee-migrate-banner");
  if(mb){ mb.classList.toggle("hidden", mig.length===0); const mc=$("#fee-migrate-count"); if(mc) mc.textContent=String(mig.length); }

  /* Filter-Chips synchronisieren + Bulk-Bar */
  $$("#inv-filterbar .seg-btn").forEach(b=>b.classList.toggle("is-active", b.dataset.filter===invFilter));
  $("#inv-bulkbar").classList.toggle("hidden", !bulkMode);
  const btgl=$("#inv-bulk-toggle"); if(btgl) btgl.classList.toggle("is-active", bulkMode);
  if($("#inv-bulk-count")) $("#inv-bulk-count").textContent = `${bulkSel.size} gewählt`;

  /* 2) Status-Filter + Suche (Name, EAN, Tags) */
  const q=invQuery.trim().toLowerCase();
  let view = rows.filter(r=>{
    const st=r.st;
    if(invFilter==="active"   && st==="returned") return false;
    if(invFilter==="active"   && getFeatCfg().intake && (st==="ordered"||st==="transit")) return false; // Wareneingang: erst zeigen, wenn angekommen
    if(invFilter==="ordered"  && st!=="ordered")  return false;
    if(invFilter==="transit"  && st!=="transit")  return false;
    if(invFilter==="returned" && st!=="returned") return false;
    if(q){ const hay=(r.it.name+" "+(r.it.ean||"")+" "+((r.it.tags||[]).join(" "))).toLowerCase(); if(!hay.includes(q)) return false; }
    return true;
  });

  const sorters={
    recent:(a,b)=> b.dsort-a.dsort,
    profit:(a,b)=> b.ev.profit-a.ev.profit,
    risk:(a,b)=> (a.loss!==b.loss ? (a.loss?-1:1) : a.ev.margin-b.ev.margin),
    stale:(a,b)=> b.ageDays-a.ageDays,
    name:(a,b)=> a.it.name.localeCompare(b.it.name,"de")
  };
  view.sort(sorters[invSort]||sorters.recent);

  $("#inv-count").textContent = `${view.length} / ${inventory.length}`;
  $("#inv-noresult").classList.toggle("hidden", !(inventory.length>0 && view.length===0));

  /* 3) Karten rendern */
  list.innerHTML="";
  const placeholder=`<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="var(--sub)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="4"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>`;
  view.forEach(r=>{ const {it,st,combined,ev,minVK,tgtVK,ageDays,healthy,loss,dl}=r;
    const open=invExpanded.has(it.id), selected=bulkSel.has(it.id);
    const stMeta=INV_STATUS[st], canAdv=(st==="ordered"||st==="transit");
    const wfBadge=`<button type="button" class="pill inv-status" data-id="${it.id}" ${canAdv?'title="Klick: nächster Status"':''} style="border:1px solid ${stMeta.ring};color:${stMeta.col};background:color-mix(in srgb,${stMeta.col} 13%,transparent);${canAdv?'cursor:pointer':'cursor:default'}">${lang==="en"?stMeta.en:stMeta.de}${canAdv?' →':''}</button>`;
    // „Gesund" ist der Normalzustand -> kein Pill (weniger Rauschen). Nur Probleme werden markiert.
    const healthPill = st==="returned" ? "" : (loss ? `<span class="pill pill-warn">⚠ ${lang==="en"?"Loss":"Verlust"}</span>` : (!healthy ? `<span class="pill pill-warn">⚠ ${lang==="en"?"Below target":"Unter Ziel"}</span>` : ""));
    const _ds = st==="returned" ? null : dealGrade(ev.profit, it.ek);
    const scorePill = _ds ? `<button type="button" class="pill deal-pill" data-roi="${_ds.roi}" data-grade="${_ds.g}" data-col="${attrEsc(_ds.col)}" data-vk="${it.vk}" data-ek="${it.ek}" data-ship="${it.ship}" data-comb="${it.catPct+it.adPct+it.regionPct}" data-cat="${it.catPct}" style="border:1px solid color-mix(in srgb,${_ds.col} 45%,var(--line));color:${_ds.col};background:color-mix(in srgb,${_ds.col} 12%,transparent);font-weight:800;cursor:pointer;display:inline-flex;align-items:center;gap:5px" title="Antippen: So wird der Deal-Score berechnet">◆ Deal ${_ds.g}<span style="opacity:.75;font-weight:600">ⓘ</span></button>` : "";
    const stalePill = st==="returned" ? "" : (ageDays>=staleDays*2 ? `<span class="pill pill-stale-red">⏳ ${ageDays} T</span>` : (ageDays>=staleDays ? `<span class="pill pill-stale">⏳ ${ageDays} T</span>` : ""));
    const floorPill = st==="returned" ? "" : `<span class="pill pill-floor" title="${lang==="en"?"Floor price – never sell below":"Mindest-VK – niemals darunter verkaufen"}"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg><span class="pf-label">${lang==="en"?"Floor":"Min-VK"}</span> ${minVK===Infinity?"—":eur(minVK)}</span>`;
    const dlPill = dl ? `<span class="pill" style="border:1px solid color-mix(in srgb,${dl.col} 40%,var(--line));color:${dl.col};background:color-mix(in srgb,${dl.col} 12%,transparent)">${dl.urgent?'⏰ ':''}${dl.txt}</span>` : "";
    const refundPill = (st==="returned"&&it.supReturn) ? `<span class="pill" style="border:1px solid ${it.supReturn.refund==='refunded'?'color-mix(in srgb,var(--accent) 40%,var(--line))':'color-mix(in srgb,#f5a524 45%,var(--line))'};color:${it.supReturn.refund==='refunded'?'var(--accent)':'#f5a524'}">${it.supReturn.refund==='refunded'?'✓ erstattet':'⏳ Erstattung offen'}</span>` : "";
    const pCol = ev.profit>=0?"var(--accent)":"var(--danger)";

    const sellArea = st==="returned"
      ? `<div class="rounded-[15px] p-3.5" style="background:var(--cell-2);border:1px solid var(--line)">
           <div class="flex items-center justify-between gap-2">
             <div class="min-w-0"><p class="text-[13px] font-semibold">Lieferanten-Retoure</p><p class="c-sub text-[11.5px] mt-0.5">Erstattung ${eur((it.supReturn&&it.supReturn.amount)||it.ek*it.qty)}${it.supReturn&&it.supReturn.date?` · ${new Date(it.supReturn.date).toLocaleDateString("de-DE")}`:""}</p></div>
             <button class="btn-ghost inv-refund" data-id="${it.id}" style="flex:0 0 auto;padding:8px 12px;font-size:12.5px;${it.supReturn&&it.supReturn.refund==='refunded'?'color:var(--accent)':''}">${it.supReturn&&it.supReturn.refund==='refunded'?'✓ Erstattet':'Erstattet ✓'}</button>
           </div>
           <button class="btn-ghost inv-unreturn" data-id="${it.id}" style="width:100%;margin-top:10px;font-size:12.5px">Retoure rückgängig → zurück ins Lager</button>
         </div>`
      : `<button class="btn-accent inv-sell" data-id="${it.id}" style="width:100%;display:flex;align-items:center;justify-content:center;gap:8px"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>${lang==="en"?"Mark as sold → Tracker":"Als Verkauf an Tracker"}</button>
         <button class="btn-ghost inv-supreturn" data-id="${it.id}" style="width:100%;margin-top:10px;display:flex;align-items:center;justify-content:center;gap:7px;font-size:13px"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10H9"/></svg>An Lieferant zurücksenden</button>`;

    const el=document.createElement("article");
    el.className="inv-card"+(open?" open":"")+(st!=="returned"&&ageDays>=staleDays*2?" alert":"")+(selected?" selected":"");
    el.innerHTML=`
      ${bulkMode?`<label class="inv-bulk"><input type="checkbox" class="inv-check" data-id="${it.id}" ${selected?"checked":""}></label>`:""}
      <div class="inv-head" role="button" tabindex="0" data-toggle="${it.id}" aria-expanded="${open}" ${bulkMode?'style="padding-left:46px"':''}>
        <span class="inv-thumb">${ it.img?`<img src="${attrEsc(it.img)}" alt="">`:placeholder }</span>
        <span class="inv-main">
          <span class="inv-pills">${wfBadge}${scorePill}${healthPill}${floorPill}${dlPill}${refundPill}${stalePill}</span>
          <span class="inv-title">${escapeHtml(it.name)}</span>
          <span class="inv-meta">${it.qty} ${lang==="en"?"pcs":"Stk"} · VK ${eur(it.vk)} · EK ${eur(it.ek)}${it.ean?` · ${escapeHtml(it.ean)}`:""}</span>
          ${tagsChipsHTML(it.tags)}
          <span class="inv-hero">
            <span><span class="inv-hero-label">${lang==="en"?"Profit / unit":"Profit / Stück"}</span><span class="inv-hero-val" style="color:${pCol}">${ev.profit>=0?"+":""}${eur(ev.profit)}<span class="c-sub" style="font-size:12px;font-weight:600;margin-left:6px">${pct(ev.margin)}</span></span></span>
            <svg class="inv-chev" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
          </span>
        </span>
      </div>
      <div class="inv-body" ${open?"":"hidden"}>
        <div class="inv-body-inner">
          <div class="grid grid-cols-2 gap-3 mb-3">
            <div class="rounded-[15px] p-3" style="background:var(--danger-soft);border:1px solid var(--line)"><div class="flex items-center gap-1.5 mb-1"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--danger)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg><span class="text-[10px] font-semibold uppercase tracking-wider c-danger">${lang==="en"?"Do not sell below":"Nicht unter"}</span></div><p class="mono font-bold text-[19px] c-danger">${minVK===Infinity?"—":eur(minVK)}</p><p class="c-sub text-[10.5px] mt-0.5">${lang==="en"?"break-even + 5% margin":"Break-Even + 5 % Marge"}</p></div>
            <div class="rounded-[15px] p-3" style="background:var(--accent-soft);border:1px solid var(--line)"><div class="flex items-center gap-1.5 mb-1"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="m9 12 2 2 4-4"/></svg><span class="text-[10px] font-semibold uppercase tracking-wider c-accent">${lang==="en"?"Target":"Ziel-VK"} · ${pct(goalPct)}</span></div><p class="mono font-bold text-[19px] c-accent">${tgtVK===Infinity?"—":eur(tgtVK)}</p><p class="c-sub text-[10.5px] mt-0.5">${lang==="en"?"fixed target margin":"feste Zielmarge"}</p></div>
          </div>
          <p class="c-sub text-[11.5px] mono mb-3">${lang==="en"?"Ship":"Versand"} ${eur(it.ship)} · ${lang==="en"?"Fees":"Gebühren"} ${combined.toLocaleString("de-DE")} % · ${lang==="en"?"Capital":"Kapital"} ${eur(it.ek*it.qty)}${it.orderDate?` · Bestellt ${new Date(it.orderDate).toLocaleDateString("de-DE")}`:""}</p>
          ${ trackUrl(it.buyCarrier,it.buyTracking) ? `<div class="mb-3">${trackLinkHTML(it.buyCarrier,it.buyTracking,"Einkauf verfolgen")}</div>` : "" }
          <div class="mb-3">${researchHTML(it.name,it.ean)}</div>
          ${salesHistoryHTML(it)}
          ${sellArea}
          <div class="grid grid-cols-2 gap-3 mt-3"><button class="btn-ghost inv-edit" data-id="${it.id}" style="display:flex;align-items:center;justify-content:center;gap:7px">${icoEdit}${lang==="en"?"Edit":"Bearbeiten"}</button><button class="btn-ghost inv-del" data-id="${it.id}" style="display:flex;align-items:center;justify-content:center;gap:7px;color:var(--danger)">${icoTrash}${lang==="en"?"Delete":"Löschen"}</button></div>
        </div>
      </div>`;
    list.appendChild(el);
  });

  /* 4) Events */
  $$("#inv-list .inv-bulk").forEach(l=>l.addEventListener("click",e=>e.stopPropagation()));
  $$("#inv-list .inv-check").forEach(c=>c.addEventListener("change",e=>{ e.stopPropagation(); const id=c.dataset.id;
    if(c.checked) bulkSel.add(id); else bulkSel.delete(id);
    c.closest(".inv-card").classList.toggle("selected",c.checked);
    if($("#inv-bulk-count")) $("#inv-bulk-count").textContent=`${bulkSel.size} gewählt`; }));
  const toggleHead=b=>{
    const id=b.dataset.toggle;
    if(invExpanded.has(id)) invExpanded.delete(id); else invExpanded.add(id);
    const card=b.closest(".inv-card"), body=card.querySelector(".inv-body");
    const nowOpen=invExpanded.has(id);
    card.classList.toggle("open",nowOpen); b.setAttribute("aria-expanded",nowOpen);
    body.hidden=!nowOpen;
  };
  $$("#inv-list .inv-head").forEach(b=>{
    b.addEventListener("click",()=>toggleHead(b));
    b.addEventListener("keydown",e=>{ if(e.key==="Enter"||e.key===" "){ e.preventDefault(); toggleHead(b); } });
  });
  $$("#inv-list .deal-pill").forEach(b=>b.addEventListener("click",e=>{ e.stopPropagation();
    openInfoModal("Deal-Score", dealScoreInfoHTML({ g:b.dataset.grade, roi:parseFloat(b.dataset.roi), col:b.dataset.col, vk:parseFloat(b.dataset.vk), ek:parseFloat(b.dataset.ek), ship:parseFloat(b.dataset.ship), comb:parseFloat(b.dataset.comb), cat:parseFloat(b.dataset.cat) })); }));
  $$("#inv-list .inv-status").forEach(b=>b.addEventListener("click",e=>{ e.stopPropagation();
    const it=inventory.find(x=>x.id===b.dataset.id); if(!it) return; const s=invStatus(it);
    if(s==="ordered"||s==="transit"){ it.status=nextStatusOf(s); it.touchedAt=new Date().toISOString(); DB.saveInventory(inventory); renderInventory(); renderDashboard&&renderDashboard(); showToast(`Status: ${INV_STATUS[it.status].de}`); } }));
  $$("#inv-list .inv-del").forEach(b=>b.addEventListener("click",e=>{ e.stopPropagation(); inventory=inventory.filter(x=>x.id!==b.dataset.id); invExpanded.delete(b.dataset.id); bulkSel.delete(b.dataset.id); DB.saveInventory(inventory); renderInventory(); renderDashboard&&renderDashboard(); showToast("Artikel gelöscht"); }));
  $$("#inv-list .inv-edit").forEach(b=>b.addEventListener("click",e=>{ e.stopPropagation(); openInvEdit(b.dataset.id); }));
  $$("#inv-list .inv-sell").forEach(b=>b.addEventListener("click",e=>{ e.stopPropagation(); const it=inventory.find(x=>x.id===b.dataset.id); if(getFeatCfg().sellAvail && it && invStatus(it)!=="stock"){ showToast("Noch nicht im Wareneingang — kann noch nicht verkauft werden"); return; } openSellModal(b.dataset.id); }));
  $$("#inv-list .inv-supreturn").forEach(b=>b.addEventListener("click",e=>{ e.stopPropagation(); openSupplierReturn(b.dataset.id); }));
  $$("#inv-list .inv-refund").forEach(b=>b.addEventListener("click",e=>{ e.stopPropagation(); toggleRefund(b.dataset.id); }));
  $$("#inv-list .inv-unreturn").forEach(b=>b.addEventListener("click",e=>{ e.stopPropagation(); undoSupplierReturn(b.dataset.id); }));
}

/* ===== Retouren-Aktionen ===== */
function openSupplierReturn(id){ const it=inventory.find(x=>x.id===id); if(!it) return;
  $("#modal-root").innerHTML=`<div class="overlay" id="ov"><div class="modal">
    <p class="font-bold text-[16px] mb-1">An Lieferant zurücksenden</p>
    <p class="c-sub text-[12.5px] mb-4 leading-relaxed">„${escapeHtml(it.name)}" verlässt den aktiven Bestand und wird als Retoure mit <b>offener Erstattung</b> geführt, bis das Geld zurück ist.</p>
    <div class="grid grid-cols-2 gap-3 mb-4">
      <div><label class="label" for="sr-amount">Erstattungsbetrag €</label><input id="sr-amount" class="field tnum" inputmode="decimal" value="${String((it.ek*it.qty).toFixed(2)).replace('.',',')}"></div>
      <div><label class="label" for="sr-date">Datum</label><input id="sr-date" class="field" type="date" value="${todayISOInput()}"></div>
    </div>
    <div class="grid grid-cols-2 gap-3"><button id="sr-cancel" class="btn-ghost">Abbrechen</button><button id="sr-ok" class="btn-accent">Als Retoure buchen</button></div>
  </div></div>`;
  $("#ov").addEventListener("click",e=>{ if(e.target.id==="ov") $("#modal-root").innerHTML=""; });
  $("#sr-cancel").addEventListener("click",()=>$("#modal-root").innerHTML="");
  $("#sr-ok").addEventListener("click",()=>{
    it.status="returned";
    it.supReturn={ date:new Date(($("#sr-date").value||todayISOInput())+"T12:00:00").toISOString(), amount:num($("#sr-amount").value), refund:"pending" };
    it.touchedAt=new Date().toISOString(); DB.saveInventory(inventory);
    $("#modal-root").innerHTML=""; invFilter="returned"; renderInventory(); renderDashboard&&renderDashboard();
    showToast("✓ Als Lieferanten-Retoure gebucht");
  });
}
function toggleRefund(id){ const it=inventory.find(x=>x.id===id); if(!it||!it.supReturn) return;
  it.supReturn.refund = it.supReturn.refund==="refunded" ? "pending" : "refunded";
  DB.saveInventory(inventory); renderInventory(); renderDashboard&&renderDashboard();
  showToast(it.supReturn.refund==="refunded"?"✓ Erstattung erhalten":"Erstattung wieder offen"); }
function undoSupplierReturn(id){ const it=inventory.find(x=>x.id===id); if(!it) return;
  it.status="stock"; delete it.supReturn; it.touchedAt=new Date().toISOString();
  DB.saveInventory(inventory); invFilter="active"; renderInventory(); renderDashboard&&renderDashboard();
  showToast("Retoure rückgängig – zurück im Lager"); }

/* Bestand · Suche + Sortierung + Status-Filter + Bulk */
(function initInvControls(){
  const s=$("#inv-search"), x=$("#inv-search-x");
  if(s) s.addEventListener("input",()=>{ invQuery=s.value; x.classList.toggle("hidden",!s.value); renderInventory(); });
  if(x) x.addEventListener("click",()=>{ s.value=""; invQuery=""; x.classList.add("hidden"); s.focus(); renderInventory(); });
  $$("#inv-sortbar .seg-btn[data-sort]").forEach(b=>b.addEventListener("click",()=>{
    invSort=b.dataset.sort;
    $$("#inv-sortbar .seg-btn[data-sort]").forEach(o=>o.classList.toggle("is-active",o===b));
    renderInventory();
  }));
  $$("#inv-filterbar .seg-btn").forEach(b=>b.addEventListener("click",()=>{ invFilter=b.dataset.filter; renderInventory(); }));

  /* Bulk-Auswahl */
  const bulkToggle=$("#inv-bulk-toggle");
  if(bulkToggle) bulkToggle.addEventListener("click",()=>{ bulkMode=!bulkMode; if(!bulkMode) bulkSel.clear(); renderInventory(); });
  const off=()=>{ bulkMode=false; bulkSel.clear(); renderInventory(); };
  if($("#inv-bulk-cancel")) $("#inv-bulk-cancel").addEventListener("click", off);
  if($("#inv-bulk-del")) $("#inv-bulk-del").addEventListener("click",()=>{
    if(!bulkSel.size){ showToast("Nichts ausgewählt"); return; }
    const n=bulkSel.size; inventory=inventory.filter(it=>!bulkSel.has(it.id)); bulkSel.forEach(id=>invExpanded.delete(id));
    DB.saveInventory(inventory); off(); renderDashboard&&renderDashboard(); showToast(`${n} Artikel gelöscht`);
  });
  if($("#inv-bulk-status")) $("#inv-bulk-status").addEventListener("change",e=>{
    const v=e.target.value; e.target.value=""; if(!v) return;
    if(!bulkSel.size){ showToast("Nichts ausgewählt"); return; }
    let n=0; inventory.forEach(it=>{ if(bulkSel.has(it.id) && invStatus(it)!=="returned"){ it.status=v; it.touchedAt=new Date().toISOString(); n++; } });
    DB.saveInventory(inventory); renderInventory(); renderDashboard&&renderDashboard(); showToast(`Status für ${n} Artikel: ${INV_STATUS[v].de}`);
  });
  if($("#inv-bulk-tag")) $("#inv-bulk-tag").addEventListener("click",()=>{
    if(!bulkSel.size){ showToast("Nichts ausgewählt"); return; }
    const tag=prompt("Tag für die Auswahl (ein Wort):"); if(tag===null) return; const t=tag.trim(); if(!t) return;
    let n=0; inventory.forEach(it=>{ if(bulkSel.has(it.id)){ it.tags=Array.from(new Set([...(it.tags||[]),t])).slice(0,12); it.touchedAt=new Date().toISOString(); n++; } });
    DB.saveInventory(inventory); renderInventory(); showToast(`Tag „${t}" auf ${n} Artikel`);
  });
})();

/* ===== Gebühren-Migration (geführt) ===== */
function openFeeMigration(){
  const items=feeMigrationList();
  if(!items.length){ renderInventory(); return; }
  const sel={}; items.forEach(it=>{ sel[it.id]=num(it.catPct); });
  const iconFallback=`<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--sub)" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="4"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>`;
  const rowHTML=it=>{
    const rate=num(it.catPct), opts=FEE_MIGRATE_OPTIONS[String(rate)]||[[rate,"Beibehalten"]];
    const chips=opts.map((o,i)=>`<button type="button" class="seg-btn mig-chip${i===0?" is-active":""}" data-mid="${it.id}" data-val="${o[0]}">${escapeHtml(o[1])} · ${String(o[0]).replace('.',',')} %</button>`).join("");
    return `<div class="rounded-[15px] p-3 mb-2.5" style="background:var(--cell-2);border:1px solid var(--line)">
      <div class="flex items-center gap-2.5 mb-2.5">
        <span class="thumb" style="width:40px;height:40px;flex:0 0 40px;border-radius:11px;overflow:hidden;display:flex;align-items:center;justify-content:center;background:var(--cell)">${it.img?`<img src="${attrEsc(it.img)}" style="width:100%;height:100%;object-fit:cover">`:iconFallback}</span>
        <div class="min-w-0 flex-1"><p class="font-semibold text-[13.5px] leading-snug truncate">${escapeHtml(it.name)}</p><p class="c-sub text-[11px] mt-0.5">aktuell hinterlegt: <b>${String(rate).replace('.',',')} %</b></p></div>
      </div>
      <div class="flex flex-wrap gap-1.5">${chips}</div>
    </div>`;
  };
  $("#modal-root").innerHTML=`<div class="overlay" id="ov"><div class="modal" style="max-height:88vh;display:flex;flex-direction:column">
    <div class="mb-3">
      <p class="font-bold text-[16px] leading-snug">Gebühren anpassen (01.07.2026)</p>
      <p class="c-sub text-[12px] mt-1 leading-relaxed">Wähle je Artikel die passende Kategorie. Voreingestellt ist „bleibt gleich“ – tippe nur dort um, wo sich der Satz geändert hat.</p>
    </div>
    <div style="overflow-y:auto;flex:1;margin:0 -2px;padding:0 2px">${items.map(rowHTML).join("")}</div>
    <div class="grid grid-cols-2 gap-3 mt-3"><button id="mig-cancel" class="btn-ghost">Abbrechen</button><button id="mig-save" class="btn-accent">${items.length} Artikel speichern</button></div>
  </div></div>`;
  $$("#modal-root .mig-chip").forEach(b=>b.addEventListener("click",()=>{
    const id=b.dataset.mid; sel[id]=num(b.dataset.val);
    $$(`#modal-root .mig-chip[data-mid="${id}"]`).forEach(o=>o.classList.toggle("is-active",o===b));
  }));
  const close=()=>$("#modal-root").innerHTML="";
  $("#ov").addEventListener("click",e=>{ if(e.target.id==="ov") close(); });
  $("#mig-cancel").addEventListener("click",close);
  $("#mig-save").addEventListener("click",()=>{
    items.forEach(it=>{ const o=inventory.find(x=>x.id===it.id); if(o){ o.catPct=sel[it.id]; o.feeVer=FEE_VER; } });
    DB.saveInventory(inventory); close(); renderInventory(); renderDashboard&&renderDashboard();
    showToast(`✓ ${items.length} Artikel auf neue Gebühren aktualisiert`);
  });
}
if($("#fee-migrate-open")) $("#fee-migrate-open").addEventListener("click",openFeeMigration);
if($("#fee-migrate-dismiss")) $("#fee-migrate-dismiss").addEventListener("click",()=>{
  stampAllFeeVer(); renderInventory(); showToast("✓ Bestand als geprüft markiert – nichts geändert");
});

/* ===== 10b · FIXKOSTEN (v1.5) ===== */
let fxFormOpen=false, editingFixId=null;
/* ===== Ausgaben-Kategorien (Name · Farbe · Icon) — gespeichert in fixCfg.cats ===== */
const FIX_COLORS = ["#34D399","#60A5FA","#F472B6","#FBBF24","#A78BFA","#22D3EE","#FB7185","#4ADE80","#F59E0B","#818CF8","#2DD4BF","#F87171"];
const FIX_ICONS = {
  box:'<path d="M21 8 12 3 3 8v8l9 5 9-5V8Z"/><path d="M3 8l9 5 9-5"/><path d="M12 13v8"/>',
  truck:'<path d="M3 6h11v9H3zM14 9h4l3 3v3h-7z"/><circle cx="7" cy="18" r="1.6"/><circle cx="17.5" cy="18" r="1.6"/>',
  card:'<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M3 10h18"/>',
  laptop:'<rect x="4" y="5" width="16" height="10" rx="1.5"/><path d="M2 19h20"/>',
  receipt:'<path d="M6 3h12v18l-2-1.3L14 21l-2-1.3L10 21l-2-1.3L6 21Z"/><path d="M9 8h6M9 12h6"/>',
  tag:'<path d="M3 12 12 3h6a3 3 0 0 1 3 3v6l-9 9Z"/><circle cx="16.5" cy="7.5" r="1.3"/>',
  wrench:'<path d="M14 6a4 4 0 0 0 5 5l-8 8a2.8 2.8 0 0 1-4-4Z"/>',
  printer:'<path d="M6 9V4h12v5"/><rect x="4" y="9" width="16" height="7" rx="1.5"/><path d="M8 16h8v5H8z"/>',
  phone:'<rect x="7" y="3" width="10" height="18" rx="2.5"/><path d="M11 18h2"/>',
  cart:'<circle cx="9" cy="20" r="1.4"/><circle cx="17" cy="20" r="1.4"/><path d="M3 4h2l2.2 11h10l2-8H6"/>',
  bank:'<path d="M3 10 12 4l9 6"/><path d="M5 10v8M10 10v8M14 10v8M19 10v8M3 20h18"/>',
  bulb:'<path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 1 4 10.5c-.7.7-1 1.2-1 2.5H9c0-1.3-.3-1.8-1-2.5A6 6 0 0 1 12 3Z"/>',
  cloud:'<path d="M7 18a4 4 0 0 1 0-8 5 5 0 0 1 9.6 1.3A3.5 3.5 0 0 1 17 18Z"/>',
  camera:'<rect x="3" y="7" width="18" height="12" rx="2.5"/><circle cx="12" cy="13" r="3"/><path d="M8 7l1.5-2h5L16 7"/>',
  home:'<path d="M4 11 12 4l8 7"/><path d="M6 10v10h12V10"/>',
  coins:'<ellipse cx="9" cy="7" rx="6" ry="3"/><path d="M3 7v5c0 1.7 2.7 3 6 3s6-1.3 6-3"/><path d="M15 11.5c2.4.3 5 1.4 5 3.5 0 1.7-2.7 3-6 3-1.5 0-2.9-.3-4-.7"/>',
  megaphone:'<path d="M3 11v2a1 1 0 0 0 1 1h2l9 5V5L6 10H4a1 1 0 0 0-1 1Z"/><path d="M18 9a4 4 0 0 1 0 6"/>',
  gift:'<rect x="4" y="9" width="16" height="11" rx="1.5"/><path d="M2 9h20v3H2zM12 9v11"/>'
};
const DEFAULT_EXPENSE_CATS = [
  {id:"ec_material", name:"Material & Verpackung", color:"#34D399", icon:"box"},
  {id:"ec_shipping", name:"Versand", color:"#60A5FA", icon:"truck"},
  {id:"ec_fees",     name:"Gebühren",             color:"#FB7185", icon:"card"},
  {id:"ec_software", name:"Software & Abos",       color:"#A78BFA", icon:"cloud"},
  {id:"ec_office",   name:"Büro",                 color:"#FBBF24", icon:"printer"},
  {id:"ec_other",    name:"Sonstiges",            color:"#94A3B8", icon:"tag"}
];
function fixIconSVG(key){ return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${FIX_ICONS[key]||FIX_ICONS.tag}</svg>`; }
function getExpenseCats(){ if(!Array.isArray(fixCfg.cats) || !fixCfg.cats.length){ fixCfg.cats = DEFAULT_EXPENSE_CATS.map(c=>({...c})); } return fixCfg.cats; }
function expenseCatById(id){ return getExpenseCats().find(c=>c.id===id) || null; }
function resolveFixCat(f){ if(f.catId){ const c=expenseCatById(f.catId); if(c) return c; } if(f.cat) return {id:null,name:f.cat,color:"#94A3B8",icon:"tag"}; return {id:null,name:"Ohne Kategorie",color:"#64748B",icon:"tag"}; }
function catTint(c){ return `color:${c};background:color-mix(in srgb, ${c} 15%, transparent);border:1px solid color-mix(in srgb, ${c} 32%, transparent)`; }
function refreshFixCatSelect(){ const sel=$("#fx-cat"); if(!sel) return; const cur=sel.value;
  sel.innerHTML=getExpenseCats().map(c=>`<option value="${c.id}">${escapeHtml(c.name)}</option>`).join("")+`<option value="__new__">＋ Neue Kategorie …</option>`;
  if(cur && getExpenseCats().some(c=>c.id===cur)) sel.value=cur; }
function renderExpenseCats(){ const box=$("#ec-list"); if(!box) return;
  box.innerHTML=getExpenseCats().map(c=>`<button type="button" class="fx-cat-chip ec-edit" data-id="${c.id}" title="Bearbeiten"><span class="fx-cat-ic" style="${catTint(c.color)}">${fixIconSVG(c.icon)}</span>${escapeHtml(c.name)}</button>`).join("");
  $$("#ec-list .ec-edit").forEach(b=>b.addEventListener("click",()=>openExpenseCatModal(b.dataset.id))); }
function openExpenseCatModal(id){
  const editing = id ? expenseCatById(id) : null;
  let selColor = editing ? editing.color : FIX_COLORS[Math.floor(Math.random()*FIX_COLORS.length)];
  let selIcon  = editing ? editing.icon  : "tag";
  const colorsHTML=FIX_COLORS.map(c=>`<button type="button" class="ec-swatch" data-color="${c}" style="background:${c}" aria-selected="${c===selColor?"true":"false"}"></button>`).join("");
  const iconsHTML=Object.keys(FIX_ICONS).map(k=>`<button type="button" class="ec-icobtn" data-icon="${k}" aria-selected="${k===selIcon?"true":"false"}">${fixIconSVG(k)}</button>`).join("");
  $("#modal-root").innerHTML=`<div class="overlay" id="ov"><div class="modal" style="max-width:440px">
    <div class="flex items-start justify-between gap-3 mb-1">
      <div><p class="font-bold text-[18px]">${editing?"Kategorie bearbeiten":"Neue Kategorie"}</p><p class="c-sub text-[12.5px] mt-0.5">Für deine Ausgaben — mit Farbe &amp; Icon.</p></div>
      <button id="ec-x" class="iconbtn" title="Schließen" aria-label="Schließen"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg></button>
    </div>
    <div class="my-4"><label class="label" for="ec-name">Name *</label><input id="ec-name" class="field" placeholder="z. B. Verpackung, Software, Versand" value="${editing?attrEsc(editing.name):""}"></div>
    <div class="mb-4"><p class="label mb-2">Farbe</p><div id="ec-colors" class="ec-swatches">${colorsHTML}</div></div>
    <div class="mb-4"><p class="label mb-2">Icon</p><div id="ec-icons" class="ec-icons">${iconsHTML}</div></div>
    <div class="grid grid-cols-2 gap-3">${editing?`<button id="ec-del" class="btn-ghost" style="color:var(--danger)">Löschen</button>`:`<button id="ec-cancel" class="btn-ghost">Abbrechen</button>`}<button id="ec-save" class="btn-accent">${editing?"Speichern":"Anlegen"}</button></div>
  </div></div>`;
  const close=()=>{ $("#modal-root").innerHTML=""; };
  $("#ec-x").addEventListener("click",close);
  if($("#ec-cancel")) $("#ec-cancel").addEventListener("click",close);
  $$("#ec-colors .ec-swatch").forEach(b=>b.addEventListener("click",()=>{ selColor=b.dataset.color; $$("#ec-colors .ec-swatch").forEach(x=>x.setAttribute("aria-selected", x.dataset.color===selColor?"true":"false")); }));
  $$("#ec-icons .ec-icobtn").forEach(b=>b.addEventListener("click",()=>{ selIcon=b.dataset.icon; $$("#ec-icons .ec-icobtn").forEach(x=>x.setAttribute("aria-selected", x.dataset.icon===selIcon?"true":"false")); }));
  if($("#ec-del")) $("#ec-del").addEventListener("click",()=>{ fixCfg.cats=getExpenseCats().filter(c=>c.id!==id); DB.saveFixCfg(fixCfg); close(); renderFixed(); showToast("Kategorie gelöscht"); });
  $("#ec-save").addEventListener("click",()=>{ const name=$("#ec-name").value.trim(); if(!name){ flashError($("#ec-name")); return; }
    getExpenseCats(); let newId=null;
    if(editing){ Object.assign(editing,{name,color:selColor,icon:selIcon}); }
    else { newId="ec"+Date.now(); fixCfg.cats.push({id:newId,name,color:selColor,icon:selIcon}); }
    DB.saveFixCfg(fixCfg); close(); renderFixed();
    if(newId && $("#fx-cat")){ refreshFixCatSelect(); $("#fx-cat").value=newId; }
    showToast(editing?"Kategorie gespeichert":"Kategorie angelegt"); });
}
function renderFixed(){
  $("#fx-total").textContent=eur(fixedTotal());
  $("#fx-perpkg").textContent=eur(fixedPerPackage());
  $("#fx-target").textContent=pct(targetMargin()*100);
  const af=document.activeElement;
  if(af!==$("#fx-base") && $("#fx-base")) $("#fx-base").value=fixCfg.baseMargin;
  renderExpenseCats(); refreshFixCatSelect();
  // Aufschlüsselung nach Kategorie
  const total=fixedTotal(); const groups={};
  fixed.forEach(f=>{ const cat=resolveFixCat(f); const key=cat.id||("legacy:"+cat.name);
    if(!groups[key]) groups[key]={cat, sum:0}; groups[key].sum+=fixMonthly(f); });
  const arr=Object.values(groups).sort((a,b)=>b.sum-a.sum);
  const bd=$("#fx-breakdown");
  if(bd){ bd.classList.toggle("hidden", arr.length===0);
    const bar=$("#fx-bar"); if(bar) bar.innerHTML = total>0 ? arr.map(g=>`<span style="width:${(g.sum/total*100).toFixed(2)}%;background:${g.cat.color}" title="${attrEsc(g.cat.name)}"></span>`).join("") : "";
    const sums=$("#fx-cat-sums"); if(sums) sums.innerHTML = arr.map(g=>`<div class="fx-sum-row"><span class="fx-cat-ic" style="${catTint(g.cat.color)}">${fixIconSVG(g.cat.icon)}</span><span class="fx-sum-name">${escapeHtml(g.cat.name)}</span><span class="c-sub tnum text-[12px]">${total>0?pct(g.sum/total*100):"0 %"}</span><span class="mono font-bold tnum">${eur(g.sum)}</span></div>`).join("");
  }
  // Liste
  const box=$("#fx-list"); box.innerHTML=""; $("#fx-empty").classList.toggle("hidden",fixed.length>0);
  fixed.forEach(f=>{ const cat=resolveFixCat(f); const el=document.createElement("div"); el.className="row"; el.style.cssText="border:1px solid var(--line);background:var(--cell-2);align-items:center";
    const nonMonthly=f.interval&&f.interval!=="month"; const nd=fixNextDueTxt(f);
    const sub=`${escapeHtml(cat.name)} · ${fixIntervalLabel(f)}${nonMonthly?` · ≙ ${eur(fixMonthly(f))}/M`:""}${nd?` · ${nd}`:""}`;
    el.innerHTML=`<span class="fx-cat-ic" style="${catTint(cat.color)}">${fixIconSVG(cat.icon)}</span>
      <div class="flex-1 min-w-0"><p class="font-semibold text-[14.5px] truncate">${escapeHtml(f.name)}</p><p class="c-sub text-[12px] mt-0.5 truncate">${sub}</p></div>
      <span class="mono font-bold text-[15px] shrink-0 mr-1">${eur(num(f.amount))}<span class="c-sub text-[11px] font-normal"> ${fixIntervalShort(f)}</span></span>
      <div class="flex flex-col gap-2 shrink-0"><button class="iconbtn fx-edit" data-id="${f.id}" title="Bearbeiten">${icoEdit}</button><button class="iconbtn danger fx-del" data-id="${f.id}" title="Löschen">${icoTrash}</button></div>`;
    box.appendChild(el); });
  $$(".fx-edit").forEach(b=>b.addEventListener("click",()=>openFixEdit(b.dataset.id)));
  $$(".fx-del").forEach(b=>b.addEventListener("click",()=>{ fixed=fixed.filter(x=>x.id!==b.dataset.id); DB.saveFixed(fixed); renderFixed(); renderInventory(); showToast(t("toast.deleted")); }));
}
/* Zielmarge live */
if($("#fx-base")) $("#fx-base").addEventListener("input",()=>{
  fixCfg={ ...fixCfg, baseMargin:num($("#fx-base").value) };
  DB.saveFixCfg(fixCfg); renderFixed(); renderInventory(); });
if($("#ec-new")) $("#ec-new").addEventListener("click",()=>openExpenseCatModal());
if($("#fx-cat")) $("#fx-cat").addEventListener("change",()=>{ if($("#fx-cat").value==="__new__"){ const first=getExpenseCats()[0]; $("#fx-cat").value=first?first.id:""; openExpenseCatModal(); } });
/* Collapsible Ausgaben-Formular */
function setFixForm(open){ fxFormOpen=open; $("#fx-form").classList.toggle("hidden",!open);
  if(open && $("#fx-anchor") && !$("#fx-anchor").value) $("#fx-anchor").value=fixTodayISO();
  $("#fx-toggle-ic").style.transform=open?"rotate(45deg)":"rotate(0deg)";
  $("#fx-toggle").querySelector("span").textContent= open ? (lang==="en"?"Close":"Schließen") : t("fix.add");
  if(!open){ editingFixId=null; $("#fx-name").value=""; $("#fx-amount").value=""; if($("#fx-interval")) $("#fx-interval").value="month"; if($("#fx-interval-days")){ $("#fx-interval-days").value=""; $("#fx-interval-days").classList.add("hidden"); } if($("#fx-anchor")) $("#fx-anchor").value=fixTodayISO(); refreshFixCatSelect(); const first=getExpenseCats()[0]; if($("#fx-cat")) $("#fx-cat").value=first?first.id:""; refreshPaySelects(); if($("#fx-paymethod")) $("#fx-paymethod").value=""; $("#fx-add").textContent=t("btn.add"); } }
$("#fx-toggle").addEventListener("click",()=>setFixForm(!fxFormOpen));
$("#fx-cancel").addEventListener("click",()=>setFixForm(false));
$("#fx-add").addEventListener("click",()=>{ const name=$("#fx-name").value.trim(), amount=num($("#fx-amount").value); const sc=$("#fx-cat"); let catId=sc?sc.value:""; if(catId==="__new__") catId="";
  const ps=$("#fx-paymethod"); let payMethodId=ps?ps.value:""; if(payMethodId==="__new__") payMethodId="";
  const iv=$("#fx-interval")?$("#fx-interval").value:"month"; const ivDays=iv==="custom"?Math.max(1,parseInt($("#fx-interval-days").value)||0):null;
  if(!name){ flashError($("#fx-name")); return; } if(amount<=0){ flashError($("#fx-amount")); return; }
  if(iv==="custom" && (!ivDays||ivDays<1)){ flashError($("#fx-interval-days")); return; }
  const anchor=($("#fx-anchor")&&$("#fx-anchor").value)||fixTodayISO();
  const patch={name,amount,catId,payMethodId,interval:iv,intervalDays:ivDays,anchor};
  if(editingFixId){ const f=fixed.find(x=>x.id===editingFixId); if(f){ Object.assign(f,patch); delete f.cat; } }
  else fixed.unshift(Object.assign({id:"fx"+Date.now()},patch));
  DB.saveFixed(fixed); setFixForm(false); renderFixed(); renderInventory(); showToast(t("toast.saved")); });
if($("#fx-interval")) $("#fx-interval").addEventListener("change",()=>{ const c=$("#fx-interval").value==="custom"; if($("#fx-interval-days")) $("#fx-interval-days").classList.toggle("hidden",!c); });
function openFixEdit(id){ const f=fixed.find(x=>x.id===id); if(!f) return; editingFixId=id;
  $("#fx-name").value=f.name; $("#fx-amount").value=String(f.amount).replace(".",","); refreshFixCatSelect();
  if($("#fx-interval")) $("#fx-interval").value=f.interval||"month";
  if($("#fx-interval-days")){ $("#fx-interval-days").value=f.intervalDays||""; $("#fx-interval-days").classList.toggle("hidden",(f.interval||"month")!=="custom"); }
  if($("#fx-anchor")) $("#fx-anchor").value=f.anchor||fixTodayISO();
  refreshPaySelects(); if($("#fx-paymethod")) $("#fx-paymethod").value=(f.payMethodId && payMethodById(f.payMethodId))?f.payMethodId:"";
  const sc=$("#fx-cat"); if(sc){ if(f.catId && getExpenseCats().some(c=>c.id===f.catId)) sc.value=f.catId; else { const first=getExpenseCats()[0]; sc.value=first?first.id:""; } }
  $("#fx-add").textContent=t("btn.save"); fxFormOpen=true; $("#fx-form").classList.remove("hidden"); $("#fx-toggle-ic").style.transform="rotate(45deg)"; $("#fx-toggle").querySelector("span").textContent=(lang==="en"?"Close":"Schließen"); }

/* ===== 10c · MONATS-REPORT + EXPORT ===== */
let rpKey=null;   // "YYYY-M"

function reportMonths(){
  const set=new Map();
  flips.forEach(f=>{ const d=new Date(f.date); const k=`${d.getFullYear()}-${d.getMonth()}`;
    if(!set.has(k)) set.set(k,{y:d.getFullYear(),m:d.getMonth()}); });
  const arr=[...set.entries()].map(([k,v])=>({key:k,...v})).sort((a,b)=> b.y-a.y || b.m-a.m);
  const n=new Date(), curKey=`${n.getFullYear()}-${n.getMonth()}`;
  if(!arr.some(o=>o.key===curKey)) arr.unshift({key:curKey,y:n.getFullYear(),m:n.getMonth()});
  return arr;
}
function reportFlips(key){
  if(!key) return [];
  const [y,m]=key.split("-").map(Number);
  return flips.filter(f=>{ const d=new Date(f.date); return d.getFullYear()===y && d.getMonth()===m; })
              .sort((a,b)=>new Date(b.date)-new Date(a.date));
}
/* =====================================================================
   AUSWERTUNG — ein Tab, zwei Zeiträume (Monat / Jahr).
   Statt zweier konkurrierender Bereiche steuert EIN Zeitraum-Umschalter
   alle Kennzahlen, die Aufschlüsselung, den Verlauf und die Aufteilung.
   ===================================================================== */
let rpScope = "month", statsYear = new Date().getFullYear(), rpChart = "money", rpSplit = "products";

function statsYears(){ const ys=new Set([new Date().getFullYear()]); flips.forEach(f=>ys.add(new Date(f.date).getFullYear())); return [...ys].sort((a,b)=>b-a); }
function yearBuckets(y){ const out=[]; for(let m=0;m<12;m++) out.push({y,m,label:MONTHS[m],profit:0,revenue:0,cost:0,count:0});
  flips.forEach(f=>{ if(f.returned) return; const d=new Date(f.date); if(d.getFullYear()!==y) return; const b=out[d.getMonth()];
    b.profit+=flipProfit(f); b.revenue+=flipRevenue(f); b.cost+=flipCost(f); b.count+=(f.qty||1); }); return out; }
/* Verkäufe des aktuell gewählten Zeitraums */
function scopeFlips(){
  if(rpScope==="year") return flips.filter(f=>new Date(f.date).getFullYear()===statsYear);
  return reportFlips(rpKey);
}
function scopeLabel(){ if(rpScope==="year") return String(statsYear); const [y,m]=rpKey.split("-").map(Number); return `${MONTHS[m]} ${y}`; }

/* --- Aufteilung: Produkte / Plattformen / Fixkosten --- */
function splitBarHTML(rows, maxV){
  return rows.map(r=>`<div class="mb-3">
    <div class="flex items-center justify-between mb-1 gap-2">${r.head}<span class="tnum text-[13.5px] font-bold" style="color:${r.val>=0?'var(--accent)':'var(--danger)'};flex:0 0 auto">${r.val>=0?"+":""}${eur(r.val)}</span></div>
    <div style="height:6px;border-radius:3px;background:var(--line);overflow:hidden"><div style="height:100%;width:${Math.max(3,Math.abs(r.val)/maxV*100)}%;background:${r.val>=0?'var(--accent)':'var(--danger)'};border-radius:3px"></div></div>
    <p class="c-sub text-[11px] mt-1">${r.sub}</p></div>`).join("");
}
function renderSplit(list){
  const box=$("#rp-split"); if(!box) return;
  if(rpSplit==="expenses"){
    if(!fixed.length){ box.innerHTML=`<p class="c-sub text-[13px] text-center py-6">Keine Fixkosten hinterlegt.</p>`; return; }
    const mult = rpScope==="year" ? 12 : 1;
    const rows=[...fixed].sort((a,b)=>fixMonthly(b)-fixMonthly(a));
    box.innerHTML=rows.map(f=>`<div class="brk"><span>${escapeHtml(f.name||"—")}</span><span class="mono">${eur(fixMonthly(f)*mult)}</span></div>`).join("")
      + `<div class="brk brk-total"><span>Gesamt · ${scopeLabel()}</span><span class="mono font-bold">${eur(fixedTotal()*mult)}</span></div>`;
    return;
  }
  if(!list.length){ box.innerHTML=`<p class="c-sub text-[13px] text-center py-6">Keine Verkäufe in ${scopeLabel()}.</p>`; return; }
  const map={};
  if(rpSplit==="platforms"){
    list.forEach(f=>{ const k=f.platform&&PLATFORMS[f.platform]?f.platform:"ebay";
      const e=map[k]||(map[k]={key:k,val:0,revenue:0,units:0,count:0}); e.val+=flipProfit(f); e.revenue+=flipRevenue(f); e.units+=(f.qty||1); e.count++; });
    const rows=Object.values(map).sort((a,b)=>b.val-a.val);
    const maxV=Math.max(1,...rows.map(r=>Math.abs(r.val)));
    box.innerHTML=splitBarHTML(rows.map(r=>{ const p=PLATFORMS[r.key];
      return { val:r.val, head:`<span class="pill ${p.pill}">${p.label}</span>`, sub:`${r.count} Verkäufe · ${r.units} Stk · ${eur(r.revenue)} Umsatz` }; }), maxV);
    return;
  }
  list.forEach(f=>{ const k=f.name||"—"; const e=map[k]||(map[k]={name:k,val:0,revenue:0,units:0}); e.val+=flipProfit(f); e.revenue+=flipRevenue(f); e.units+=(f.qty||1); });
  const rows=Object.values(map).sort((a,b)=>b.val-a.val).slice(0,12);
  const maxV=Math.max(1,...rows.map(r=>Math.abs(r.val)));
  box.innerHTML=splitBarHTML(rows.map(r=>({ val:r.val,
    head:`<span class="text-[13.5px] font-semibold truncate">${escapeHtml(r.name)}</span>`,
    sub:`${r.units} Stk verkauft · ${eur(r.revenue)} Umsatz` })), maxV);
}

function renderReport(){
  const sel=$("#rp-month"); if(!sel) return;
  const months=reportMonths();
  if(!rpKey || !months.some(o=>o.key===rpKey)) rpKey=months[0].key;
  sel.innerHTML=months.map(o=>`<option value="${o.key}"${o.key===rpKey?" selected":""}>${MONTHS[o.m]} ${o.y}</option>`).join("");
  const ySel=$("#st-year"), years=statsYears();
  if(!years.includes(statsYear)) statsYear=years[0];
  ySel.innerHTML=years.map(y=>`<option value="${y}"${y===statsYear?" selected":""}>${y}</option>`).join("");
  sel.classList.toggle("hidden", rpScope!=="month");
  ySel.classList.toggle("hidden", rpScope!=="year");

  const list=scopeFlips();
  const rev  = list.reduce((s,f)=>s+flipRevenue(f),0);
  const ek   = list.reduce((s,f)=>s+num(f.ek)*(f.qty||1),0);
  const ship = list.reduce((s,f)=>s+num(f.ship)*(f.qty||1),0);
  const profit = list.reduce((s,f)=>s+flipProfit(f),0);
  const fx   = fixedTotal() * (rpScope==="year" ? 12 : 1);
  const net  = profit-fx;
  const margin = rev>0 ? profit/rev*100 : 0;
  const units = list.reduce((s,f)=>s+(f.qty||1),0);

  const pe=$("#rp-profit"); pe.textContent=(net>=0?"+":"")+eur(net); pe.style.color=net>=0?"var(--accent)":"var(--danger)";
  $("#rp-profit-sub").textContent=`nach Fixkosten · ${scopeLabel()}`;
  $("#rp-rev").textContent=eur(rev);
  $("#rp-rev-sub").textContent=`Ø ${eur(list.length?rev/list.length:0)} pro Verkauf`;
  if($("#rp-expenses")){ $("#rp-expenses").textContent=eur(ek+ship+fx); $("#rp-expenses-sub").textContent=`Ware + Versand + Fixkosten (${rpScope==="year"?"Jahr":"Monat"})`; }
  $("#rp-margin").textContent=pct(margin);
  $("#rp-count").textContent=String(units);
  $("#rp-count-sub").textContent=`${list.length} ${list.length===1?"Verkauf":"Verkäufe"}`;

  $("#rp-b-rev").textContent=eur(rev);
  $("#rp-b-ek").textContent="- "+eur(ek);
  $("#rp-b-ship").textContent="- "+eur(ship);
  $("#rp-b-fix-label").textContent = rpScope==="year" ? "Fixkosten (Jahr)" : "Fixkosten (Monat)";
  $("#rp-b-fix").textContent="- "+eur(fx);
  const ne=$("#rp-b-net"); ne.textContent=(net>=0?"+":"")+eur(net); ne.style.color=net>=0?"var(--accent)":"var(--danger)";

  const buckets = rpScope==="year" ? yearBuckets(statsYear) : monthlyBuckets(6);
  $("#rp-chart").innerHTML = rpChart==="count" ? barChartSVG(buckets,"count") : stackedChartSVG(buckets);
  const sumP=buckets.reduce((s,o)=>s+o.profit,0), sumR=buckets.reduce((s,o)=>s+o.revenue,0), sumC=buckets.reduce((s,o)=>s+o.count,0);
  $("#rp-chart-foot").innerHTML = rpChart==="count"
    ? `${sumC} Stück im Verlauf`
    : `Umsatz <b>${eur(sumR)}</b> · Gewinn <b style="color:${sumP>=0?'var(--accent)':'var(--danger)'}">${eur(sumP)}</b>`;

  renderSplit(list);

  const box=$("#rp-list");
  $("#rp-list-count").textContent=units;
  refreshImgMigStat(); refreshLinkMigStat(); renderBackupList();
  if(!list.length){ box.innerHTML=`<p class="c-sub text-[13px] text-center py-6">Keine Verkäufe in ${scopeLabel()}.</p>`; return; }
  box.innerHTML="";
  list.forEach(f=>{ const el=document.createElement("div"); el.className="row";
    el.innerHTML=flipRowHTML(f); el.addEventListener("click",()=>openFlipDetail(f.id)); box.appendChild(el); });
}
$("#rp-month").addEventListener("change",()=>{ rpKey=$("#rp-month").value; renderReport(); });
$("#st-year").addEventListener("change",()=>{ statsYear=parseInt($("#st-year").value); renderReport(); });
$$("[data-scope]").forEach(b=>b.addEventListener("click",()=>{ rpScope=b.dataset.scope;
  $$("[data-scope]").forEach(x=>x.setAttribute("aria-selected", x===b?"true":"false")); renderReport(); }));
$$("[data-chart]").forEach(b=>b.addEventListener("click",()=>{ rpChart=b.dataset.chart;
  $$("[data-chart]").forEach(x=>x.setAttribute("aria-selected", x===b?"true":"false")); renderReport(); }));
$$("[data-split]").forEach(b=>b.addEventListener("click",()=>{ rpSplit=b.dataset.split;
  $$("[data-split]").forEach(x=>x.setAttribute("aria-selected", x===b?"true":"false")); renderReport(); }));

/* ---- Download-Helfer ---- */
function downloadFile(name, content, mime){
  const blob=new Blob([content],{type:mime||"text/plain;charset=utf-8"});
  const a=document.createElement("a"); a.href=URL.createObjectURL(blob); a.download=name;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(()=>URL.revokeObjectURL(a.href),1500);
}
const csvCell = v => `"${String(v==null?"":v).replace(/"/g,'""')}"`;
const csvNum  = n => `"${Number(n||0).toFixed(2).replace(".",",")}"`;   // deutsches Excel

$("#rp-csv").addEventListener("click",()=>{
  const list=scopeFlips();
  if(!list.length){ showToast("Keine Verkäufe in "+scopeLabel()); return; }
  const head=["Datum","Produkt","EAN","Plattform","Menge","EK/Stk","Auszahlung/Stk","Versand/Stk","Umsatz","Kosten","Gewinn"];
  const rows=list.map(f=>[
    csvCell(new Date(f.date).toLocaleDateString("de-DE")), csvCell(f.name), csvCell(f.ean||""),
    csvCell((PLATFORMS[f.platform]||PLATFORMS.ebay).label),
    csvCell(f.qty||1), csvNum(f.ek), csvNum(f.payout), csvNum(f.ship),
    csvNum(flipRevenue(f)), csvNum(flipCost(f)), csvNum(flipProfit(f))
  ].join(";"));
  const sum=[csvNum(list.reduce((s,f)=>s+flipRevenue(f),0)), csvNum(list.reduce((s,f)=>s+flipCost(f),0)), csvNum(list.reduce((s,f)=>s+flipProfit(f),0))];
  const csv="\uFEFF"+[head.join(";"),...rows,["SUMME","","","","","","","",...sum].join(";")].join("\r\n");
  const slug = rpScope==="year" ? String(statsYear) : rpKey.split("-").map((v,i)=>i?String(+v+1).padStart(2,"0"):v).join("-");
  downloadFile(`flipdeck-auswertung-${slug}.csv`, csv, "text/csv;charset=utf-8");
  showToast("✓ CSV exportiert");
});

$("#rp-backup").addEventListener("click", downloadFullBackup);

/* ===== Tägliche automatische Backups (lokal, pro Gerät) ===== */
/* Momentaufnahme des kompletten Datenstands */
function snapshotNow(){ return { ts:new Date().toISOString(), day:new Date().toISOString().slice(0,10), app:"Flipdeck", version:"3.0",
  flips, inventory, fixed, fixcfg:fixCfg, shipcfg:shipCfg, calcs:(typeof calcs!=="undefined"?calcs:[]) }; }

/* --- Ebene 1: lokale Tagessicherung (schnell, offline, aber nur auf DIESEM Gerät) --- */
function autoBackupKey(){ return "fg_autobak_"+(currentUser?currentUser.username:"guest"); }
function loadAutoBackups(){ try{ return JSON.parse(Store.get(autoBackupKey())||"[]")||[]; }catch(e){ return []; } }
function saveAutoBackups(arr){ try{ Store.set(autoBackupKey(), JSON.stringify(arr)); return true; }catch(e){ return false; } }
function maybeAutoBackup(){
  const list=loadAutoBackups(), today=new Date().toISOString().slice(0,10);
  if(!(list[0] && list[0].day===today)){
    let arr=[snapshotNow(), ...list].slice(0,7);
    while(arr.length && !saveAutoBackups(arr)) arr=arr.slice(0,arr.length-1);  // Quota-sicher: älteste opfern
  }
  renderBackupList();
}

/* --- Ebene 2: tägliche Cloud-Sicherung in Supabase (überlebt Browser-Reset & andere Geräte) --- */
let cloudBackups = null;   // Cache; null = noch nicht geladen
async function maybeCloudBackup(){
  if(!currentUser || !currentUser.id) return;
  try{
    const list = (await DB.getBackups()) || [];
    const today = new Date().toISOString().slice(0,10);
    if(!(list[0] && list[0].day===today)){
      cloudBackups = [snapshotNow(), ...list].slice(0,7);
      await DB.saveBackups(cloudBackups);
    } else cloudBackups = list;
  }catch(e){ console.warn("[cloud backup]", e && e.message); }
  renderBackupList();
}

/* --- Ebene 3: Datei-Voll-Backup (einzige Sicherung AUSSERHALB von Supabase) --- */
function downloadFullBackup(){
  const dump = Object.assign({ app:"Flipdeck", version:"3.0", exportedAt:new Date().toISOString() },
    { flips, inventory, fixed, fixcfg:fixCfg, shipcfg:shipCfg, calcs:(typeof calcs!=="undefined"?calcs:[]) });
  const json=JSON.stringify(dump,null,2);
  downloadFile(`flipdeck-backup-${new Date().toISOString().slice(0,10)}.json`, json, "application/json");
  Store.set("fg_lastdl", new Date().toISOString());
  const kb=Math.max(1, Math.round((new Blob([json]).size)/1024));
  showToast(`✓ Voll-Backup gespeichert (~${kb} KB · ${flips.length+inventory.length+fixed.length} Datensätze)`);
  renderBackupList();
}

/* ===== Ebene 4: AUTOMATISCHE Datei-Backups in einen selbst gewählten Ordner =====
   Einmal Ordner wählen (am besten ein Cloud-Sync-Ordner wie OneDrive/iCloud/Google Drive) →
   danach schreibt Flipdeck dort wöchentlich still ein Voll-Backup. Die einzige Sicherung
   außerhalb von Supabase, jetzt ohne dass man daran denken muss. (File System Access API) */
const FSA_SUPPORTED = (typeof window!=="undefined" && "showDirectoryPicker" in window);
function idbBackup(mode){ return new Promise((resolve,reject)=>{ const r=indexedDB.open("flipdeck-fs",1);
  r.onupgradeneeded=()=>{ try{ r.result.createObjectStore("kv"); }catch(e){} };
  r.onerror=()=>reject(r.error);
  r.onsuccess=()=>{ const db=r.result; const tx=db.transaction("kv", mode||"readonly"); resolve({db, st:tx.objectStore("kv"), tx}); }; }); }
async function saveBackupDirHandle(h){ const {db,st,tx}=await idbBackup("readwrite"); st.put(h, uKey("bakdir")); return new Promise(res=>{ tx.oncomplete=()=>{ db.close(); res(); }; tx.onerror=()=>{ db.close(); res(); }; }); }
async function getBackupDirHandle(){ try{ const {db,st,tx}=await idbBackup("readonly"); const g=st.get(uKey("bakdir")); return await new Promise(res=>{ g.onsuccess=()=>res(g.result||null); g.onerror=()=>res(null); tx.oncomplete=()=>db.close(); }); }catch(e){ return null; } }
async function clearBackupDirHandle(){ try{ const {db,st,tx}=await idbBackup("readwrite"); st.delete(uKey("bakdir")); return new Promise(res=>{ tx.oncomplete=()=>{ db.close(); res(); }; }); }catch(e){} }
function backupJSONString(){ return JSON.stringify(Object.assign({ app:"Flipdeck", version:"3.0", exportedAt:new Date().toISOString() }, { flips, inventory, fixed, fixcfg:fixCfg, shipcfg:shipCfg, calcs:(typeof calcs!=="undefined"?calcs:[]) }), null, 2); }
async function writeBackupToDir(dir){ const name=`flipdeck-backup-${new Date().toISOString().slice(0,10)}.json`;
  const fh=await dir.getFileHandle(name,{create:true}); const w=await fh.createWritable(); await w.write(backupJSONString()); await w.close();
  Store.set(uKey("lastautofile"), new Date().toISOString()); Store.set("fg_lastdl", new Date().toISOString()); }
async function setupAutoFileBackup(){
  if(!FSA_SUPPORTED){ downloadFullBackup(); return; }
  try{ const dir=await window.showDirectoryPicker({mode:"readwrite", id:"flipdeck-backups"});
    await saveBackupDirHandle(dir); await writeBackupToDir(dir);
    showToast("✓ Automatische Datei-Backups aktiv"); renderBackupList();
  }catch(e){ if(e && e.name!=="AbortError"){ console.warn("[autofile setup]", e); showToast("Ordner konnte nicht gesetzt werden"); } }
}
async function disableAutoFileBackup(){ await clearBackupDirHandle(); showToast("Automatische Datei-Backups deaktiviert"); renderBackupList(); }
async function reauthAutoFileBackup(){ const dir=await getBackupDirHandle(); if(!dir) return;
  try{ const p=await dir.requestPermission({mode:"readwrite"}); if(p==="granted"){ await writeBackupToDir(dir); showToast("✓ Wieder aktiv & gesichert"); renderBackupList(); } }catch(e){} }
/* Einfaches, verlässliches Wochen-Backup: lädt 1×/Woche automatisch eine Datei herunter
   (im Browser lautlos in den Downloads-Ordner). Kein Ordner-Zugriff, keine Rechte-Rückfragen. */
function maybeAutoWeeklyDownload(){
  if(Store.get(uKey("autodl"))!=="1") return;   // Standard AUS — nur wenn bewusst aktiviert (kein aufdringlicher Download bei Login)
  const last=Store.get(uKey("lastautofile")); const days=last?Math.floor((Date.now()-new Date(last).getTime())/86400000):999;
  if(days<7) return;
  try{ downloadFullBackup(); Store.set(uKey("lastautofile"), new Date().toISOString()); }catch(e){ console.warn("[autodl]", e); }
}
function renderAutoFileStatus(){
  const box=$("#autofile-status"); if(!box) return;
  const on = Store.get(uKey("autodl"))==="1";   // Standard: AUS (opt-in)
  const last=Store.get(uKey("lastautofile")); const when=last?new Date(last).toLocaleDateString("de-DE",{day:"numeric",month:"short"}):"noch nie";
  box.innerHTML=`<button type="button" id="autodl-toggle" class="pw-toggle" aria-pressed="${on?"true":"false"}" style="width:100%">
      <span class="pw-toggle-info"><span class="pw-toggle-name">Automatisches Wochen-Backup <span class="c-sub" style="font-weight:400">(optional)</span></span><span class="pw-toggle-set">Wenn an: speichert 1×/Woche automatisch eine Backup-Datei in den Downloads. Zuletzt: ${when}.</span></span><span class="pw-sw"></span>
    </button>
    <p class="c-sub text-[11.5px] leading-relaxed mt-2">Standardmäßig <b>aus</b> — deine Daten sind ohnehin automatisch in der Cloud + über Wiederherstellungs-Punkte gesichert. Nur einschalten, wenn du zusätzlich eine Datei-Kopie im Downloads-Ordner (z. B. mit OneDrive/iCloud off-site) willst.</p>`;
  const t=$("#autodl-toggle"); if(t) t.addEventListener("click",()=>{ const nv=Store.get(uKey("autodl"))==="1"?"0":"1"; Store.set(uKey("autodl"),nv); renderAutoFileStatus(); showToast(nv==="1"?"Automatisches Wochen-Backup an":"Automatisches Wochen-Backup aus"); });
}

/* ===== Erst-Login-Tour: kurze, überspringbare Führung durch die essenziellen Funktionen ===== */
const TOUR_STEPS = [
  { title:"Willkommen bei Flipdeck 👋", body:"Eine 30-Sekunden-Tour durch das Wichtigste. Du kannst jederzeit überspringen — und die Tour später über das Profil-Menü erneut starten." },
  { sel:'#tabs', title:"Deine Navigation", body:"Oben wechselst du zwischen Übersicht, Tracker, Bestand, Fixkosten, Auswertung und dem Passwort-Generator." },
  { tab:"inventory", sel:'#tabs button[data-tab="inventory"]', title:"Bestand — dein Herzstück", body:"Hier legst du Einkäufe an und trägst später Verkäufe ein. Optional pro Artikel: Einkaufsplattform (mit Retourenfrist) und Zahlungsmethode." },
  { tab:"dashboard", sel:'#dash-customize', title:"Dashboard anpassen", body:"Über den Anpassen-Knopf blendest du Karten ein/aus und ordnest sie per Drag & Drop — dein Cockpit, wie du es brauchst." },
  { sel:'#profile-btn', title:"Alle Einstellungen", body:"Oben rechts (Profil) sitzt der Einstellungs-Hub: Steuerart, Marktplätze, Zahlungsmethoden, Dashboard und Daten/Backup." },
  { tab:"profil", scat:"geschaeft", sel:'.settings-navi[data-scat="geschaeft"]', title:"Steuerart festlegen", body:"Unter Geschäft stellst du Privat/Gewerblich & MwSt. ein — wichtig für korrekte Gewinne. Einmal einstellen, fertig." },
  { tab:"profil", scat:"daten", sel:'#autofile-status', title:"Backup einrichten (wichtig!)", body:"Richte hier die automatische Datei-Sicherung ein: einmal einen Cloud-Ordner (OneDrive/iCloud) wählen — dann sichert Flipdeck wöchentlich von allein. Die einzige Sicherung, falls die Cloud mal ausfällt." }
];
let _tourActive=false, _tourIdx=0, _tourHole=null, _tourTip=null, _tourReposition=null;
function startTour(){ if(_tourActive) return; _tourActive=true; _tourIdx=0;
  _tourHole=document.createElement("div"); _tourHole.className="tour-hole"; document.body.appendChild(_tourHole);
  _tourTip=document.createElement("div"); _tourTip.className="tour-tip"; document.body.appendChild(_tourTip);
  _tourReposition=()=>positionTour(); window.addEventListener("resize",_tourReposition); window.addEventListener("scroll",_tourReposition,true);
  showTourStep(); }
function endTour(){ _tourActive=false; try{ Store.set(uKey("tourdone"),"1"); }catch(e){}
  try{ if(typeof DB!=="undefined" && DB.saveTaxCfg) DB.saveTaxCfg({ kuMode, defaultUstRate, defaultPlatform, onboarded:true, tourDone:true }); }catch(e){}  // kontoweit merken -> nie wieder auf irgendeinem Gerät
  if(_tourHole&&_tourHole.parentNode) _tourHole.remove(); if(_tourTip&&_tourTip.parentNode) _tourTip.remove();
  if(_tourReposition){ window.removeEventListener("resize",_tourReposition); window.removeEventListener("scroll",_tourReposition,true); _tourReposition=null; } }
function showTourStep(){ const step=TOUR_STEPS[_tourIdx]; if(!step){ endTour(); return; }
  if(step.tab && typeof setTab==="function"){ try{ setTab(step.tab); }catch(e){} }
  if(step.scat && typeof setSettingsCat==="function"){ try{ setSettingsCat(step.scat); }catch(e){} }
  const delay=(step.tab||step.scat)?300:40;
  setTimeout(()=>{ renderTourTip(step); const el=step.sel?document.querySelector(step.sel):null; if(el){ try{ el.scrollIntoView({behavior:"smooth",block:"center"}); }catch(e){} } setTimeout(positionTour,70); setTimeout(positionTour,430); }, delay); }
function renderTourTip(step){ if(!_tourTip) return; const last=_tourIdx===TOUR_STEPS.length-1;
  const dots=TOUR_STEPS.map((_,i)=>`<span class="tour-dot${i===_tourIdx?" on":""}"></span>`).join("");
  _tourTip.innerHTML=`<h4 class="tour-h">${escapeHtml(step.title)}</h4><p class="tour-p">${step.body}</p>
    <div class="tour-actions"><div class="tour-dots">${dots}</div>
    <div style="display:flex;gap:8px;flex:0 0 auto">${_tourIdx>0?`<button class="btn-ghost" data-tour="back" style="padding:7px 12px;font-size:13px">Zurück</button>`:`<button class="btn-ghost" data-tour="skip" style="padding:7px 12px;font-size:13px">Überspringen</button>`}<button class="btn-accent" data-tour="next" style="padding:7px 15px;font-size:13px">${last?"Fertig ✓":"Weiter"}</button></div></div>`;
  _tourTip.querySelectorAll("[data-tour]").forEach(b=>b.addEventListener("click",()=>{ const a=b.getAttribute("data-tour");
    if(a==="skip") endTour(); else if(a==="back"){ _tourIdx=Math.max(0,_tourIdx-1); showTourStep(); } else { if(last) endTour(); else { _tourIdx++; showTourStep(); } } })); }
function positionTour(){ if(!_tourActive||!_tourTip) return; const step=TOUR_STEPS[_tourIdx]; const el=step&&step.sel?document.querySelector(step.sel):null;
  const r=el?el.getBoundingClientRect():null;
  if(r && (r.width>0||r.height>0)){ const pad=8; _tourHole.style.display="block";
    _tourHole.style.left=(r.left-pad)+"px"; _tourHole.style.top=(r.top-pad)+"px"; _tourHole.style.width=(r.width+pad*2)+"px"; _tourHole.style.height=(r.height+pad*2)+"px";
    const tipW=_tourTip.offsetWidth||320, tipH=_tourTip.offsetHeight||170;
    let top=r.bottom+12; if(top+tipH>innerHeight-12) top=Math.max(12, r.top-tipH-12);
    let left=Math.min(Math.max(12, r.left+r.width/2-tipW/2), innerWidth-tipW-12);
    _tourTip.style.transform=""; _tourTip.style.left=left+"px"; _tourTip.style.top=top+"px";
  } else { _tourHole.style.display="none"; _tourTip.style.left="50%"; _tourTip.style.top="50%"; _tourTip.style.transform="translate(-50%,-50%)"; } }
function startTourIfNew(){ if(_tourActive) return;
  try{ if(Store.get(uKey("tourdone"))==="1") return; }catch(e){}
  if(taxCfg && taxCfg.tourDone) return;   // konto-weit schon gesehen -> nie wieder, auch auf neuem Gerät
  setTimeout(()=>{ if(_tourActive) return; const mr=$("#modal-root"); if(mr && mr.firstChild) return; startTour(); }, 800); }
if($("#menu-tour")) $("#menu-tour").addEventListener("click",()=>{ if($("#profile-menu")) $("#profile-menu").classList.add("hidden"); if($("#profile-btn")) $("#profile-btn").setAttribute("aria-expanded","false"); startTour(); });

function renderBackupList(){
  if(typeof renderAutoFileStatus==="function") renderAutoFileStatus();
  const box=$("#backup-list"); if(!box) return;
  const items = [
    ...((cloudBackups||[]).map(s=>({snap:s, src:"cloud"}))),
    ...(loadAutoBackups().map(s=>({snap:s, src:"device"})))
  ].sort((a,b)=>new Date(b.snap.ts)-new Date(a.snap.ts));
  window._bakItems = items;

  // Erinnerung an eine Datei-Sicherung (die einzige Ebene außerhalb von Supabase)
  const lastDl = Store.get("fg_lastdl");
  const days = lastDl ? Math.floor((Date.now()-new Date(lastDl).getTime())/86400000) : null;
  const remind = (days===null || days>=14);
  const reminder = remind
    ? `<div class="rounded-[12px] px-3 py-3 mb-3" style="background:var(--danger-soft);border:1px solid color-mix(in srgb,var(--danger) 40%,var(--line))">
         <p class="text-[12.5px] font-semibold" style="color:var(--danger)">⏱ Datei-Sicherung empfohlen</p>
         <p class="c-sub text-[11.5px] mt-0.5 leading-relaxed">Letzte Datei-Sicherung: <b>${lastDl?`vor ${days} Tag(en)`:"noch nie"}</b>. Eine heruntergeladene Datei ist deine einzige Sicherung <b>außerhalb</b> von Supabase.</p>
         <button id="bak-fulldl" class="btn-accent" style="margin-top:8px;padding:8px 14px;font-size:12.5px">Jetzt Voll-Backup herunterladen</button>
       </div>`
    : `<div class="flex items-center justify-between gap-2 mb-3"><p class="c-sub text-[11.5px]">Letzte Datei-Sicherung vor ${days} Tag(en).</p><button id="bak-fulldl" class="btn-ghost" style="padding:6px 11px;font-size:12px">Datei-Backup</button></div>`;

  const rows = items.length ? items.map((it,i)=>{
    const s=it.snap, when=new Date(s.ts).toLocaleString("de-DE",{day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit"});
    const n=(s.flips||[]).length, m=(s.inventory||[]).length;
    const badge = it.src==="cloud"
      ? `<span class="pill pill-blue" style="flex:0 0 auto">☁ Cloud</span>`
      : `<span class="pill pill-mut" style="flex:0 0 auto">Gerät</span>`;
    return `<div class="flex items-center gap-2 rounded-[12px] px-3 py-2.5" style="background:var(--cell-2);border:1px solid var(--line)">
      ${badge}
      <div class="min-w-0 flex-1"><p class="text-[13px] font-semibold">${when}</p><p class="c-sub text-[11px] mt-0.5">${n} Verkäufe · ${m} Bestand</p></div>
      <button class="btn-ghost bak-restore" data-i="${i}" style="flex:0 0 auto;padding:7px 11px;font-size:12px">Wiederherstellen</button>
      <button class="btn-ghost bak-dl" data-i="${i}" style="flex:0 0 auto;padding:7px 10px;font-size:12px" title="Als Datei laden">↓</button>
    </div>`;
  }).join("") : `<p class="c-sub text-[12.5px]">Noch keine automatische Sicherung – wird beim nächsten Tageswechsel angelegt.</p>`;

  box.innerHTML = reminder + `<div class="flex flex-col gap-2">${rows}</div>`;
  if($("#bak-fulldl")) $("#bak-fulldl").addEventListener("click", downloadFullBackup);
  $$("#backup-list .bak-restore").forEach(b=>b.addEventListener("click",()=>{ const it=(window._bakItems||[])[+b.dataset.i]; if(it) openImportModal(it.snap); }));
  $$("#backup-list .bak-dl").forEach(b=>b.addEventListener("click",()=>{ const it=(window._bakItems||[])[+b.dataset.i]; if(it) downloadFile(`flipdeck-backup-${it.snap.day}.json`, JSON.stringify(it.snap,null,2), "application/json"); }));
}

/* ===== Wiederherstellungs-Punkte (Snapshots) · dauerhaft in Supabase 'snapshots' =====
   Feineres Netz oberhalb der Tages-Backups: erfasst den GESAMTEN Datenstand bei
   Änderungen (gedrosselt, max. alle 10 Min.) sowie auf Knopfdruck — geräteübergreifend,
   überlebt Neuladen (anders als der In-Memory-Undo), mit Restore. Nutzt _snapState()
   und _applySnapshot() aus dem Undo-System. */
const SNAP_KEEP = 25;
const SNAP_MIN_GAP = 10*60*1000;
let _snapLastAt = 0, _snapTimer = null, _snapMissing = false;
function snapSetupSQL(){ return `-- In Supabase: SQL Editor -> New query -> einfügen -> RUN
create table if not exists public.snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  taken_at timestamptz not null default now(),
  kind text not null default 'auto',
  label text,
  payload jsonb not null
);
alter table public.snapshots enable row level security;
create policy "snap_self_all" on public.snapshots for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
create index if not exists snapshots_user_time on public.snapshots (user_id, taken_at desc);`; }
function _snapTableMissing(err){ return /relation|does not exist|schema cache|not find the table/i.test(((err&&err.message)||'')+''); }
async function snapInit(){ if(!currentUser||!currentUser.id) return;
  try{ const { data, error } = await sb.from('snapshots').select('taken_at').eq('user_id',currentUser.id).order('taken_at',{ascending:false}).limit(1);
    if(error){ _snapMissing=_snapTableMissing(error); return; }
    _snapMissing=false; if(data&&data.length) _snapLastAt=Date.parse(data[0].taken_at)||0; }catch(e){} }
async function snapCreate(kind,label){ if(!currentUser||!currentUser.id||_snapMissing) return false;
  let payload; try{ payload=JSON.parse(_snapState()); }catch(e){ return false; }
  const { error } = await sb.from('snapshots').insert({ user_id:currentUser.id, kind:kind||'auto', label:label||null, payload });
  if(error){ if(_snapTableMissing(error)) _snapMissing=true; else console.warn('[snap create]',error.message); return false; }
  _snapLastAt=Date.now(); snapPrune(); return true; }
async function snapPrune(){ try{ const { data } = await sb.from('snapshots').select('id').eq('user_id',currentUser.id).order('taken_at',{ascending:false});
  if(data && data.length>SNAP_KEEP){ const del=data.slice(SNAP_KEEP).map(r=>r.id); await sb.from('snapshots').delete().in('id',del); } }catch(e){} }
async function snapListAll(){ const { data, error } = await sb.from('snapshots').select('id,taken_at,kind,label').eq('user_id',currentUser.id).order('taken_at',{ascending:false}); if(error) throw error; return data||[]; }
async function snapGetPayload(id){ const { data, error } = await sb.from('snapshots').select('payload').eq('id',id).maybeSingle(); if(error) throw error; return data?data.payload:null; }
async function snapDelete(id){ return sb.from('snapshots').delete().eq('id',id); }
function maybeAutoSnapshot(){ if(_restoring||_snapMissing||!currentUser||!currentUser.id) return;
  if(Date.now()-_snapLastAt < SNAP_MIN_GAP) return;
  clearTimeout(_snapTimer); _snapTimer=setTimeout(()=>{ snapCreate('auto').then(ok=>{ if(ok && document.querySelector('.settings-panel[data-spanel="daten"]:not(.hidden)')) renderSnapshots(); }); }, 8000); }
async function snapRestore(id){
  await snapCreate('manual','Automatisch vor Wiederherstellung');   // Sicherheitsnetz — auch das Zurücksetzen ist umkehrbar
  let payload; try{ payload=await snapGetPayload(id); }catch(e){ showToast('Konnte Punkt nicht laden'); return; }
  if(!payload){ showToast('Punkt nicht gefunden'); return; }
  const str = typeof payload==='string' ? payload : JSON.stringify(payload);
  _applySnapshot(str, _snapState());
  showToast('✓ Stand wiederhergestellt'); renderSnapshots(); }
function snapRestoreConfirm(id, dlabel){
  $("#modal-root").innerHTML=`<div class="overlay" id="ov"><div class="modal" style="max-width:410px">
    <p class="font-bold text-[17px] mb-1">Auf diesen Stand zurück?</p>
    <p class="c-sub text-[13px] leading-relaxed mb-4">Dein aktueller Stand wird durch den Punkt vom <b>${escapeHtml(dlabel)}</b> ersetzt. Zur Sicherheit wird vorher automatisch ein Punkt „vor Wiederherstellung" angelegt — du kannst es also jederzeit rückgängig machen.</p>
    <div class="grid grid-cols-2 gap-3"><button id="snr-cancel" class="btn-ghost">Abbrechen</button><button id="snr-ok" class="btn-accent">Wiederherstellen</button></div>
  </div></div>`;
  $("#snr-cancel").addEventListener("click",()=>$("#modal-root").innerHTML="");
  $("#snr-ok").addEventListener("click",async()=>{ $("#snr-ok").textContent="Stelle her…"; $("#snr-ok").disabled=true; await snapRestore(id); $("#modal-root").innerHTML=""; }); }
function snapSetupHint(){ const box=$("#snap-setup"); if(!box) return; const sql=snapSetupSQL();
  box.classList.remove("hidden");
  if(!(currentUser && currentUser.role==="owner")){ box.innerHTML=`<p class="c-sub text-[12px] leading-relaxed mt-1">Wiederherstellungs-Punkte werden serverseitig vorbereitet.</p>`; return; }
  box.innerHTML=`<div class="rounded-[14px] p-3.5 mt-1" style="background:var(--cell-2);border:1px solid var(--line)">
    <p class="text-[13px] font-semibold mb-1">Einrichtung nötig</p>
    <p class="c-sub text-[12px] leading-relaxed mb-2">Für dauerhafte Wiederherstellungs-Punkte lege einmalig die <span class="mono">snapshots</span>-Tabelle in Supabase an. SQL kopieren, im <span class="mono">SQL Editor</span> ausführen, dann neu laden.</p>
    <button id="snap-sql-copy" class="btn-ghost w-full" style="margin-bottom:8px">SQL kopieren</button>
    <pre class="mono" style="font-size:10.5px;line-height:1.5;white-space:pre-wrap;word-break:break-word;max-height:150px;overflow:auto;color:var(--sub);background:var(--cell);border:1px solid var(--line);border-radius:10px;padding:10px">${escapeHtml(sql)}</pre></div>`;
  const cp=$("#snap-sql-copy"); if(cp) cp.addEventListener("click",async()=>{ try{ await navigator.clipboard.writeText(sql); showToast("✓ SQL kopiert"); }catch(e){ showToast("Kopieren nicht möglich"); } }); }
async function renderSnapshots(){
  const box=$("#snap-list"); if(!box) return;
  if(_snapMissing){ box.innerHTML=""; snapSetupHint(); return; }
  box.innerHTML=`<p class="c-sub text-[13px]">Lade…</p>`;
  let list; try{ list=await snapListAll(); }
  catch(e){ if(_snapTableMissing(e)){ _snapMissing=true; box.innerHTML=""; snapSetupHint(); return; } box.innerHTML=`<p class="c-sub text-[13px]">Konnte Punkte nicht laden.</p>`; return; }
  const setup=$("#snap-setup"); if(setup){ setup.classList.add("hidden"); setup.innerHTML=""; }
  if(!list.length){ box.innerHTML=`<p class="c-sub text-[13px]">Noch keine Punkte — sobald du etwas änderst, entsteht automatisch einer.</p>`; return; }
  box.innerHTML="";
  list.forEach(s=>{ const d=new Date(s.taken_at).toLocaleString("de-DE",{day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit"}); const manual=s.kind==="manual";
    const el=document.createElement("div"); el.className="flex items-center justify-between gap-2 rounded-[13px] p-3"; el.style.cssText="background:var(--cell-2);border:1px solid var(--line)";
    el.innerHTML=`<div class="min-w-0"><div class="flex items-center gap-2"><span class="font-semibold text-[13.5px]">${d}</span>${manual?`<span class="pill pill-accent">manuell</span>`:`<span class="pill pill-mut">auto</span>`}</div>${s.label?`<p class="c-sub text-[11.5px] mt-0.5 truncate">${escapeHtml(s.label)}</p>`:""}</div>
      <div class="flex items-center gap-2" style="flex:0 0 auto"><button class="btn-ghost snap-restore" data-id="${s.id}" data-d="${attrEsc(d)}" style="padding:6px 11px;font-size:12px">Wiederherstellen</button><button class="iconbtn danger snap-del" data-id="${s.id}" title="Löschen">${icoTrash}</button></div>`;
    box.appendChild(el); });
  $$("#snap-list .snap-restore").forEach(b=>b.addEventListener("click",()=>snapRestoreConfirm(b.dataset.id, b.dataset.d)));
  $$("#snap-list .snap-del").forEach(b=>b.addEventListener("click",async()=>{ b.disabled=true; try{ await snapDelete(b.dataset.id); renderSnapshots(); }catch(e){ showToast("Konnte nicht löschen"); b.disabled=false; } }));
}
function renderInvFormatStatus(){ const box=$("#inv-format-status"); if(!box) return;
  const line=(label,mode)=> mode==='rows'
    ? `<div class="flex items-center gap-2 mb-2"><span class="pill pill-accent">⚡ Schnell</span><span class="text-[13.5px]">${label} · Zeilen-Format</span></div>`
    : `<div class="flex items-center gap-2 mb-2"><span class="pill pill-mut">Klassisch</span><span class="text-[13.5px]">${label} · ein Block</span></div>`;
  let html = line('Inventar', _invMode) + line('Verkäufe', _flipMode);
  const anyBlob = _invMode!=='rows' || _flipMode!=='rows';
  const owner = currentUser && currentUser.role==="owner";
  if(anyBlob && owner){
    const sql = invSetupSQL()+"\n\n"+flipSetupSQL();
    html += `<p class="c-sub text-[12.5px] leading-relaxed mt-2 mb-3">Für sehr große Bestände/Verkaufslisten (ab ~5.000 Einträgen) gibt es ein schnelleres <b>Zeilen-Format</b>. Optional: die Tabellen anlegen, dann stellt Flipdeck beim nächsten Laden <b>automatisch</b> um — deine Daten bleiben 1:1 unverändert. Die SQL ist gefahrlos mehrfach ausführbar.</p>
      <button id="inv-sql-copy" class="btn-ghost w-full" style="margin-bottom:8px">SQL für schnelles Format kopieren</button>
      <pre class="mono" style="font-size:10.5px;line-height:1.5;white-space:pre-wrap;word-break:break-word;max-height:170px;overflow:auto;color:var(--sub);background:var(--cell);border:1px solid var(--line);border-radius:10px;padding:10px">${escapeHtml(sql)}</pre>`;
  } else if(anyBlob){
    html += `<p class="c-sub text-[12.5px] leading-relaxed mt-2">Klassisches Format — für normale Bestände völlig ausreichend und schnell.</p>`;
  } else {
    html += `<p class="c-sub text-[12.5px] leading-relaxed mt-2">Beides im schnellen Zeilen-Format — jede Änderung schreibt nur den betroffenen Eintrag, nicht die ganze Liste. Skaliert mühelos.</p>`;
  }
  box.innerHTML=html;
  const cp=$("#inv-sql-copy"); if(cp) cp.addEventListener("click",async()=>{ try{ await navigator.clipboard.writeText(invSetupSQL()+"\n\n"+flipSetupSQL()); showToast("✓ SQL kopiert"); }catch(e){ showToast("Kopieren nicht möglich"); } });
}
if($("#snap-now")) $("#snap-now").addEventListener("click",async()=>{ const btn=$("#snap-now"); btn.disabled=true; const ol=btn.textContent; btn.textContent="Sichere…";
  const ok=await snapCreate('manual','Manuell gesichert'); btn.disabled=false; btn.textContent=ol;
  if(ok){ showToast("✓ Wiederherstellungs-Punkt gesichert"); renderSnapshots(); } else if(_snapMissing){ renderSnapshots(); } else showToast("Konnte nicht sichern"); });

/* ===== Bilder-Migration: Base64 -> Storage ===== */
function countBase64Images(){
  const set = new Set();
  inventory.forEach(it=>{ if(isDataUrl(it.img)) set.add(it.img); });
  flips.forEach(f=>{ if(isDataUrl(f.img)) set.add(f.img); });
  return set;
}
function refreshImgMigStat(){
  const el = $("#img-mig-stat"); if(!el) return;
  const set = countBase64Images();
  if(!set.size){ el.innerHTML = `<b style="color:var(--accent)">Alles ausgelagert.</b>`; return; }
  const bytes = [...set].reduce((s,d)=>s+d.length*0.75, 0);
  el.innerHTML = `<b>${set.size}</b> Bild(er) liegen noch in der Datenbank (~${(bytes/1048576).toFixed(1)} MB).`;
}

$("#img-migrate").addEventListener("click", async ()=>{
  const set = countBase64Images();
  if(!set.size){ showToast("Es liegen keine Bilder mehr in der Datenbank"); return; }

  const btn=$("#img-migrate"), bar=$("#img-mig-bar"), fill=$("#img-mig-fill");
  btn.disabled = true; bar.classList.remove("hidden");
  const list = [...set];
  const map = new Map();               // Base64 -> URL (dedupliziert)
  let done = 0, failed = 0;

  for(const src of list){
    try { map.set(src, await uploadImage(src)); }
    catch(e){ failed++; console.warn("[img migrate]", e.message); }
    done++;
    fill.style.width = Math.round(done/list.length*100) + "%";
    btn.textContent = `Lade hoch… ${done}/${list.length}`;
  }

  if(map.size){
    inventory.forEach(it=>{ if(map.has(it.img)) it.img = map.get(it.img); });
    flips.forEach(f=>{ if(map.has(f.img)) f.img = map.get(f.img); });
    await Promise.all([ DB.saveInventory(inventory), DB.saveFlips(flips) ]);
  }

  btn.disabled = false;
  btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12M8 11l4 4 4-4"/><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/></svg>Bilder in den Storage verschieben`;
  bar.classList.add("hidden"); fill.style.width = "0%";
  refreshImgMigStat(); renderInventory(); renderDashboard();

  if(failed) showToast(`⚠ ${map.size} verschoben, ${failed} fehlgeschlagen — Bucket vorhanden?`);
  else showToast(`✓ ${map.size} Bild(er) in den Storage verschoben`);
});

/* ===== Verlinkte (externe) Bilder -> eigener Storage =====
   Produktbilder, die nur als http(s)-Link an fremden Servern (eBay …) hängen,
   werden geladen und in den eigenen Bucket kopiert, damit sie erhalten bleiben.
   CORS-gesperrte Quellen lassen sich nicht kopieren -> werden übersprungen. */
function isOwnStorageUrl(u){ return typeof u==="string" && u.indexOf(SUPABASE_URL+"/storage/v1/object/")===0; }
function isExternalImg(u){ return typeof u==="string" && /^https?:\/\//i.test(u) && !isOwnStorageUrl(u); }
function countLinkedImages(){
  const set=new Set();
  inventory.forEach(it=>{ if(isExternalImg(it.img)) set.add(it.img); });
  flips.forEach(f=>{ if(isExternalImg(f.img)) set.add(f.img); });
  return set;
}
function refreshLinkMigStat(){
  const el=$("#link-mig-stat"); if(!el) return;
  const set=countLinkedImages();
  el.innerHTML = set.size
    ? `<b>${set.size}</b> Bild(er) hängen noch an fremden Servern.`
    : `<b style="color:var(--accent)">Keine externen Links.</b>`;
}
/* Externes Bild via <img crossOrigin> + Canvas in eine Data-URL wandeln.
   Scheitert (CORS/Netz) -> reject; der Aufrufer überspringt das Bild. */
function fetchImageAsDataUrl(url, max){
  max = max || 800;
  return new Promise((resolve,reject)=>{
    const img=new Image(); img.crossOrigin="anonymous";
    img.onload=()=>{ try{
      const s=Math.min(1, max/Math.max(img.width,img.height));
      const c=document.createElement("canvas");
      c.width=Math.max(1,Math.round(img.width*s)); c.height=Math.max(1,Math.round(img.height*s));
      c.getContext("2d").drawImage(img,0,0,c.width,c.height);
      resolve(c.toDataURL("image/jpeg",0.85));
    }catch(e){ reject(e); } };
    img.onerror=()=>reject(new Error("Bild nicht ladbar (CORS/Netz)"));
    img.src=url;
  });
}
$("#link-migrate").addEventListener("click", async ()=>{
  const set=countLinkedImages();
  if(!set.size){ showToast("Keine verlinkten Bilder gefunden"); return; }

  const btn=$("#link-migrate"), bar=$("#link-mig-bar"), fill=$("#link-mig-fill");
  btn.disabled=true; bar.classList.remove("hidden");
  const list=[...set]; const map=new Map(); let done=0, failed=0;

  for(const src of list){
    try { const dataUrl=await fetchImageAsDataUrl(src); map.set(src, await uploadImage(dataUrl)); }
    catch(e){ failed++; console.warn("[link migrate]", src, e && e.message); }
    done++;
    fill.style.width = Math.round(done/list.length*100) + "%";
    btn.textContent = `Kopiere… ${done}/${list.length}`;
  }

  if(map.size){
    inventory.forEach(it=>{ if(map.has(it.img)) it.img = map.get(it.img); });
    flips.forEach(f=>{ if(map.has(f.img)) f.img = map.get(f.img); });
    await Promise.all([ DB.saveInventory(inventory), DB.saveFlips(flips) ]);
  }

  btn.disabled=false;
  btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 15V4a2 2 0 0 1 2-2h9l5 5v8a2 2 0 0 1-2 2H10"/><path d="M9 22l-4-4 4-4M5 18h8"/></svg>Verlinkte Bilder in den Storage kopieren`;
  bar.classList.add("hidden"); fill.style.width="0%";
  refreshLinkMigStat(); renderInventory(); renderDashboard();

  if(failed && !map.size) showToast(`Keins kopierbar — ${failed} übersprungen (CORS/Netz)`);
  else if(failed)         showToast(`✓ ${map.size} kopiert · ${failed} übersprungen (CORS/Netz)`);
  else                    showToast(`✓ ${map.size} Bild(er) in den Storage kopiert`);
});

/* ===== Bild-Sicherung automatisch im Hintergrund (kein Menü-Klick nötig) =====
   Läuft gedrosselt beim Start: verschiebt Datenbank-Bilder in den Storage und
   sichert verlinkte Fremd-Bilder. Pro Lauf gedeckelt, damit nichts ruckelt.
   Fehlt der Bucket (alles scheitert), wird 7 Tage pausiert – kein Spam. */
async function autoMigrateImages(){
  const set=(typeof countBase64Images==="function")?countBase64Images():new Set(); if(!set.size) return {moved:0,failed:0};
  const list=[...set].slice(0,40), map=new Map(); let moved=0, failed=0;
  for(const src of list){ try{ map.set(src, await uploadImage(src)); moved++; }catch(e){ failed++; } }
  if(map.size){ inventory.forEach(it=>{ if(map.has(it.img)) it.img=map.get(it.img); }); flips.forEach(f=>{ if(map.has(f.img)) f.img=map.get(f.img); }); await Promise.all([DB.saveInventory(inventory), DB.saveFlips(flips)]); }
  if(typeof refreshImgMigStat==="function") refreshImgMigStat();
  return {moved, failed};
}
async function autoMigrateLinked(){
  const set=(typeof countLinkedImages==="function")?countLinkedImages():new Set(); if(!set.size) return {moved:0,failed:0};
  const list=[...set].slice(0,25), map=new Map(); let moved=0, failed=0;
  for(const src of list){ try{ const d=await fetchImageAsDataUrl(src); map.set(src, await uploadImage(d)); moved++; }catch(e){ failed++; } }
  if(map.size){ inventory.forEach(it=>{ if(map.has(it.img)) it.img=map.get(it.img); }); flips.forEach(f=>{ if(map.has(f.img)) f.img=map.get(f.img); }); await Promise.all([DB.saveInventory(inventory), DB.saveFlips(flips)]); }
  if(typeof refreshLinkMigStat==="function") refreshLinkMigStat();
  return {moved, failed};
}
function maybeAutoMigrate(){
  try{
    const now=Date.now(); const gi=k=>parseInt(Store.get(uKey(k))||"0")||0;
    if(now>gi("automig_img_backoff") && now-gi("automig_img")>20*3600*1000 && typeof countBase64Images==="function" && countBase64Images().size){
      autoMigrateImages().then(r=>{ Store.set(uKey("automig_img"), String(Date.now()));
        if(r.moved){ renderInventory(); renderDashboard(); showToast(`✓ ${r.moved} Bild(er) automatisch gesichert`); }
        else if(r.failed){ Store.set(uKey("automig_img_backoff"), String(Date.now()+7*86400000)); }
      }).catch(()=>{});
    }
    if(now-gi("automig_link")>3*86400*1000 && typeof countLinkedImages==="function" && countLinkedImages().size){
      autoMigrateLinked().then(r=>{ Store.set(uKey("automig_link"), String(Date.now()));
        if(r.moved){ renderInventory(); renderDashboard(); showToast(`✓ ${r.moved} verlinkte Bild(er) gesichert`); }
      }).catch(()=>{});
    }
  }catch(e){ console.warn("[automig]", e); }
}

/* ===== Backup einspielen ===== */
$("#rp-import").addEventListener("click", ()=> $("#rp-import-input").click());
$("#rp-import-input").addEventListener("change", e=>{
  const f = e.target.files[0]; e.target.value = "";
  if(!f) return;
  const r = new FileReader();
  r.onload = () => {
    let d;
    try { d = JSON.parse(r.result); }
    catch(err){ showToast("✗ Datei ist kein gültiges JSON"); return; }
    openImportModal(d);
  };
  r.onerror = () => showToast("✗ Datei konnte nicht gelesen werden");
  r.readAsText(f);
});

/* ===== CSV-Import: Verkäufe aus eBay/Excel/anderen Tools übernehmen ===== */
function impNum(s){ if(s==null) return 0; s=String(s).replace(/[^\d.,\-]/g,"").trim(); if(!s) return 0;
  const hasC=s.includes(","), hasD=s.includes(".");
  if(hasC&&hasD){ if(s.lastIndexOf(",")>s.lastIndexOf(".")) s=s.replace(/\./g,"").replace(",","."); else s=s.replace(/,/g,""); }
  else if(hasC) s=s.replace(",",".");
  const n=parseFloat(s); return isFinite(n)?n:0; }
function csvDate(s){ s=String(s||"").trim(); if(!s) return null; let m;
  if(m=s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)) return `${m[1]}-${m[2].padStart(2,"0")}-${m[3].padStart(2,"0")}`;
  if(m=s.match(/^(\d{1,2})[.\/](\d{1,2})[.\/](\d{2,4})/)){ let y=m[3]; if(y.length===2) y="20"+y; return `${y}-${m[2].padStart(2,"0")}-${m[1].padStart(2,"0")}`; }
  const d=new Date(s); return isNaN(d)?null:d.toISOString().slice(0,10); }
function csvPlatform(s){ s=String(s||"").trim().toLowerCase(); if(!s) return "kein";
  for(const k of Object.keys(PLATFORMS)){ const lbl=(PLATFORMS[k].label||"").toLowerCase(); if(k.toLowerCase()===s||lbl===s) return k; }
  for(const k of Object.keys(PLATFORMS)){ const lbl=(PLATFORMS[k].label||"").toLowerCase(); if(s&&(lbl.includes(s)||s.includes(k.toLowerCase()))) return k; }
  return "kein"; }
function parseCSV(text){ text=String(text||"").replace(/^﻿/,"");
  const firstLine=(text.split(/\r?\n/).find(l=>l.trim())||"");
  const cS=(firstLine.match(/;/g)||[]).length, cC=(firstLine.match(/,/g)||[]).length, cT=(firstLine.match(/\t/g)||[]).length;
  let delim=";"; if(cT>=cS&&cT>=cC&&cT>0) delim="\t"; else if(cC>cS) delim=","; else if(cS===0) delim=(cC>0?",":";");
  const rows=[]; let row=[], field="", inQ=false;
  for(let i=0;i<text.length;i++){ const c=text[i];
    if(inQ){ if(c==='"'){ if(text[i+1]==='"'){ field+='"'; i++; } else inQ=false; } else field+=c; }
    else if(c==='"') inQ=true;
    else if(c===delim){ row.push(field); field=""; }
    else if(c==='\n'){ row.push(field); rows.push(row); row=[]; field=""; }
    else if(c!=='\r') field+=c; }
  if(field.length||row.length){ row.push(field); rows.push(row); }
  return rows.map(r=>r.map(c=>c.trim())).filter(r=>r.some(c=>c!=="")); }
const CSV_TEMPLATE = "Produkt;Menge;Verkaufspreis;Einkaufspreis;Versand;Marktplatz;Datum;EAN\nBeispiel-Artikel;1;49,99;20,00;4,99;eBay;15.08.2026;\n";
const CSV_FIELDS = [
  {key:"name",     label:"Produkt", req:true,  kw:["produkt","artikel","gegenstand","name","title","titel","bezeichnung","item","listing","description","beschreibung"]},
  {key:"qty",      label:"Menge",   kw:["menge","anzahl","stückzahl","qty","quantity","stück","stk"]},
  {key:"payout",   label:"Verkaufspreis / Auszahlung", req:true, kw:["auszahlung","verkaufspreis","gesamtpreis","erlös","erlöse","einnahmen","payout","umsatz","total","gesamt","sold","betrag","preis","price"]},
  {key:"ek",       label:"Einkaufspreis", kw:["einkaufspreis","einkauf","kosten","cost","buy","ek","wareneinsatz"]},
  {key:"ship",     label:"Versand", kw:["versand","porto","shipping","ship","versandkosten"]},
  {key:"platform", label:"Marktplatz", kw:["marktplatz","plattform","platform","kanal","channel","market","börse","site"]},
  {key:"date",     label:"Datum",   kw:["datum","date","verkauft","verkaufsdatum","bestelldatum","order date","sale date"]},
  {key:"ean",      label:"EAN",     kw:["ean","gtin","barcode","upc"]}
];
function csvGuess(headers, kw){ const low=headers.map(h=>String(h).toLowerCase());
  for(const k of kw){ const i=low.findIndex(h=>h.includes(k)); if(i>-1) return i; } return -1; }
/* Intelligente Auto-Zuordnung: erst Spaltennamen, dann — wenn noch offen — die INHALTE
   analysieren (Datum? Geldbetrag? EAN? längster Text = Produktname?). Damit mappen sich
   auch fremde Exporte (eBay, Excel …) meist von allein; die Dropdowns sind nur Korrektur. */
function csvAutoMap(headers, data){
  const sample=data.slice(0,50);
  const colVals=i=>sample.map(r=>(i<r.length?r[i]:"")).map(v=>String(v).trim()).filter(v=>v!=="");
  const stats=headers.map((h,i)=>{ const vals=colVals(i), cnt=vals.length||1;
    let numeric=0,dates=0,longdig=0,smallint=0,plat=0,textLen=0,textCnt=0,sumNum=0;
    vals.forEach(v=>{ const isNum=/^\s*-?[\d.,\s€$£]+\s*$/.test(v) && /\d/.test(v); const nv=impNum(v);
      if(isNum){ numeric++; sumNum+=nv; if(Math.abs(nv)<=20 && Math.abs(nv-Math.round(nv))<1e-9) smallint++; }
      else { textLen+=v.length; textCnt++; }
      if(csvDate(v)) dates++;
      const dg=v.replace(/\D/g,""); if(dg.length>=12&&dg.length<=14) longdig++;
      if(csvPlatform(v)!=="kein") plat++;
    });
    return { i, hdr:String(h||"").toLowerCase(), fNum:numeric/cnt, fDate:dates/cnt, fLong:longdig/cnt, fInt:smallint/cnt, fPlat:plat/cnt, avg:numeric?sumNum/numeric:0, avgText:textCnt?textLen/textCnt:0 };
  });
  const used=new Set(), map={};
  const take=(key,i)=>{ if(i>=0 && !used.has(i)){ map[key]=i; used.add(i); } };
  // 1) starke Signale: Spaltennamen
  CSV_FIELDS.forEach(f=>{ if(map[f.key]!=null) return; const s=stats.find(s=>!used.has(s.i)&&f.kw.some(k=>s.hdr.includes(k))); if(s) take(f.key,s.i); });
  // 2) Inhalts-Analyse für den Rest
  const rem=()=>stats.filter(s=>!used.has(s.i));
  const pick=(pred,score)=>{ const c=rem().filter(pred); if(!c.length) return -1; c.sort((a,b)=>score(b)-score(a)); return c[0].i; };
  if(map.date==null)     take("date",     pick(s=>s.fDate>0.5, s=>s.fDate));
  if(map.ean==null)      take("ean",      pick(s=>s.fLong>0.6, s=>s.fLong));
  if(map.platform==null) take("platform", pick(s=>s.fPlat>0.5, s=>s.fPlat));
  if(map.qty==null)      take("qty",      pick(s=>s.fInt>0.6 && s.fNum>0.8, s=>s.fInt));
  if(map.name==null)     take("name",     pick(s=>s.fNum<0.4 && s.avgText>=3, s=>s.avgText));
  // Geld-Spalten nach Höhe: größter Ø = Verkaufspreis, dann EK, kleinster = Versand
  let money=rem().filter(s=>s.fNum>0.6).sort((a,b)=>b.avg-a.avg);
  if(map.payout==null && money.length) take("payout", money.shift().i);
  money=rem().filter(s=>s.fNum>0.6).sort((a,b)=>b.avg-a.avg);
  if(map.ek==null && money.length) take("ek", money[0].i);
  money=rem().filter(s=>s.fNum>0.6).sort((a,b)=>a.avg-b.avg);
  if(map.ship==null && money.length) take("ship", money[0].i);
  CSV_FIELDS.forEach(f=>{ if(map[f.key]==null) map[f.key]=-1; });
  return map;
}
function openCsvImportModal(rows){
  const headers=rows[0], data=rows.slice(1);
  const map=csvAutoMap(headers, data);
  const opts=sel=>`<option value="-1">— nicht zuordnen —</option>`+headers.map((h,i)=>`<option value="${i}"${i===sel?" selected":""}>${escapeHtml(h||("Spalte "+(i+1)))}</option>`).join("");
  const build=r=>{ const g=k=>{ const i=map[k]; return (i>=0&&i<r.length)?r[i]:""; };
    return { name:g("name").trim(), qty:Math.max(1,parseInt(impNum(g("qty")))||1), payout:impNum(g("payout")), ek:impNum(g("ek")), ship:impNum(g("ship")), platform:csvPlatform(g("platform")), date:csvDate(g("date")), ean:g("ean").trim() }; };
  const renderModal=()=>{
    const fieldsHTML=CSV_FIELDS.map(f=>`<div><label class="label">${f.label}${f.req?' *':''}</label><select class="field csv-map" data-key="${f.key}">${opts(map[f.key])}</select></div>`).join("");
    const valid=data.map(build).filter(x=>x.name);
    const prev=valid.slice(0,4).map(x=>{ const p=(x.payout-x.ek-x.ship)*x.qty, pp=p>=0;
      return `<div style="display:flex;align-items:center;gap:10px;padding:7px 2px;border-top:1px solid var(--line)"><span style="flex:1;min-width:0" class="truncate text-[13px]">${escapeHtml(x.name)}</span><span class="c-sub text-[11.5px]">${x.qty}×</span><span class="mono text-[12.5px]">${eur(x.payout)}</span><span class="mono text-[12.5px]" style="font-weight:700;color:${pp?'var(--accent)':'var(--danger)'}">${pp?'+':''}${eur(p)}</span></div>`; }).join("");
    $("#modal-root").innerHTML=`<div class="overlay" id="ov"><div class="modal" style="max-width:560px;max-height:90vh;overflow:auto">
      <div class="flex items-start justify-between gap-3 mb-1"><div><p class="font-bold text-[18px]">Verkäufe importieren</p><p class="c-sub text-[12.5px] mt-0.5">${data.length} Zeilen · Spalten <b>automatisch zugeordnet</b> — nur kurz prüfen &amp; ggf. korrigieren. Preise pro Stück.</p></div><button id="csv-x" class="iconbtn" title="Schließen" aria-label="Schließen"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg></button></div>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 my-4">${fieldsHTML}</div>
      <p class="label mb-1">Vorschau <span class="c-sub" style="font-weight:400">(${valid.length} importierbar)</span></p>
      <div style="background:var(--cell-2);border:1px solid var(--line);border-radius:12px;padding:2px 12px 8px">${prev||'<p class="c-sub text-[12px] py-3">Keine Zeile mit Produktname erkannt — bitte Spalte „Produkt" zuordnen.</p>'}</div>
      <p class="c-sub text-[11px] leading-relaxed mt-2.5">„Verkaufspreis/Auszahlung" = Betrag, den du <b>tatsächlich erhalten hast</b> (nach Marktplatz-Gebühren) — bei Import werden keine Gebühren erneut abgezogen.</p>
      <div class="grid grid-cols-2 gap-3 mt-4"><button id="csv-cancel" class="btn-ghost">Abbrechen</button><button id="csv-do" class="btn-accent"${valid.length?'':' disabled'}>${valid.length} Verkäufe importieren</button></div>
    </div></div>`;
    const close=()=>{ $("#modal-root").innerHTML=""; };
    $("#csv-x").addEventListener("click",close); $("#csv-cancel").addEventListener("click",close);
    $$("#modal-root .csv-map").forEach(sel=>sel.addEventListener("change",()=>{ map[sel.dataset.key]=parseInt(sel.value); renderModal(); }));
    const dob=$("#csv-do"); if(dob) dob.addEventListener("click",()=>{
      const items=data.map(build).filter(x=>x.name); if(!items.length){ showToast("Nichts zu importieren"); return; }
      const base=Date.now();
      const newFlips=items.map((x,i)=>({ id:"f"+base+"_"+i, name:x.name, ean:x.ean||"", qty:x.qty, ek:x.ek, payout:x.payout, ship:x.ship, date:new Date((x.date||fixTodayISO())+"T12:00:00").toISOString(), img:null, platform:x.platform, imported:true }));
      flips = newFlips.concat(flips); DB.saveFlips(flips); close(); showToast(`✓ ${newFlips.length} Verkäufe importiert`);
      renderTrackerList&&renderTrackerList(); renderDashboard&&renderDashboard();
    });
  };
  renderModal();
}
if($("#csv-template")) $("#csv-template").addEventListener("click",()=>downloadFile("flipdeck-import-vorlage.csv", CSV_TEMPLATE, "text/csv;charset=utf-8"));
if($("#csv-import")) $("#csv-import").addEventListener("click",()=>{ const i=$("#csv-import-input"); if(i) i.click(); });
if($("#csv-import-input")) $("#csv-import-input").addEventListener("change",function(){ const f=this.files&&this.files[0]; if(!f) return;
  const r=new FileReader(); r.onload=()=>{ try{ const rows=parseCSV(r.result); if(rows.length<2){ showToast("CSV enthält keine Datenzeilen"); } else openCsvImportModal(rows); }catch(err){ console.warn("[csv]",err&&err.message); showToast("CSV konnte nicht gelesen werden"); } this.value=""; };
  r.onerror=()=>showToast("Datei konnte nicht gelesen werden"); r.readAsText(f); });

function openImportModal(d){
  const arr = v => Array.isArray(v) ? v : [];
  const inc = { flips:arr(d.flips), inventory:arr(d.inventory), fixed:arr(d.fixed),
                calcs:arr(d.calcs), fixcfg:(d.fixcfg && typeof d.fixcfg==="object") ? d.fixcfg : null,
                shipcfg:(d.shipcfg && typeof d.shipcfg==="object") ? d.shipcfg : null };

  if(!inc.flips.length && !inc.inventory.length && !inc.fixed.length && !inc.calcs.length && !inc.fixcfg){
    showToast("✗ Keine verwertbaren Daten in der Datei"); return;
  }
  const when = d.exportedAt ? new Date(d.exportedAt).toLocaleString("de-DE") : "unbekannt";
  const row = (label, n, cur) => `<div class="brk"><span>${label}</span><span class="mono">${n} <span class="c-sub">(aktuell ${cur})</span></span></div>`;

  $("#modal-root").innerHTML = `<div class="overlay" id="ov"><div class="modal" style="max-height:88vh;display:flex;flex-direction:column">
    <p class="font-bold text-[16px] leading-snug">Backup einspielen</p>
    <p class="c-sub text-[12px] mt-1 mb-1.5">Erstellt am ${escapeHtml(when)}${d.version?` · Version ${escapeHtml(String(d.version))}`:""}</p>
    <p class="text-[12px] font-semibold mb-3" style="color:var(--accent)">✓ Gültige Backup-Datei · ${inc.flips.length+inc.inventory.length+inc.fixed.length+inc.calcs.length} Datensätze insgesamt</p>
    <div style="overflow-y:auto;flex:1">
      ${row("Verkäufe", inc.flips.length, flips.length)}
      ${row("Bestand", inc.inventory.length, inventory.length)}
      ${row("Fixkosten", inc.fixed.length, fixed.length)}
      ${row("Rechner-Verlauf", inc.calcs.length, (typeof calcs!=="undefined"?calcs.length:0))}
      ${inc.fixcfg ? `<div class="brk"><span>Einstellungen (Zielmarge etc.)</span><span class="mono">enthalten</span></div>` : ""}
      ${inc.shipcfg ? `<div class="brk"><span>Versandkosten-Vorlagen</span><span class="mono">enthalten</span></div>` : ""}
      <div class="mt-4">
        <label class="label">Wie einspielen?</label>
        <div class="flex flex-col gap-2">
          <label class="imp-opt"><input type="radio" name="impmode" value="merge" checked><span><b>Ergänzen</b> — vorhandene Einträge bleiben, nur Neues kommt dazu <span class="c-sub">(empfohlen)</span></span></label>
          <label class="imp-opt"><input type="radio" name="impmode" value="replace"><span><b>Ersetzen</b> — aktuelle Daten werden vollständig überschrieben</span></label>
        </div>
      </div>
      <p id="imp-warn" class="c-sub text-[11.5px] mt-3 leading-relaxed">Tipp: Lade dir vorher ein aktuelles Voll-Backup herunter, falls du dich vertust.</p>
    </div>
    <div class="grid grid-cols-2 gap-3 mt-3"><button id="imp-cancel" class="btn-ghost">Abbrechen</button><button id="imp-go" class="btn-accent">Einspielen</button></div>
  </div></div>`;

  const close = () => $("#modal-root").innerHTML = "";
  $("#ov").addEventListener("click", e=>{ if(e.target.id==="ov") close(); });
  $("#imp-cancel").addEventListener("click", close);
  $$('input[name="impmode"]').forEach(r=>r.addEventListener("change",()=>{
    const rep = $('input[name="impmode"]:checked').value==="replace";
    const w = $("#imp-warn");
    w.innerHTML = rep
      ? `<b style="color:var(--danger)">Achtung:</b> Ersetzen löscht deine aktuellen Daten unwiderruflich. Lade vorher ein Voll-Backup herunter.`
      : `Tipp: Lade dir vorher ein aktuelles Voll-Backup herunter, falls du dich vertust.`;
  }));

  $("#imp-go").addEventListener("click", async ()=>{
    const mode = $('input[name="impmode"]:checked').value;
    const btn = $("#imp-go"); btn.disabled = true; btn.textContent = "Speichere…";

    const mergeById = (cur, incoming) => {
      const seen = new Set(cur.map(x=>x.id));
      const add = incoming.filter(x=> x && x.id && !seen.has(x.id));
      return cur.concat(add);
    };

    if(mode === "replace"){
      flips     = inc.flips;
      inventory = inc.inventory;
      fixed     = inc.fixed;
      if(inc.calcs.length || Array.isArray(d.calcs)) calcs = inc.calcs;
    } else {
      flips     = mergeById(flips, inc.flips);
      inventory = mergeById(inventory, inc.inventory);
      fixed     = mergeById(fixed, inc.fixed);
      calcs     = mergeById((typeof calcs!=="undefined"?calcs:[]), inc.calcs);
    }
    if(inc.fixcfg) fixCfg = Object.assign({}, fixCfg, inc.fixcfg);
    if(inc.shipcfg){ shipCfg = normalizeShipCfg(inc.shipcfg); renderShipPresets(); applyShipDefaults(); }

    await Promise.all([
      DB.saveFlips(flips), DB.saveInventory(inventory),
      DB.saveFixed(fixed), DB.saveCalcs(calcs), DB.saveFixCfg(fixCfg),
      (inc.shipcfg ? DB.saveShipCfg(shipCfg) : Promise.resolve())
    ]);

    close();
    renderDashboard(); renderHistory && renderHistory(); renderTrackerList && renderTrackerList();
    renderInventory(); renderFixed(); renderReport();
    showToast(`✓ Backup eingespielt (${mode==="replace"?"ersetzt":"ergänzt"})`);
  });
}

/* ===== 11 · ADMIN · echte Nutzerverwaltung über Supabase 'profiles' ===== */
function adminSetupHint(){
  const sql = `-- In Supabase: SQL Editor -> New query -> einfügen -> RUN
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text,
  role text not null default 'user',
  created_at timestamptz not null default now()
);
alter table public.profiles enable row level security;

-- Helfer: ist der aktuelle Nutzer Owner? (SECURITY DEFINER = keine RLS-Rekursion)
create or replace function public.is_owner() returns boolean
  language sql security definer set search_path = public
  as $$ select exists(select 1 from public.profiles where id = auth.uid() and role = 'owner'); $$;

-- eigenes Profil: lesen / anlegen / aendern
create policy "p_self_sel" on public.profiles for select using (auth.uid() = id);
create policy "p_self_ins" on public.profiles for insert with check (auth.uid() = id);
create policy "p_self_upd" on public.profiles for update using (auth.uid() = id);
-- Owner: alle Konten lesen + Rollen aendern
create policy "p_owner_sel" on public.profiles for select using (public.is_owner());
create policy "p_owner_upd" on public.profiles for update using (public.is_owner());`;
  const box=$("#a-setup");
  box.classList.remove("hidden");
  box.innerHTML=`<div class="rounded-[14px] p-3.5 mt-1" style="background:var(--cell-2);border:1px solid var(--line)">
    <p class="text-[13px] font-semibold mb-1">Einrichtung nötig</p>
    <p class="c-sub text-[12px] leading-relaxed mb-2">Damit registrierte Konten hier erscheinen und du Admin-Rechte vergeben kannst, lege einmalig die <span class="mono">profiles</span>-Tabelle in Supabase an. SQL kopieren, in Supabase unter <span class="mono">SQL Editor</span> ausführen, dann „Liste aktualisieren“.</p>
    <button id="a-sql-copy" class="btn-ghost w-full" style="margin-bottom:8px">SQL kopieren</button>
    <pre class="mono" style="font-size:10.5px;line-height:1.5;white-space:pre-wrap;word-break:break-word;max-height:150px;overflow:auto;color:var(--sub);background:var(--cell);border:1px solid var(--line);border-radius:10px;padding:10px">${escapeHtml(sql)}</pre>
  </div>`;
  const cp=$("#a-sql-copy"); if(cp) cp.addEventListener("click",async()=>{ try{ await navigator.clipboard.writeText(sql); showToast("✓ SQL kopiert"); }catch(e){ showToast("Kopieren nicht möglich"); } });
}
async function renderAdmin(){
  const box=$("#a-list"); const setup=$("#a-setup"); if(!box) return;
  setup.classList.add("hidden"); setup.innerHTML="";
  box.innerHTML=`<p class="c-sub text-[13px]">Konten werden geladen…</p>`;
  let list;
  try{ list = await profileList(); }
  catch(e){
    console.warn("[admin] profiles fehlt:", e && e.message);
    box.innerHTML=`<div class="rounded-[14px] p-3" style="background:var(--cell-2)"><div class="flex items-center gap-2"><p class="font-semibold text-[14px] truncate">${escapeHtml(displayName())}</p><span class="pill pill-accent">Owner · du</span></div></div>`;
    $("#a-count").textContent="1"; adminSetupHint(); return;
  }
  $("#a-count").textContent=String(list.length);
  const meId=currentUser&&currentUser.id;
  const pending = list.filter(u=>u.status==="pending");
  const others  = list.filter(u=>u.status!=="pending");
  box.innerHTML="";
  if(!list.length){ box.innerHTML=`<p class="c-sub text-[13px]">Noch keine Konten. Sobald sich jemand über „Neues Konto“ anmeldet, erscheint er hier zur Freigabe.</p>`; refreshPendingBadge(); return; }

  // 1) Ausstehende Registrierungsanfragen
  if(pending.length){
    const h=document.createElement("p"); h.className="label"; h.style.cssText="margin:0 0 6px"; h.textContent=`Ausstehende Anfragen · ${pending.length}`; box.appendChild(h);
    pending.forEach(u=>{
      const el=document.createElement("div"); el.className="flex items-center justify-between gap-2 rounded-[14px] p-3 mb-2"; el.style.cssText="background:var(--cell-2);border:1px solid color-mix(in srgb,#f5a524 40%,var(--line))";
      el.innerHTML=`<div class="min-w-0"><div class="flex items-center gap-2"><p class="font-semibold text-[14px] truncate">${escapeHtml(u.username||"—")}</p><span class="pill pill-warn">wartet</span></div></div>
        <div class="flex items-center gap-2" style="flex:0 0 auto"><button class="btn-accent a-approve" data-id="${u.id}" style="padding:7px 12px;font-size:12.5px">Annehmen</button><button class="btn-ghost a-reject" data-id="${u.id}" style="padding:7px 11px;font-size:12.5px;color:var(--danger)">Ablehnen</button></div>`;
      box.appendChild(el);
    });
    const d=document.createElement("p"); d.className="label"; d.style.cssText="margin:14px 0 6px"; d.textContent="Konten"; box.appendChild(d);
  }

  // 2) Bestehende Konten (freigegeben / abgelehnt)
  others.forEach(u=>{
    const isOwner=u.role==="owner", isMe=u.id===meId, rejected=u.status==="rejected";
    const el=document.createElement("div"); el.className="flex items-center justify-between gap-2 rounded-[14px] p-3 mb-2"; el.style.background="var(--cell-2)";
    const btn = isMe ? `<span class="c-sub text-[11px]">du</span>`
      : rejected ? `<button class="btn-ghost a-approve" data-id="${u.id}" style="padding:7px 12px;flex:0 0 auto;font-size:12.5px">Doch freigeben</button>`
      : `<button class="btn-ghost a-role" data-id="${u.id}" data-role="${isOwner?'user':'owner'}" style="padding:7px 11px;flex:0 0 auto;font-size:12.5px">${isOwner?'Admin entziehen':'Admin geben'}</button>`;
    el.innerHTML=`<div class="min-w-0"><div class="flex items-center gap-2"><p class="font-semibold text-[14px] truncate">${escapeHtml(u.username||"—")}</p>${isOwner?`<span class="pill pill-accent">Owner</span>`:`<span class="pill pill-mut">User</span>`}${rejected?`<span class="pill pill-warn">abgelehnt</span>`:""}${isMe?`<span class="c-sub text-[11px]">(du)</span>`:""}</div></div>${btn}`;
    box.appendChild(el);
  });

  $$(".a-role").forEach(b=>b.addEventListener("click",async()=>{
    const id=b.dataset.id, role=b.dataset.role;
    b.disabled=true; const ol=b.textContent; b.textContent="…";
    try{ await profileSetRole(id, role); showToast(role==="owner"?"✓ Admin-Rechte vergeben":"✓ Admin-Rechte entzogen"); await renderAdmin(); }
    catch(e){ console.warn("[admin] setRole", e&&e.message); showToast("Konnte Rolle nicht ändern (Rechte/RLS?)"); b.disabled=false; b.textContent=ol; }
  }));
  $$(".a-approve").forEach(b=>b.addEventListener("click",async()=>{
    const id=b.dataset.id; b.disabled=true; const ol=b.textContent; b.textContent="…";
    try{ await setUserStatus(id,"approved"); showToast("✓ Freigegeben"); await renderAdmin(); refreshPendingBadge(); }
    catch(e){ console.warn("[admin] approve", e&&e.message); showToast("Konnte nicht freigeben (Rechte/RLS?)"); b.disabled=false; b.textContent=ol; }
  }));
  $$(".a-reject").forEach(b=>b.addEventListener("click",async()=>{
    const id=b.dataset.id; b.disabled=true; const ol=b.textContent; b.textContent="…";
    try{ await setUserStatus(id,"rejected"); showToast("Abgelehnt"); await renderAdmin(); refreshPendingBadge(); }
    catch(e){ console.warn("[admin] reject", e&&e.message); showToast("Konnte nicht ablehnen (Rechte/RLS?)"); b.disabled=false; b.textContent=ol; }
  }));
  refreshPendingBadge();
}
const aRef=$("#a-refresh"); if(aRef) aRef.addEventListener("click",()=>renderAdmin());

/* ===== Feedback & Bug-Meldungen · Nutzer -> Supabase 'feedback' -> Admin-Tab ===== */
const FB_KINDS = {
  bug:   { label:"Bug",          icon:"🐞", col:"#f87171" },
  idea:  { label:"Idee / Wunsch", icon:"💡", col:"#fbbf24" },
  other: { label:"Sonstiges",     icon:"💬", col:"#60a5fa" }
};
function feedbackSetupSQL(){ return `-- In Supabase: SQL Editor -> New query -> einfügen -> RUN
create table if not exists public.feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  username text,
  kind text not null default 'bug',
  message text not null,
  image_url text,
  status text not null default 'new',
  created_at timestamptz not null default now()
);
alter table public.feedback enable row level security;
-- jeder eingeloggte Nutzer darf eigenes Feedback senden + sehen
create policy "fb_self_ins" on public.feedback for insert with check (auth.uid() = user_id);
create policy "fb_self_sel" on public.feedback for select using (auth.uid() = user_id);
-- Owner darf alles lesen + Status ändern (nutzt vorhandene is_owner())
create policy "fb_owner_sel" on public.feedback for select using (public.is_owner());
create policy "fb_owner_upd" on public.feedback for update using (public.is_owner());`; }
function fbFileToDataUrl(file){ return new Promise((res,rej)=>{ const r=new FileReader(); r.onload=()=>res(r.result); r.onerror=rej; r.readAsDataURL(file); }); }
async function submitFeedback(kind,message,image_url){
  return sb.from('feedback').insert({ user_id: currentUser.id, username: currentUser.username||null, kind, message, image_url: image_url||null }); }
async function feedbackListAll(){ const { data, error } = await sb.from('feedback').select('*').order('created_at',{ascending:false}); if(error) throw error; return data||[]; }
async function feedbackSetStatus(id,status){ return sb.from('feedback').update({status}).eq('id',id); }
async function feedbackUnread(){ if(!currentUser||currentUser.role!=="owner") return 0;
  try{ const { count, error } = await sb.from('feedback').select('id',{count:'exact',head:true}).eq('status','new'); if(error) return 0; return count||0; }catch(e){ return 0; } }

function openFeedbackModal(){
  let kind="bug", imgUrl="", busy=false;
  const kindsHTML=Object.entries(FB_KINDS).map(([k,v])=>`<button type="button" class="fb-kind" data-kind="${k}" aria-selected="${k===kind}" style="display:flex;align-items:center;gap:6px;padding:9px 13px;border-radius:12px;border:1px solid var(--line);background:var(--cell-2);color:var(--text);font-size:13px;font-weight:600;cursor:pointer">${v.icon} ${v.label}</button>`).join("");
  $("#modal-root").innerHTML=`<div class="overlay" id="ov"><div class="modal" style="max-width:460px">
    <div class="flex items-start justify-between gap-3 mb-1">
      <div><p class="font-bold text-[18px]">Feedback &amp; Bugs</p><p class="c-sub text-[12.5px] mt-0.5">Was können wir besser machen? Bild anhängen ist optional.</p></div>
      <button id="fb-x" class="iconbtn" title="Schließen" aria-label="Schließen"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg></button>
    </div>
    <div class="my-3"><p class="label mb-2">Art</p><div class="flex gap-2 flex-wrap" id="fb-kinds">${kindsHTML}</div></div>
    <div class="mb-3"><label class="label" for="fb-msg">Deine Nachricht *</label><textarea id="fb-msg" class="field" rows="5" placeholder="Beschreibe den Bug oder deinen Wunsch möglichst genau…" style="resize:vertical"></textarea></div>
    <div class="mb-4"><p class="label mb-2">Bild / Screenshot <span class="c-sub" style="font-weight:400">(optional)</span></p>
      <input id="fb-file" type="file" accept="image/*" style="display:none">
      <button id="fb-attach" type="button" class="btn-ghost w-full" style="display:flex;align-items:center;justify-content:center;gap:8px">📎 Bild anhängen</button>
      <div id="fb-preview" class="hidden mt-2"></div>
    </div>
    <div class="grid grid-cols-2 gap-3"><button id="fb-cancel" class="btn-ghost">Abbrechen</button><button id="fb-send" class="btn-accent">Senden ↗</button></div>
  </div></div>`;
  const close=()=>{ $("#modal-root").innerHTML=""; };
  $("#fb-x").addEventListener("click",close); $("#fb-cancel").addEventListener("click",close);
  $$("#fb-kinds .fb-kind").forEach(b=>b.addEventListener("click",()=>{ kind=b.dataset.kind; $$("#fb-kinds .fb-kind").forEach(x=>x.setAttribute("aria-selected",x.dataset.kind===kind)); }));
  $("#fb-attach").addEventListener("click",()=>$("#fb-file").click());
  $("#fb-file").addEventListener("change",async()=>{ const f=$("#fb-file").files[0]; if(!f) return;
    $("#fb-attach").textContent="Lade Bild…"; $("#fb-attach").disabled=true;
    try{ const dataUrl=await fbFileToDataUrl(f); imgUrl=await uploadImage(dataUrl);
      $("#fb-preview").classList.remove("hidden"); $("#fb-preview").innerHTML=`<img src="${attrEsc(imgUrl)}" style="max-height:150px;border-radius:10px;border:1px solid var(--line)">`;
      $("#fb-attach").textContent="✓ Bild angehängt — anderes wählen"; }
    catch(e){ console.warn("[feedback] img",e&&e.message); showToast("Bild-Upload fehlgeschlagen"); $("#fb-attach").textContent="📎 Bild anhängen"; }
    $("#fb-attach").disabled=false; });
  $("#fb-send").addEventListener("click",async()=>{ if(busy) return; const msg=$("#fb-msg").value.trim(); if(!msg){ flashError($("#fb-msg")); return; }
    busy=true; $("#fb-send").textContent="Sende…"; $("#fb-send").disabled=true;
    try{ const { error }=await submitFeedback(kind,msg,imgUrl); if(error) throw error;
      close(); showToast("✓ Danke! Dein Feedback ist angekommen."); }
    catch(e){ console.warn("[feedback] send",e&&e.message); const miss=/relation .*feedback.* does not exist|schema cache/i.test(e&&e.message||""); showToast(miss?"Feedback-Tabelle fehlt noch (Admin muss sie anlegen).":"Konnte nicht senden — bitte später erneut."); $("#fb-send").textContent="Senden ↗"; $("#fb-send").disabled=false; busy=false; } });
}
if($("#dash-feedback")) $("#dash-feedback").addEventListener("click",openFeedbackModal);

function feedbackSetupHint(){ const box=$("#fb-setup"); if(!box) return; const sql=feedbackSetupSQL();
  box.classList.remove("hidden");
  box.innerHTML=`<div class="rounded-[14px] p-3.5 mt-2" style="background:var(--cell-2);border:1px solid var(--line)">
    <p class="text-[13px] font-semibold mb-1">Einrichtung nötig</p>
    <p class="c-sub text-[12px] leading-relaxed mb-2">Damit Feedback hier erscheint, lege einmalig die <span class="mono">feedback</span>-Tabelle in Supabase an. SQL kopieren, im <span class="mono">SQL Editor</span> ausführen, dann „Aktualisieren".</p>
    <button id="fb-sql-copy" class="btn-ghost w-full" style="margin-bottom:8px">SQL kopieren</button>
    <pre class="mono" style="font-size:10.5px;line-height:1.5;white-space:pre-wrap;word-break:break-word;max-height:150px;overflow:auto;color:var(--sub);background:var(--cell);border:1px solid var(--line);border-radius:10px;padding:10px">${escapeHtml(sql)}</pre></div>`;
  const cp=$("#fb-sql-copy"); if(cp) cp.addEventListener("click",async()=>{ try{ await navigator.clipboard.writeText(sql); showToast("✓ SQL kopiert"); }catch(e){ showToast("Kopieren nicht möglich"); } }); }
async function renderFeedbackAdmin(){
  const box=$("#fb-list"); if(!box) return;
  if(!currentUser||currentUser.role!=="owner"){ box.innerHTML=""; return; }
  box.innerHTML=`<p class="c-sub text-[13px]">Lade Feedback…</p>`;
  let list;
  try{ list=await feedbackListAll(); }
  catch(e){ console.warn("[feedback] list",e&&e.message); box.innerHTML=`<p class="c-sub text-[13px]">Feedback-Tabelle noch nicht angelegt.</p>`; feedbackSetupHint(); const c=$("#fb-count"); if(c) c.textContent="0"; return; }
  const setup=$("#fb-setup"); if(setup){ setup.classList.add("hidden"); setup.innerHTML=""; }
  const cnt=$("#fb-count"); if(cnt) cnt.textContent=String(list.length);
  if(!list.length){ box.innerHTML=`<p class="c-sub text-[13px]">Noch kein Feedback eingegangen.</p>`; return; }
  box.innerHTML="";
  list.forEach(f=>{ const k=FB_KINDS[f.kind]||FB_KINDS.other; const isNew=f.status==="new", isDone=f.status==="done";
    const d=new Date(f.created_at).toLocaleString("de-DE",{day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit"});
    const el=document.createElement("div"); el.className="rounded-[14px] p-3"; el.style.cssText="background:var(--cell-2);border:1px solid "+(isNew?"color-mix(in srgb,var(--brand) 45%,var(--line))":"var(--line)");
    el.innerHTML=`<div class="flex items-center gap-2 mb-1.5 flex-wrap">
        <span class="pill" style="background:color-mix(in srgb,${k.col} 16%,transparent);color:${k.col}">${k.icon} ${k.label}</span>
        ${isNew?`<span class="pill pill-warn">neu</span>`:isDone?`<span class="pill pill-accent">erledigt</span>`:`<span class="pill pill-mut">gesehen</span>`}
        <span class="c-sub text-[11.5px]">${escapeHtml((f.username||"—").split("@")[0])} · ${d}</span></div>
      <p class="text-[13.5px] leading-relaxed" style="white-space:pre-wrap;word-break:break-word">${escapeHtml(f.message)}</p>
      ${f.image_url?`<a href="${attrEsc(f.image_url)}" target="_blank" rel="noopener noreferrer"><img src="${attrEsc(f.image_url)}" style="max-height:150px;border-radius:10px;border:1px solid var(--line);margin-top:8px"></a>`:""}
      <div class="flex gap-2 mt-2.5">
        ${isNew?`<button class="btn-ghost fb-seen" data-id="${f.id}" style="padding:6px 11px;font-size:12px">Als gesehen</button>`:""}
        ${isDone?"":`<button class="btn-ghost fb-done" data-id="${f.id}" style="padding:6px 11px;font-size:12px;color:var(--accent)">Erledigt</button>`}
      </div>`;
    box.appendChild(el); });
  $$("#fb-list .fb-seen").forEach(b=>b.addEventListener("click",async()=>{ b.disabled=true; try{ await feedbackSetStatus(b.dataset.id,"seen"); await renderFeedbackAdmin(); refreshPendingBadge(); }catch(e){ showToast("Fehler beim Speichern"); b.disabled=false; } }));
  $$("#fb-list .fb-done").forEach(b=>b.addEventListener("click",async()=>{ b.disabled=true; try{ await feedbackSetStatus(b.dataset.id,"done"); await renderFeedbackAdmin(); refreshPendingBadge(); }catch(e){ showToast("Fehler beim Speichern"); b.disabled=false; } }));
}
if($("#fb-refresh")) $("#fb-refresh").addEventListener("click",()=>renderFeedbackAdmin());


/* ===== 12 · PROFIL ===== */
function renderProfil(){ if(!currentUser) return; renderAvatar();
  $("#profil-name").textContent=displayName(); $("#profil-role").textContent=currentUser.role==="owner"?"Owner / Admin":"User";
  $$("#mode-seg button").forEach(b=>b.setAttribute("aria-selected", b.dataset.mode===themeMode));
  $$("#lang-seg button").forEach(b=>b.setAttribute("aria-selected", b.dataset.lang===lang));
  if(document.activeElement!==$("#stale-input")) $("#stale-input").value=staleDays;
  renderShipCfg(); renderPlatManager(); renderDashManager(); renderFeatManager(); renderBuyPlatManager(); renderPayMethodManager();
  if(typeof setSettingsCat==="function") setSettingsCat(Store.get(uKey("setcat"))||"profil"); }

/* Versandkosten-Vorlagen im Profil verwalten */
function renderShipCfg(){
  const box=$("#ship-list"); if(!box) return;
  if(!shipCfg.presets.length){ box.innerHTML=`<p class="c-sub text-[12.5px]">Noch keine Vorlagen — unten eine hinzufügen.</p>`; }
  else{
    box.innerHTML = shipCfg.presets.slice().sort((a,b)=>a.amount-b.amount).map(p=>{
      const isDef = Math.abs(p.amount-shipDef())<0.005, amt=p.amount.toFixed(2);
      return `<div class="flex items-center gap-2 rounded-[13px] px-3 py-2.5" style="background:var(--cell-2);border:1px solid ${isDef?'color-mix(in srgb,var(--brand) 45%,var(--line))':'var(--line)'}">
        <span class="mono font-bold text-[15px]" style="flex:0 0 auto;min-width:74px">${eur(p.amount)}</span>
        <span class="flex-1 min-w-0 truncate text-[13.5px]">${escapeHtml(p.label||'—')}</span>
        ${isDef ? `<span class="pill pill-blue" style="flex:0 0 auto">Standard</span>`
                : `<button type="button" class="ship-def btn-ghost" data-amt="${amt}" style="flex:0 0 auto;padding:6px 11px;font-size:12px">Als Standard</button>`}
        <button type="button" class="ship-del iconbtn danger" data-amt="${amt}" title="Entfernen" style="flex:0 0 auto">${icoTrash}</button>
      </div>`;
    }).join("");
    $$("#ship-list .ship-def").forEach(b=>b.addEventListener("click",()=>{ shipCfg.def=num(b.dataset.amt); persistShip(); renderShipCfg(); applyShipDefaults(); showToast("✓ Standard-Versand gesetzt"); }));
    $$("#ship-list .ship-del").forEach(b=>b.addEventListener("click",()=>{ const amt=num(b.dataset.amt); shipCfg.presets=shipCfg.presets.filter(p=>Math.abs(p.amount-amt)>=0.005); persistShip(); renderShipCfg(); showToast("Vorlage entfernt"); }));
  }
}
(function initShipControls(){
  const add=$("#ship-add"); if(!add) return;
  const doAdd=()=>{
    const labEl=$("#ship-new-label"), amtEl=$("#ship-new-amount");
    if(amtEl.value.trim()===""){ flashError(amtEl); showToast("Bitte einen Betrag eingeben"); return; }
    const amt=num(amtEl.value); if(!(amt>=0)){ flashError(amtEl); showToast("Betrag ungültig"); return; }
    shipCfg.presets = shipCfg.presets.filter(p=>Math.abs(p.amount-amt)>=0.005);   // gleichen Betrag ersetzen
    shipCfg.presets.push({ label: labEl.value.trim() || eur(amt), amount: amt });
    persistShip(); labEl.value=""; amtEl.value="";
    renderShipCfg(); showToast("✓ Vorlage gespeichert");
  };
  add.addEventListener("click", doAdd);
  $("#ship-new-amount").addEventListener("keydown",e=>{ if(e.key==="Enter"){ e.preventDefault(); doAdd(); } });
})();
$$("#mode-seg button").forEach(b=>b.addEventListener("click",()=>{ setMode(b.dataset.mode); renderProfil(); }));
$$("#lang-seg button").forEach(b=>b.addEventListener("click",()=>{ setLang(b.dataset.lang); renderProfil(); }));
$("#stale-input").addEventListener("input",()=>{ const v=parseInt($("#stale-input").value)||30; staleDays=Math.max(1,v); DB.setSetting("stale",String(staleDays)); renderInventory(); });
$("#avatar-btn").addEventListener("click",()=>$("#avatar-input").click());
$("#reopen-setup").addEventListener("click",openAccountSetup);
$("#avatar-input").addEventListener("change",e=>{ const file=e.target.files[0]; if(!file) return; readImageScaled(file,256,d=>{ avatarUrl=d; DB.setAvatar(d); renderAvatar(); showToast("✓ Profilbild aktualisiert"); }); });
$("#pw-save").addEventListener("click", async ()=>{
  const oldp=$("#pw-old").value, np=$("#pw-new").value, cf=$("#pw-cf").value;
  if(!oldp){ flashError($("#pw-old")); showToast("Bitte altes Passwort eingeben"); return; }
  if(!np || np.length<6){ flashError($("#pw-new")); showToast("Neues Passwort: mindestens 6 Zeichen"); return; }
  if(np!==cf){ flashError($("#pw-new")); flashError($("#pw-cf")); showToast("Passwörter stimmen nicht überein"); return; }
  if(!sb || !currentUser){ showToast("Keine Verbindung — bitte neu anmelden"); return; }
  const btn=$("#pw-save"); const ol=btn.textContent; btn.disabled=true; btn.textContent="Wird geändert…";
  try{
    // 1) altes Passwort echt gegen Supabase prüfen
    const { error: signErr } = await sb.auth.signInWithPassword({ email: currentUser.username, password: oldp });
    if(signErr){ flashError($("#pw-old")); showToast("Altes Passwort ist falsch"); return; }
    // 2) neues Passwort in Supabase setzen
    const { error: upErr } = await sb.auth.updateUser({ password: np });
    if(upErr){ showToast(authErrorDE(upErr.message)); return; }
    // lokalen Admin-Anzeige-Store mitziehen (optional)
    const me=users.find(u=>u.username===currentUser.username); if(me){ me.password=np; DB.saveUsers(users); }
    $("#pw-old").value=""; $("#pw-new").value=""; $("#pw-cf").value="";
    showToast("✓ Passwort geändert");
  }catch(e){ console.error("[pw-change]", e); showToast("Technischer Fehler — Konsole prüfen (F12)."); }
  finally{ btn.disabled=false; btn.textContent=ol; }
});

/* =====================================================================
   Daten-Anbindung erledigt die DB-Schicht oben (dbLoad/dbSave ->
   Tabelle 'app_state'). Der frühere SupabaseProvider-Stub wurde
   entfernt, weil er auf nicht vorhandene Tabellen zeigte.
   ===================================================================== */

/* Supabase-Client & Auth-Konfiguration stehen ganz oben im Skript.
   Login per Username -> "username@flipgrid.app". Neue User registrieren
   sich selbst. OWNER_EMAILS (oben) = wer den Admin-Tab sieht. */

/* ===== 13 · BOOT ===== */
(async () => {
    applyPalette(Store.get("fg_theme")||"spacegray");
    applyI18n();
    kuMode = Store.get("fg_ku")===null ? true : Store.get("fg_ku")==="1";
    packMode = Store.get("fg_pack")===null ? true : Store.get("fg_pack")==="1";
    $("#c-pack").checked = packMode;
    $("#f-date").value = todayISOInput(); 
    flipFormPreview();
    
    // Persistente Session: supabase-js hält die Session automatisch im localStorage.
    try {
        if(!sb){ showLogin(); return; }
        // Failsafe: nie ewig auf „Lädt…" hängen (blockierter Storage / hängendes Netz in manchen Browsern).
        setTimeout(function(){ var s=document.getElementById("boot-splash"); if(s && !s.classList.contains("hidden")){ console.warn("[boot] Failsafe nach 12s -> Login"); s.classList.add("hidden"); var lv=document.getElementById("login-view"); if(lv) lv.classList.remove("hidden"); } }, 12000);
        // getSession darf den Boot nicht blockieren -> nach 7s als „keine Session" behandeln.
        var gs = await Promise.race([
            sb.auth.getSession().then(function(r){ return (r && r.data && r.data.session) || null; }).catch(function(){ return null; }),
            new Promise(function(res){ setTimeout(function(){ res("__timeout__"); }, 7000); })
        ]);
        if (gs === "__timeout__") { console.warn("[boot] getSession Timeout -> Login"); showLogin(); }
        else if (gs) { await handlePostAuth(gs.user); }
        else { showLogin(); }
    } catch (e) {
        console.error("[boot] Session-/Verbindungsfehler:", e);
        showLogin();
    }
})();


/* ===== Flipdeck · ausgelagerter Inline-Block 2 ===== */

/* ===== v2.1 · Tab-Deeplinks: Mausrad-/Mittelklick öffnet neuen Browser-Tab + Hash-Routing.
   Komplett additiv – greift NICHT in setTab oder bestehende Listener ein. ===== */
(function(){
  "use strict";
  var TABS=["dashboard","tracker","calc","inventory","fix","report","pwgen","admin","profil"];
  function tabFromEl(t){ if(!t) return null; return (t.dataset&&t.dataset.tab)||null; }
  function urlFor(name){ return location.pathname + location.search + "#" + name; }
  function syncHash(name){ if(TABS.indexOf(name)>-1){ try{ history.replaceState(null,"","#"+name); }catch(e){} } }
  function pick(e){ var el=e.target; if(!el||!el.closest) return null; return el.closest('[data-tab]'); }
  // Hash mitführen, wenn ein Tab/Profil normal geklickt wird
  document.addEventListener("click", function(e){ var n=tabFromEl(pick(e)); if(n) syncHash(n); });
  // Mittlere Maustaste (Mausrad-Klick) => in neuem Browser-Tab öffnen
  document.addEventListener("auxclick", function(e){
    if(e.button!==1) return; var n=tabFromEl(pick(e)); if(!n) return;
    e.preventDefault(); window.open(urlFor(n), "_blank", "noopener");
  });
  // Auto-Scroll-Cursor / Mittelklick-Paste auf diesen Elementen unterdrücken
  document.addEventListener("mousedown", function(e){ if(e.button===1 && pick(e)) e.preventDefault(); });
  // Hash anwenden, sobald die App sichtbar ist (Login/Session) bzw. bei Hash-Wechsel
  function applyHash(){
    var h=(location.hash||"").replace(/^#/,"");
    if(TABS.indexOf(h)<0) return;
    var app=document.getElementById("app-view");
    if(app && !app.classList.contains("hidden") && typeof setTab==="function"){ try{ setTab(h); }catch(e){} }
  }
  window.addEventListener("hashchange", applyHash);
  window.addEventListener("load", function(){ setTimeout(applyHash, 350); });
  var app=document.getElementById("app-view");
  if(app && "MutationObserver" in window){
    new MutationObserver(function(){ if(!app.classList.contains("hidden")) applyHash(); })
      .observe(app, { attributes:true, attributeFilter:["class"] });
  }
})();


/* ===== Flipdeck · ausgelagerter Inline-Block 3 ===== */

/* ===== v2.2 · Passwort-Generator — eigenständig, lokal, crypto-sicher ===== */
(function(){
  "use strict";
  var $=function(s){ return document.querySelector(s); };
  if(!$("#pw-len")) return;
  var SETS={ upper:"ABCDEFGHJKLMNOPQRSTUVWXYZ", lower:"abcdefghijklmnopqrstuvwxyz", digits:"0123456789", special:"!%#-" };
  var TGL={ upper:"pw-upper", lower:"pw-lower", digits:"pw-digits", special:"pw-special" };
  function rnd(max){ var a=new Uint32Array(1); (window.crypto||window.msCrypto).getRandomValues(a); return a[0]%max; }
  function blocksOn(){ var b=document.getElementById("pw-blocks"); return !!(b && b.getAttribute("aria-pressed")==="true"); }
  function pool(){ var p="",parts=[]; var keys=blocksOn()?["upper","lower","digits"]:["upper","lower","digits","special"];
    keys.forEach(function(k){ var b=document.getElementById(TGL[k]); if(b&&b.getAttribute("aria-pressed")==="true"){ p+=SETS[k]; parts.push(SETS[k]); } }); return {pool:p,parts:parts}; }
  function pick(set, prev){ var ch, t=0; do{ ch=set[rnd(set.length)]; t++; }while(ch===prev && t<25); return ch; }
  function blockFormat(s){ var out=[]; for(var i=0;i<s.length;i+=6) out.push(s.slice(i,i+6)); return out.join("-"); }
  function make(len){ var ap=pool(); if(!ap.pool) return ""; var out=[], prev="";
    var req=ap.parts.slice(); for(var i=req.length-1;i>0;i--){ var j=rnd(i+1),t=req[i]; req[i]=req[j]; req[j]=t; }
    for(var p=0;p<req.length && out.length<len;p++){ var c=pick(req[p],prev); out.push(c); prev=c; }
    while(out.length<len){ var c2=pick(ap.pool,prev); out.push(c2); prev=c2; }
    var raw=out.slice(0,len).join(""); return blocksOn()?blockFormat(raw):raw; }
  function strength(pw){ if(!pw||pw==="—") return {pct:0,label:"—",color:"var(--sub)",bits:0}; var real=pw.replace(/-/g,""); var sz=pool().pool.length||1; var bits=Math.round(real.length*(Math.log(sz)/Math.log(2))); var label,color; if(bits<40){label="Schwach";color="#FB7185";} else if(bits<60){label="Mittel";color="#FBBF24";} else if(bits<90){label="Stark";color="#34D399";} else {label="Sehr stark";color="#22C55E";} return {pct:Math.max(6,Math.min(100,Math.round(bits/110*100))),label:label,color:color,bits:bits}; }
  function fill(el){ var mn=+el.min||0,mx=+el.max||100; el.style.setProperty("--pct", ((+el.value-mn)/(mx-mn)*100)+"%"); }
  function fbCopy(t){ var ta=document.createElement("textarea"); ta.value=t; ta.style.position="fixed"; ta.style.opacity="0"; document.body.appendChild(ta); ta.focus(); ta.select(); try{ document.execCommand("copy"); }catch(e){} document.body.removeChild(ta); }
  function copy(text, iconBtn, labelEl){
    function done(){
      if(labelEl){ var o=labelEl.textContent; labelEl.textContent="Kopiert ✓"; setTimeout(function(){ labelEl.textContent=o; },1200); }
      if(iconBtn){ var oh=iconBtn.innerHTML; iconBtn.style.color="var(--accent)"; iconBtn.innerHTML='<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>'; setTimeout(function(){ iconBtn.innerHTML=oh; iconBtn.style.color=""; },1200); }
      if(typeof showToast==="function"){ try{ showToast("✓ Passwort kopiert"); }catch(e){} }
    }
    if(navigator.clipboard&&navigator.clipboard.writeText){ navigator.clipboard.writeText(text).then(done,function(){ fbCopy(text); done(); }); }
    else { fbCopy(text); done(); }
  }
  var current="";
  function setStrength(pw){ var s=strength(pw); $("#pw-strength-bar").style.width=s.pct+"%"; $("#pw-strength-bar").style.background=s.color; var l=$("#pw-strength-label"); l.textContent=s.label; l.style.color=pw?s.color:"var(--sub)"; $("#pw-entropy").textContent=pw?("≈ "+s.bits+" Bit Entropie"):""; }
  function renderMain(){ var ap=pool(); if(!ap.pool){ $("#pw-warn").classList.remove("hidden"); $("#pw-main").textContent="—"; current=""; setStrength(""); return; } $("#pw-warn").classList.add("hidden"); current=make(+$("#pw-len").value); $("#pw-main").textContent=current; setStrength(current); }
  var copySVG='<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2.5"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
  function renderList(){ var ap=pool(); var wrap=$("#pw-list"); wrap.innerHTML=""; if(!ap.pool){ $("#pw-warn").classList.remove("hidden"); return; } $("#pw-warn").classList.add("hidden"); var n=+$("#pw-count").value,len=+$("#pw-len").value,frag=document.createDocumentFragment(); for(var i=0;i<n;i++){ (function(){ var pw=make(len); var row=document.createElement("div"); row.className="pw-item"; var code=document.createElement("code"); code.textContent=pw; var btn=document.createElement("button"); btn.className="iconbtn"; btn.title="Kopieren"; btn.innerHTML=copySVG; btn.addEventListener("click",function(){ copy(pw,btn,null); }); row.appendChild(code); row.appendChild(btn); frag.appendChild(row); })(); } wrap.appendChild(frag); }
  // Verdrahtung
  fill($("#pw-len")); fill($("#pw-count"));
  $("#pw-len").addEventListener("input",function(){ fill(this); $("#pw-len-val").textContent=this.value; renderMain(); });
  $("#pw-count").addEventListener("input",function(){ fill(this); $("#pw-count-val").textContent=this.value; });
  Object.keys(TGL).forEach(function(k){ var b=document.getElementById(TGL[k]); b.addEventListener("click",function(){ var on=b.getAttribute("aria-pressed")==="true"; if(on){ var act=Object.keys(TGL).filter(function(kk){ return document.getElementById(TGL[kk]).getAttribute("aria-pressed")==="true"; }); if(act.length<=1){ b.animate&&b.animate([{transform:"translateX(0)"},{transform:"translateX(-4px)"},{transform:"translateX(4px)"},{transform:"translateX(0)"}],{duration:240}); return; } } b.setAttribute("aria-pressed", on?"false":"true"); renderMain(); }); });
  function syncSpecial(){ var sp=document.getElementById("pw-special"); if(!sp) return; var off=blocksOn(); sp.style.opacity=off?".4":""; sp.style.pointerEvents=off?"none":""; }
  var blk=document.getElementById("pw-blocks");
  if(blk){ blk.addEventListener("click",function(){ blk.setAttribute("aria-pressed", blk.getAttribute("aria-pressed")==="true"?"false":"true"); syncSpecial(); renderMain(); }); }
  syncSpecial();
  $("#pw-refresh").addEventListener("click",renderMain);
  $("#pw-copy").addEventListener("click",function(){ if(current) copy(current,null,$("#pw-copy-label")); });
  $("#pw-generate").addEventListener("click",renderList);
  renderMain();
})();


/* ===== Flipdeck · ausgelagerter Inline-Block 4 ===== */

/* ===== v2.3 · Passwort anzeigen/verbergen — fügt jedem Passwortfeld einen Augen-Button hinzu ===== */
(function(){
  "use strict";
  var EYE='<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></svg>';
  var OFF='<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.9 4.2A11 11 0 0 1 12 4c6.5 0 10 8 10 8a18.4 18.4 0 0 1-3 3.8M6.2 6.3A18 18 0 0 0 2 12s3.5 8 10 8a11 11 0 0 0 3.8-.7"/><line x1="3" y1="3" x2="21" y2="21"/><path d="M9.5 9.6a3 3 0 0 0 4.2 4.3"/></svg>';
  function enhance(inp){
    if(inp.dataset.eye) return; inp.dataset.eye="1";
    var wrap=document.createElement("div"); wrap.className="pw-wrap";
    inp.parentNode.insertBefore(wrap, inp); wrap.appendChild(inp);
    var btn=document.createElement("button"); btn.type="button"; btn.className="pw-eye"; btn.tabIndex=-1;
    btn.setAttribute("aria-label","Passwort anzeigen oder verbergen"); btn.innerHTML=EYE;
    btn.addEventListener("click", function(){ var show=inp.type==="password"; inp.type=show?"text":"password"; btn.innerHTML=show?OFF:EYE; try{ inp.focus(); }catch(e){} });
    wrap.appendChild(btn);
  }
  function run(){ document.querySelectorAll('input[type="password"].field').forEach(enhance); }
  if(document.readyState==="loading") document.addEventListener("DOMContentLoaded",run); else run();
})();


/* ===== Flipdeck · ausgelagerter Inline-Block 5 ===== */

(function(){
  var ICON = document.querySelector('link[rel="apple-touch-icon"]');
  var ICON512 = document.getElementById("pwa-icon-512");
  var icons = [];
  if(ICON)    icons.push({ src: ICON.getAttribute("href"), sizes: "180x180", type: "image/png", purpose: "any" });
  if(ICON512) icons.push(
    { src: ICON512.getAttribute("href"), sizes: "512x512", type: "image/png", purpose: "any" },
    { src: ICON512.getAttribute("href"), sizes: "512x512", type: "image/png", purpose: "maskable" }
  );
  var manifest = {
    name: "Flipdeck", short_name: "Flipdeck",
    description: "Reselling-Cockpit — Profit-Tracker, Bestand & eBay-Gebühren",
    start_url: location.pathname + location.search,
    scope: location.pathname.replace(/[^/]*$/, ""),
    display: "standalone", orientation: "portrait",
    background_color: "#181D21", theme_color: "#181D21",
    icons: icons
  };
  try{
    var url = URL.createObjectURL(new Blob([JSON.stringify(manifest)], {type:"application/manifest+json"}));
    var link = document.createElement("link"); link.rel="manifest"; link.href=url;
    document.head.appendChild(link);
  }catch(e){ console.warn("Manifest konnte nicht erzeugt werden:", e); }

  /* Android/Chrome: eigener Install-Button statt Browser-Banner */
  var deferred = null;
  window.addEventListener("beforeinstallprompt", function(e){
    e.preventDefault(); deferred = e;
    var b = document.getElementById("pwa-install");
    if(b) b.classList.remove("hidden");
  });
  document.addEventListener("click", function(e){
    var b = e.target.closest && e.target.closest("#pwa-install");
    if(!b || !deferred) return;
    deferred.prompt();
    deferred.userChoice.finally(function(){ deferred=null; b.classList.add("hidden"); });
  });
  window.addEventListener("appinstalled", function(){
    var b = document.getElementById("pwa-install"); if(b) b.classList.add("hidden");
  });
})();


/* ===== Flipdeck · ausgelagerter Inline-Block 6 ===== */

(function(){
  if("serviceWorker" in navigator && location.protocol.startsWith("http")){
    window.addEventListener("load", function(){
      navigator.serviceWorker.register("./sw.js").catch(function(err){
        console.info("[pwa] kein Service Worker aktiv:", err && err.message);
      });
    });
  }

  /* Die alte Offline-Leiste ist ersatzlos entfernt (v5.0.4).
     Sie hat nur GERATEN, ob Netz da ist – und lag dabei oft daneben
     (iOS-PWA, VPN, Firmennetz), während Speichern längst funktionierte.
     Ein Fehlschlag beim Speichern wird weiterhin gemeldet, aber erst
     dann, wenn er wirklich passiert ist: showSaveError() in dbSave()
     wertet die echte Antwort des Servers aus. Warnung statt Vermutung.
     netRecheck/netMarkOk bleiben als wirkungslose Platzhalter bestehen,
     damit ältere Aufrufer nicht ins Leere greifen. */
  window.netRecheck = function(){};
  window.netMarkOk  = function(){};
})();


