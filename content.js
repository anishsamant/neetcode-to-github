// content.js
function inject() {
  const hdr = document.querySelector('.problem-header');
  if (!hdr || hdr.querySelector('#push-gh-btn')) return;
  const btn = document.createElement('button');
  btn.id = 'push-gh-btn';
  btn.textContent = 'Push to GitHub';
  Object.assign(btn.style, {
    marginLeft: '12px', padding: '6px 12px',
    background: '#28a745', color: '#fff',
    border: 'none', borderRadius: '4px', cursor: 'pointer'
  });
  hdr.appendChild(btn);
  btn.onclick = pushAll;
}

async function pushAll() {
  const { githubToken, githubLogin, repoName } = await chrome.storage.local.get(
    ['githubToken','githubLogin','repoName']
  );
  if (!githubToken||!githubLogin||!repoName) {
    return alert('Authenticate & set repo first via the toolbar icon.');
  }

  // Grab code
  const code = document.querySelector('textarea')?.value
             || document.querySelector('.CodeMirror')?.CodeMirror.getValue()
             || '';
  if (!code.trim()) return alert('No code found on page.');

  // Title & statement
  const title = document.querySelector('.problem-title')?.textContent.trim();
  const stmt  = document.querySelector('.problem-statement')?.textContent.trim();
  const md    = `# ${title}\n\n[View on NeetCode](${location.href})\n\n${stmt}`;

  // Category & safe names
  const crumbs = [...document.querySelectorAll('.breadcrumb li')].map(li=>li.textContent.trim());
  const category = (crumbs[1]||'General').replace(/[\/\\\s]+/g,'_');
  const safeTitle = title.replace(/[\/\\\s]+/g,'_');

  // Language extension
  let ext = 'txt';
  if (/^\s*#include/m.test(code)) ext = 'cpp';
  else if (/^\s*import\s+java/m.test(code)) ext = 'java';
  else if (/^\s*def\s+/m.test(code)) ext = 'py';

  // Files to push
  const base = `${category}/${safeTitle}`;
  const files = [
    { path:`${base}/${safeTitle}.${ext}`, content:btoa(unescape(encodeURIComponent(code))) },
    { path:`${base}/${safeTitle}.md`,    content:btoa(unescape(encodeURIComponent(md))) },
    { path:`${base}/notes.md`,           content:btoa('') }
  ];

  // Upsert each file
  for (let f of files) {
    await upsert(githubLogin, repoName, githubToken, f.path, f.content);
  }
  alert('🎉 All files pushed!');
}

async function upsert(user, repo, token, path, content) {
  const api = `https://api.github.com/repos/${user}/${repo}/contents/${path}`;
  const res = await fetch(api, { headers:{Authorization:`token ${token}`}});
  let sha = '';
  if (res.status===200) {
    const json = await res.json();
    sha = json.sha;
  }
  const body = { message:`Add ${path}`, content, branch:'main', ...(sha && {sha}) };
  await fetch(api, {
    method: 'PUT',
    headers:{
      Authorization:`token ${token}`,
      'Content-Type':'application/json'
    },
    body: JSON.stringify(body)
  });
}

new MutationObserver(inject).observe(document.body,{childList:true,subtree:true});
inject();
