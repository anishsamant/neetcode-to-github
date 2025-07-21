// background.js
let CONF = {};
fetch(chrome.runtime.getURL('config.json'))
  .then(r => r.json())
  .then(c => (CONF = c))
  .catch(console.error);

async function startAuthFlow(tabId) {
  const redirectUri = chrome.identity.getRedirectURL('provider_cb');
  const authUrl =
    `https://github.com/login/oauth/authorize` +
    `?client_id=${CONF.GITHUB_OAUTH_CLIENT_ID}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&scope=repo`;

  const redirect = await chrome.identity.launchWebAuthFlow({
    url: authUrl,
    interactive: true
  });
  const code = new URL(redirect).searchParams.get('code');
  if (!code) throw new Error('No code returned');

  const resp = await fetch(`${CONF.BACKEND_URL}/exchange`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, redirect_uri: redirectUri })
  });
  const { access_token } = await resp.json();
  if (!access_token) throw new Error('No token');

  const user = await fetch('https://api.github.com/user', {
    headers: { Authorization: `token ${access_token}` }
  }).then(r => r.json());
  if (!user.login) throw new Error('No login');

  await chrome.storage.local.set({
    githubToken: access_token,
    githubLogin: user.login
  });

  // Open welcome.html in the same tab if initiated from welcome page,
  // or in a new tab otherwise
  if (tabId) {
    chrome.tabs.update(tabId, { url: chrome.runtime.getURL('welcome.html') });
  } else {
    chrome.tabs.create({ url: chrome.runtime.getURL('welcome.html') });
  }
}

// Toolbar icon now opens welcome.html
chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: chrome.runtime.getURL('welcome.html') });
});

// Listen for “authenticate” messages from welcome.js
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg.action === 'authenticate') {
    const tabId = sender.tab?.id;
    startAuthFlow(tabId).catch(err => {
      console.error('Auth error:', err);
      if (tabId) {
        chrome.tabs.sendMessage(tabId, { action: 'auth_failed' });
      }
    });
  }
});
