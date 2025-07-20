// background.js
let CONFIG = {};
// Load config.json so we know our client_id & backend URL
fetch(chrome.runtime.getURL('config.json'))
  .then(r => r.json())
  .then(cfg => CONFIG = cfg)
  .catch(err => console.error('Failed loading config:', err));

// On toolbar click → fire GitHub OAuth
chrome.action.onClicked.addListener(async () => {
  try {
    const redirectUri = chrome.identity.getRedirectURL('provider_cb');
    const authUrl = `https://github.com/login/oauth/authorize`
      + `?client_id=${CONFIG.GITHUB_OAUTH_CLIENT_ID}`
      + `&redirect_uri=${encodeURIComponent(redirectUri)}`
      + `&scope=repo`;
    
    const redirect = await chrome.identity.launchWebAuthFlow({
      url: authUrl,
      interactive: true
    });
    const code = new URL(redirect).searchParams.get('code');
    if (!code) throw new Error('No code returned from GitHub');

    // Exchange code for token
    const resp = await fetch(`${CONFIG.BACKEND_URL}/exchange`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, redirect_uri: redirectUri })
    });
    const { access_token } = await resp.json();
    if (!access_token) throw new Error('No access_token in response');

    // Fetch GitHub user login
    const user = await fetch('https://api.github.com/user', {
      headers: { Authorization: `token ${access_token}` }
    }).then(r => r.json());
    if (!user.login) throw new Error('Failed fetching GitHub user');

    // Save token & login, then open welcome.html
    await chrome.storage.local.set({
      githubToken: access_token,
      githubLogin: user.login
    });
    chrome.tabs.create({ url: chrome.runtime.getURL('welcome.html') });

  } catch (err) {
    console.error('Auth flow error:', err);
    alert('GitHub authentication failed. See console for details.');
  }
});
