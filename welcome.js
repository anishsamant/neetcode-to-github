// welcome.js
(async function() {
  const store = await chrome.storage.local.get(['githubLogin']);
  document.getElementById('gh-user').textContent = store.githubLogin || 'Unknown';

  document.getElementById('save-repo').onclick = async () => {
    const name = document.getElementById('repo-name').value.trim();
    if (!name) return alert('Repo name cannot be empty');
    await chrome.storage.local.set({ repoName: name });
    alert(`✅ Saved repo: ${store.githubLogin}/${name}`);
  };

  document.getElementById('logout').onclick = () => {
    chrome.storage.local.remove(['githubToken','githubLogin'], () => {
      alert('You have been logged out.');
      window.location.reload();
    });
  };
})();
