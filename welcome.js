(async function() {
  // Elements
  const authSection  = document.getElementById('auth-section');
  const repoSection  = document.getElementById('repo-section');
  const statsSection = document.getElementById('stats-section');
  const deauthBtn    = document.getElementById('deauth-btn');
  const authBtn      = document.getElementById('auth-btn');
  const saveRepoBtn  = document.getElementById('save-repo-btn');
  const repoInput    = document.getElementById('repo-input');
  const repoError    = document.getElementById('repo-error');
  const ghUserEl     = document.getElementById('gh-user');
  const ghRepoEl     = document.getElementById('gh-repo');
  const totalEl      = document.getElementById('total');
  const easyEl       = document.getElementById('easy');
  const mediumEl     = document.getElementById('medium');
  const hardEl       = document.getElementById('hard');

  // Fetch saved state
  const { githubToken, githubLogin, repoName } =
    await chrome.storage.local.get(['githubToken','githubLogin','repoName']);

  // Utility to show one step only
  function showStep(stepEl) {
    [authSection, repoSection, statsSection].forEach(s => {
      s.classList.toggle('active', s === stepEl);
    });
  }

  // Initial UI state
  if (!githubToken || !githubLogin) {
    deauthBtn.style.display = 'none';
    showStep(authSection);
  } else {
    deauthBtn.style.display = 'block';
    ghUserEl.textContent = githubLogin;
    if (!repoName) {
      repoInput.value = '';
      repoError.style.display = 'none';
      showStep(repoSection);
    } else {
      ghRepoEl.textContent = `${githubLogin}/${repoName}`;
      showStep(statsSection);
      await loadStats(githubLogin, githubToken, repoName);
    }
  }

  // AUTHENTICATE
  authBtn.onclick = () => {
    chrome.runtime.sendMessage({ action: 'authenticate' });
  };

  // DE-AUTHENTICATE
  deauthBtn.onclick = () => {
    chrome.storage.local.remove(
      ['githubToken','githubLogin','repoName'],
      () => location.reload()
    );
  };

  // SAVE REPO with validation
  saveRepoBtn.onclick = async () => {
    const val = repoInput.value.trim();
    if (!val) {
      // Show error above input, add red border
      repoError.style.display = 'block';
      repoInput.classList.add('error');
      repoInput.focus();
      return;
    }
    // Clear error
    repoError.style.display = 'none';
    repoInput.classList.remove('error');

    // Save and advance
    await chrome.storage.local.set({ repoName: val });
    ghRepoEl.textContent = `${githubLogin}/${val}`;
    showStep(statsSection);
    await loadStats(githubLogin, githubToken, val);
  };

  // Clear error as soon as user types
  repoInput.addEventListener('input', () => {
    if (repoInput.value.trim()) {
      repoError.style.display = 'none';
      repoInput.classList.remove('error');
    }
  });

  // LOAD STATS
  async function loadStats(user, token, repo) {
    try {
      const headers = { Authorization: `token ${token}` };
      const root = await fetch(
        `https://api.github.com/repos/${user}/${repo}/contents?ref=main`,
        { headers }
      ).then(r => r.json());

      async function countSolved(folder) {
        const dir = root.find(
          e => e.name.toLowerCase() === folder.toLowerCase() && e.type === 'dir'
        );
        if (!dir) return 0;
        const list = await fetch(dir.url, { headers }).then(r => r.json());
        return list.filter(e => e.type === 'dir').length;
      }

      const [easyCount, midCount, hardCount] = await Promise.all([
        countSolved('Easy'),
        countSolved('Medium'),
        countSolved('Hard')
      ]);

      easyEl.textContent   = easyCount;
      mediumEl.textContent = midCount;
      hardEl.textContent   = hardCount;
      totalEl.textContent  = easyCount + midCount + hardCount;
    } catch (e) {
      console.error('Stats load failed', e);
    }
  }
})();
