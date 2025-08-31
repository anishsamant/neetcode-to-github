// content.js
// SPA-aware, idempotent mounting, robust language + difficulty detection,
// default-branch discovery, guarded observers, DOM-ready waits,
// and per-problem metadata cache (title/difficulty/statement) with
// SAFE chrome.storage calls & lifecycle guards to avoid "Extension context invalidated".

(() => {
  const LOG_PREFIX = "[NeetCode→GitHub]";
  const debug = false;
  const log = (...a) => debug && console.log(LOG_PREFIX, ...a);

  // ========= lifecycle guard =========
  let alive = true;
  const teardown = [];
  function isRuntimeAlive() {
    // if the extension has been reloaded/unloaded, chrome.runtime.id is undefined
    return typeof chrome !== "undefined" && chrome?.runtime?.id && alive;
  }
  window.addEventListener("pagehide", () => { alive = false; teardown.forEach(fn => { try { fn(); } catch {} }); });
  window.addEventListener("unload",   () => { alive = false; teardown.forEach(fn => { try { fn(); } catch {} }); });

  // ========= SAFE storage helpers (fix for "Extension context invalidated") =========
  async function safeStorageGet(keys) {
    if (!isRuntimeAlive()) return {};
    try {
      return await chrome.storage.local.get(keys);
    } catch (e) {
      if (debug) console.warn(LOG_PREFIX, "storage.get failed:", e?.message || e);
      return {};
    }
  }
  async function safeStorageSet(obj) {
    if (!isRuntimeAlive()) return;
    try {
      await chrome.storage.local.set(obj);
    } catch (e) {
      if (debug) console.warn(LOG_PREFIX, "storage.set failed:", e?.message || e);
    }
  }

  // ---------- small helpers ----------
  async function waitFor(selectors, { timeout = 4000, interval = 100 } = {}) {
    const sel = Array.isArray(selectors) ? selectors : [selectors];
    const start = Date.now();
    while (Date.now() - start < timeout) {
      if (!alive) return null;
      for (const s of sel) {
        const el = document.querySelector(s);
        if (el) return el;
      }
      await new Promise(r => setTimeout(r, interval));
    }
    return null;
  }
  function isProblemPage() { return /^\/problems\/[^/]+/i.test(location.pathname); }
  function getProblemSlug() {
    const m = location.pathname.match(/^\/problems\/([^/?#]+)/i);
    return m ? decodeURIComponent(m[1]) : "";
  }

  // ---------- SPA route watcher ----------
  (function routeWatcher() {
    let lastUrl = location.href;
    const notify = () => {
      if (!alive) return;
      const cur = location.href;
      if (cur !== lastUrl) { lastUrl = cur; window.dispatchEvent(new Event("nc-route-changed")); }
    };
    const p = history.pushState, r = history.replaceState;
    history.pushState = function(...args){ p.apply(this,args); notify(); };
    history.replaceState = function(...args){ r.apply(this,args); notify(); };
    window.addEventListener("popstate", notify);
    const iid = setInterval(notify, 500);
    teardown.push(() => clearInterval(iid));
  })();

  // ---------- persistent cache (by slug) ----------
  async function loadCache() {
    const { ncProblemCache = {} } = await safeStorageGet(["ncProblemCache"]);
    return ncProblemCache;
  }
  async function saveCache(cache) { await safeStorageSet({ ncProblemCache: cache }); }
  async function readFromCache(slug) { const c = await loadCache(); return c[slug] || null; }
  async function writeToCache(slug, patch) {
    const c = await loadCache();
    c[slug] = { ...(c[slug] || {}), ...patch, updatedAt: Date.now() };
    await saveCache(c);
  }

  // ---------- mount per route ----------
  let mountedFor = null;
  async function ensureMountedForCurrentProblem() {
    if (!alive) return;
    if (!isProblemPage()) return;
    const key = location.pathname + location.search;
    if (mountedFor === key) return;
    mountedFor = key;
    injectButton();
    hookAutoPush();
    refreshProblemCacheIfPossible(); // opportunistic capture on Question tab
  }
  window.addEventListener("nc-route-changed", ensureMountedForCurrentProblem);
  document.addEventListener("readystatechange", ensureMountedForCurrentProblem);
  window.addEventListener("load", ensureMountedForCurrentProblem);
  ensureMountedForCurrentProblem();

  // also when user clicks “Question” tab, refresh cache after render
  document.addEventListener("click", (e) => {
    const t = e.target;
    const label = t && (t.innerText || t.textContent || "").trim().toLowerCase();
    if (label === "question") setTimeout(refreshProblemCacheIfPossible, 300);
  });

  // Guarded observer
  const mo = new MutationObserver(() => {
    if (!alive) return;
    if (!isProblemPage()) return;
    injectButton();
    hookAutoPush();
    refreshProblemCacheIfPossible();
  });
  mo.observe(document.body, { childList: true, subtree: true });
  teardown.push(() => mo.disconnect());

  // ---------- language / ext ----------
  const EXT_MAP = { javascript:"js", typescript:"ts", python:"py", python3:"py", java:"java",
    "c++":"cpp", cpp:"cpp", c:"c", go:"go", golang:"go", rust:"rs", kotlin:"kt", swift:"swift" };
  function normalizeLangId(id=""){
    const s=id.toLowerCase().trim();
    if (s==="node"||s==="ecmascript"||s==="es6") return "javascript";
    if (s==="typescriptreact") return "typescript";
    if (s==="python3") return "python";
    if (s==="c++"||s==="c/c++"||s==="cpp17"||s==="cxx") return "cpp";
    return s;
  }
  function detectLanguageRaw(){
    try{ if (window.monaco?.editor){ const m=monaco.editor.getModels(); if (m&&m[0]){ const id=normalizeLangId(m[0].getLanguageId?.()||""); if(id) return id; }}}catch{}
    const cm=document.querySelector(".CodeMirror");
    if (cm?.CodeMirror){ const mode=cm.CodeMirror.getOption("mode"); if (mode) return normalizeLangId(typeof mode==="string"?mode:mode?.name||""); }
    const dd=document.querySelector('.dropdown-item.selected-item, [data-testid="lang-select"]');
    if (dd) return normalizeLangId(dd.textContent||dd.value||"");
    const badge=document.querySelector('[data-language], .language-badge, .lang-label');
    if (badge) return normalizeLangId(badge.getAttribute("data-language")||badge.textContent||"");
    return "";
  }
  function detectExtensionByCodeHeuristic(code){
    if (/^\s*#include\s+<.*>/m.test(code)) return "cpp";
    if (/^\s*import\s+java\./m.test(code)) return "java";
    if (/^\s*def\s+\w+/m.test(code)) return "py";
    if (/(=>|function|\bconsole\.)/.test(code)) return "js";
    return "txt";
  }
  function detectExtension(code){ return EXT_MAP[detectLanguageRaw()] || detectExtensionByCodeHeuristic(code); }

  // ---------- difficulty detection + cache ----------
  function normalizeDifficulty(raw=""){
    const s=raw.toLowerCase(); if (s.includes("easy")) return "Easy";
    if (s.includes("medium")) return "Medium";
    if (s.includes("hard")) return "Hard";
    return "";
  }
  function textMatchDifficultyFrom(el){
    if (!el) return ""; const txt=(el.innerText||el.textContent||"").trim(); return normalizeDifficulty(txt);
  }
  function findDifficultyOnce(){
    const sels=[
      ".difficulty-btn",".difficulty-chip",".tag-difficulty","[data-difficulty]",
      "[aria-label*='Difficulty']","[class*='difficulty']","[data-testid='difficulty']",
      ".question-tab .flex-container-row"
    ];
    for (const s of sels){ const el=document.querySelector(s); if (!el) continue;
      const a=normalizeDifficulty(el.getAttribute?.("data-difficulty")||""); if (a) return a;
      const t=textMatchDifficultyFrom(el); if (t) return t;
    }
    const crumbs=document.querySelectorAll(".breadcrumb li, nav[aria-label='breadcrumb'] li, .breadcrumbs li");
    for (const li of crumbs){ const d=textMatchDifficultyFrom(li); if (d) return d; }
    const tags=document.querySelectorAll(".tag-list .tag, .chip, .badge, [class*='chip'], [class*='badge']");
    for (const el of tags){ const d=textMatchDifficultyFrom(el); if (d) return d; }
    const g=textMatchDifficultyFrom(document.body); if (g) return g;
    return "";
  }
  async function detectDifficulty({ timeout=2500, interval=100 } = {}){
    const start=Date.now(); let found=findDifficultyOnce();
    while(!found && (Date.now()-start)<timeout){
      if (!alive) break;
      await new Promise(r=>setTimeout(r,interval));
      found=findDifficultyOnce();
    }
    return found || "";
  }
  async function getDifficultyForCurrentProblem(){
    const slug=getProblemSlug(); if (!slug) return "Uncategorized";
    const cache=await readFromCache(slug);
    if (cache?.difficulty) return cache.difficulty;
    const det=await detectDifficulty(); const norm=normalizeDifficulty(det) || "Uncategorized";
    if (norm==="Easy"||norm==="Medium"||norm==="Hard") await writeToCache(slug,{ difficulty:norm });
    return norm;
  }

  // ---------- editor code (kept as your working version) ----------
  function getCode(){
    const cm=document.querySelector(".CodeMirror"); if (cm?.CodeMirror) return cm.CodeMirror.getValue();
    if (window.monaco?.editor){ const m=monaco.editor.getModels()[0]; if (m) return m.getValue(); }
    const lines=document.querySelectorAll(".view-line"); if (lines.length) return Array.from(lines).map(l=>l.textContent).join("\n");
    return document.querySelector("textarea")?.value || "";
  }

  // ---------- cache refresh when Question tab visible ----------
  async function refreshProblemCacheIfPossible(){
    if (!alive) return;
    if (!isProblemPage()) return;
    const slug=getProblemSlug(); if (!slug) return;

    const titleEl=document.querySelector(".question-tab .flex-container-row h1, [data-testid='problem-title']");
    const domTitle=titleEl?.textContent?.trim();
    const diff=normalizeDifficulty(findDifficultyOnce());

    const stmtEl=document.querySelector("app-prompt app-article");
    let stmtHTML=""; if (stmtEl){ const c=stmtEl.cloneNode(true); c.querySelectorAll("button, .copy-button, .copy-code-button, .copy-text").forEach(e=>e.remove()); stmtHTML=c.innerHTML.trim(); }

    const patch={};
    if (domTitle) patch.title = domTitle;               // ONLY cache title from DOM
    if (diff)     patch.difficulty = diff;
    if (stmtHTML) patch.stmtHTML = stmtHTML;

    if (Object.keys(patch).length) await writeToCache(slug, patch);
  }

  // ---------- gather metadata (cache-first, never overwrite title with slug) ----------
  let preSubmitSnapshot = null;

  async function gatherMetadata(){
    const slug=getProblemSlug();
    const cached = slug ? (await readFromCache(slug)) : null;

    // code (must exist)
    let code=getCode();
    if (!code.trim()){ await new Promise(r=>setTimeout(r,200)); code=getCode(); }
    if (!code.trim()) return null;

    // title: prefer DOM -> cached -> slug prettified (but NEVER cache the slug-based title)
    let titleFromDom = false;
    const titleEl = await waitFor(
      [".question-tab .flex-container-row h1", "[data-testid='problem-title']"],
      { timeout: 1200 }
    );
    let title = titleEl?.textContent?.trim();
    if (title) { titleFromDom = true; }
    if (!title && cached?.title) title = cached.title;
    if (!title && slug) {
      const pretty = slug.replace(/[-_]+/g," ").replace(/\b\w/g,c=>c.toUpperCase());
      title = pretty || "Solution";
    }
    if (!title) title = "Solution";

    // statement: DOM -> cached
    let stmtHTML = "";
    const stmtEl = await waitFor("app-prompt app-article", { timeout: 800 });
    if (stmtEl){ const c=stmtEl.cloneNode(true); c.querySelectorAll("button, .copy-button, .copy-code-button, .copy-text").forEach(e=>e.remove()); stmtHTML=c.innerHTML.trim(); }
    else if (cached?.stmtHTML){ stmtHTML = cached.stmtHTML; }

    // difficulty/category: cache helper
    const difficulty = await getDifficultyForCurrentProblem();
    const category = (difficulty || "Uncategorized").replace(/[\/\\\s]+/g,"_");

    // lang/ext
    const languageId = detectLanguageRaw();
    const ext = detectExtension(code);

    // update cache
    if (slug){
      const patch = {};
      if (titleFromDom && title && title !== cached?.title) patch.title = title;
      if (stmtHTML && stmtHTML !== cached?.stmtHTML) patch.stmtHTML = stmtHTML;
      if ((difficulty==="Easy"||difficulty==="Medium"||difficulty==="Hard") && difficulty !== cached?.difficulty) patch.difficulty = difficulty;
      if (Object.keys(patch).length) await writeToCache(slug, patch);
    }

    return { code, title, stmtHTML, category, ext, languageId };
  }

  // ---------- UI ----------
  function injectButton(){
    const row=document.querySelector(".question-tab .flex-container-row");
    if (!row || row.querySelector("#push-gh-btn")) return;
    const h1=row.querySelector("h1"); if (!h1) return;
    const btn=document.createElement("button");
    btn.id="push-gh-btn"; btn.textContent="Push to GitHub";
    Object.assign(btn.style,{ marginLeft:"8px", padding:"4px 10px", background:"#28a745", color:"#fff",
      border:"none", borderRadius:"4px", cursor:"pointer", fontSize:"0.9rem" });
    h1.insertAdjacentElement("afterend", btn);
    btn.addEventListener("click", pushAll);
  }

  function hookAutoPush(){
    const submitBtn=document.querySelector('button.button.is-success[data-tooltip*="Enter"]');
    if (!submitBtn || submitBtn._gitHooked) return;
    submitBtn._gitHooked = true;
    submitBtn.addEventListener("click", async () => {
      preSubmitSnapshot = await gatherMetadata(); // capture while Question tab is visible
      setTimeout(pushAll, 3000);
    });
  }

  // ---------- GitHub helpers ----------
  async function getDefaultBranch(user, repo, token){
    const r=await fetch(`https://api.github.com/repos/${user}/${repo}`,{ headers:{ Authorization:`token ${token}` }});
    if (!r.ok) throw new Error(`Repo meta failed: ${r.status}`);
    const meta=await r.json(); return meta.default_branch || "main";
  }
  async function upsert(user, repo, token, path, content, message){
    const branch = await getDefaultBranch(user, repo, token);
    const head = await fetch(`https://api.github.com/repos/${user}/${repo}/contents/${encodeURIComponent(path)}?ref=${encodeURIComponent(branch)}`, { headers:{ Authorization:`token ${token}` }});
    const sha = head.status===200 ? (await head.json()).sha : undefined;
    const put = await fetch(`https://api.github.com/repos/${user}/${repo}/contents/${encodeURIComponent(path)}`, {
      method:"PUT",
      headers:{ Authorization:`token ${token}`, "Content-Type":"application/json", Accept:"application/vnd.github+json" },
      body: JSON.stringify({ message: message || `Add ${path}`, content, branch, ...(sha?{sha}:{}) })
    });
    if (!put.ok){ const txt=await put.text(); throw new Error(`Commit failed ${put.status}: ${txt}`); }
  }

  // ---------- main push ----------
  async function pushAll(){
    const { githubToken, githubLogin, repoName } = await safeStorageGet(["githubToken","githubLogin","repoName"]);
    if (!githubToken || !githubLogin || !repoName){ alert("Please authenticate & set your repo first."); return; }

    const meta = preSubmitSnapshot || await gatherMetadata();
    preSubmitSnapshot = null;
    if (!meta){ alert("Failed to gather problem data."); return; }

    const { code, title, stmtHTML, category, ext, languageId } = meta;
    const md = stmtHTML && stmtHTML.trim()
      ? `# [${title}](${location.href})\n\n${stmtHTML}`
      : `# [${title}](${location.href})\n\n*(Problem statement not captured — open the Question tab once to cache it.)*`;

    const safeTitle = title.replace(/[\/\\\s]+/g,"_");
    const base = `${category}/${safeTitle}`;

    const files = [
      { path: `${base}/${safeTitle}.${ext}`, content: btoa(unescape(encodeURIComponent(code))), message: `add/update: ${title} (${languageId || ext})` },
      { path: `${base}/${safeTitle}.md`,    content: btoa(unescape(encodeURIComponent(md))),   message: `add/update: statement for ${title}` },
      { path: `${base}/notes.md`,           content: btoa(""),                                  message: `add/update: notes for ${title}` }
    ];

    try {
      for (const f of files) await upsert(githubLogin, repoName, githubToken, f.path, f.content, f.message);
      alert("🎉 Pushed to GitHub!");
    } catch (e) {
      console.error(e);
      alert(`Push failed ${e.message || e}`);
    }
  }
})();
