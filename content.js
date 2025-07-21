// content.js
console.log('[NeetCode→GitHub] content script loaded');

const LANG_MAP = {
  java: 'java', 'c++': 'cpp', cpp: 'cpp',
  python: 'py', python3: 'py',
  javascript: 'js', typescript: 'ts'
};

let cache = null;

// ——————————————————
// Gather all metadata
// ——————————————————
function gatherMetadata() {
  // 1) Code: CodeMirror → Monaco → view-line → textarea
  const cmEl = document.querySelector('.CodeMirror');
  let code = '';
  if (cmEl?.CodeMirror) {
    code = cmEl.CodeMirror.getValue();
  } else if (window.monaco?.editor) {
    const m = monaco.editor.getModels()[0];
    code = m ? m.getValue() : '';
  } else {
    const lines = document.querySelectorAll('.view-line');
    if (lines.length) {
      code = Array.from(lines).map(l => l.textContent).join('\n');
    } else {
      code = document.querySelector('textarea')?.value || '';
    }
  }
  if (!code.trim()) return null;

  // 2) Title
  const title = document
    .querySelector('.question-tab .flex-container-row h1')
    ?.textContent.trim() || 'Solution';

  // 3) Full statement HTML, minus any “Copy” buttons
  const stmtEl = document.querySelector('app-prompt app-article');
  let stmtHTML = '';
  if (stmtEl) {
    const clone = stmtEl.cloneNode(true);
    clone.querySelectorAll('button, .copy-button, .copy-code-button, .copy-text')
         .forEach(e => e.remove());
    stmtHTML = clone.innerHTML;
  }

  // 4) Category: difficulty → first tag → breadcrumbs → “General”
  let category = '';
  const diff = document.querySelector('.difficulty-btn');
  if (diff) category = diff.textContent.trim();
  if (!category) {
    const tag = document.querySelector('.tag-list .tag');
    if (tag) category = tag.textContent.trim();
  }
  if (!category) {
    const crumbs = [...document.querySelectorAll('.breadcrumb li')]
      .map(li => li.textContent.trim())
      .filter(Boolean);
    category = crumbs[1] || crumbs[0] || 'General';
  }
  category = category.replace(/[\/\\\s]+/g, '_');

  // 5) Extension from language dropdown → CodeMirror mode
  let rawLang = document
    .querySelector('.dropdown-item.selected-item')?.textContent.trim().toLowerCase()
    || '';
  if (!rawLang && cmEl?.CodeMirror) {
    rawLang = cmEl.CodeMirror.getOption('mode') || '';
  }
  let ext = 'txt';
  for (const k in LANG_MAP) {
    if (rawLang.includes(k)) {
      ext = LANG_MAP[k];
      break;
    }
  }

  return { code, title, stmtHTML, category, ext };
}

// ——————————————————
// Inject button beside <h1>
// ——————————————————
function injectButton() {
  const row = document.querySelector('.question-tab .flex-container-row');
  if (!row || row.querySelector('#push-gh-btn')) return;
  const titleEl = row.querySelector('h1');
  if (!titleEl) return;

  const btn = document.createElement('button');
  btn.id = 'push-gh-btn';
  btn.textContent = 'Push to GitHub';
  Object.assign(btn.style, {
    marginLeft: '8px',
    padding:    '4px 10px',
    background: '#28a745',
    color:      '#fff',
    border:     'none',
    borderRadius: '4px',
    cursor:     'pointer',
    fontSize:   '0.9rem'
  });
  titleEl.insertAdjacentElement('afterend', btn);
  btn.addEventListener('click', pushAll);
}

// ——————————————————
// Hook auto-push ~3s after clicking Submit
// ——————————————————
function hookAutoPush() {
  const submitBtn = document.querySelector(
    'button.button.is-success[data-tooltip*="Enter"]'
  );
  if (!submitBtn || submitBtn._gitHooked) return;
  submitBtn._gitHooked = true;

  submitBtn.addEventListener('click', () => {
    // Cache metadata _before_ the SPA switches tabs
    cache = gatherMetadata();
    setTimeout(pushAll, 3000);
  });
}

// ——————————————————
// Observe SPA changes
// ——————————————————
new MutationObserver(() => {
  injectButton();
  hookAutoPush();
}).observe(document.body, { childList: true, subtree: true });
injectButton();
hookAutoPush();

// ——————————————————
// Main push logic
// ——————————————————
async function pushAll() {
  console.log('[NeetCode→GitHub] pushAll()');
  const { githubToken, githubLogin, repoName } = await chrome.storage.local.get(
    ['githubToken', 'githubLogin', 'repoName']
  );
  if (!githubToken || !githubLogin || !repoName) {
    return alert('Please authenticate & set your repo first.');
  }

  // Use cached metadata if present, else re-gather
  const meta = cache || gatherMetadata();
  cache = null;
  if (!meta) return alert('Failed to gather problem data.');

  const { code, title, stmtHTML, category, ext } = meta;
  const md = `# [${title}](${location.href})\n\n${stmtHTML}`;

  const safeTitle = title.replace(/[\/\\\s]+/g, '_');
  const base = `${category}/${safeTitle}`;
  const files = [
    { path:`${base}/${safeTitle}.${ext}`, content:btoa(unescape(encodeURIComponent(code))) },
    { path:`${base}/${safeTitle}.md`,     content:btoa(unescape(encodeURIComponent(md))) },
    { path:`${base}/notes.md`,            content:btoa('') }
  ];

  for (const f of files) {
    await upsert(githubLogin, repoName, githubToken, f.path, f.content);
  }
  alert('🎉 Pushed to GitHub!');
}

// ——————————————————
// GitHub create/update helper
// ——————————————————
async function upsert(user, repo, token, path, content) {
  const url = `https://api.github.com/repos/${user}/${repo}/contents/${path}`;
  const res = await fetch(url, {
    headers: { Authorization:`token ${token}` }
  });
  // 404 is okay (means file not exist)
  const sha = res.status === 200 ? (await res.json()).sha : '';
  await fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: `token ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      message: `Add ${path}`,
      content,
      branch: 'main',
      ...(sha && { sha })
    })
  });
}
