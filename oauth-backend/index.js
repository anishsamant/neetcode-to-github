require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();
app.use(cors(), express.json());

app.post('/exchange', async (req, res) => {
  const { code, redirect_uri } = req.body;
  try {
    const gh = await axios.post(
      'https://github.com/login/oauth/access_token',
      {
        client_id: process.env.GITHUB_CLIENT_ID,
        client_secret: process.env.GITHUB_CLIENT_SECRET,
        code,
        redirect_uri
      },
      { headers: { Accept: 'application/json' } }
    );
    res.json(gh.data);
  } catch (e) {
    console.error('OAuth error', e.response?.data || e);
    res.status(500).json({ error: 'exchange_failed' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`OAuth backend on ${PORT}`));
