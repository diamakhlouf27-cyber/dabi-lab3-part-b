import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const PORT = Number(process.env.PORT || 3000);
const YAPILY_BASE_URL = process.env.YAPILY_BASE_URL || 'https://api.yapily.com';
const CALLBACK_URL = process.env.CALLBACK_URL;
const INSTITUTION_ID = process.env.INSTITUTION_ID || 'modelo-sandbox';
const APPLICATION_USER_ID = process.env.APPLICATION_USER_ID || 'student-001';

function requireConfig() {
  const missing = [];
  if (!process.env.YAPILY_APPLICATION_ID) missing.push('YAPILY_APPLICATION_ID');
  if (!process.env.YAPILY_APPLICATION_SECRET) missing.push('YAPILY_APPLICATION_SECRET');
  if (!CALLBACK_URL) missing.push('CALLBACK_URL');
  if (missing.length) {
    throw new Error(`Missing environment variables: ${missing.join(', ')}`);
  }
}

function basicAuthHeader() {
  return 'Basic ' + Buffer.from(
    `${process.env.YAPILY_APPLICATION_ID}:${process.env.YAPILY_APPLICATION_SECRET}`
  ).toString('base64');
}

async function yapily(pathname, options = {}) {
  requireConfig();
  const headers = {
    Accept: 'application/json;charset=UTF-8',
    Authorization: basicAuthHeader(),
    ...(options.body ? { 'Content-Type': 'application/json;charset=UTF-8' } : {}),
    ...(options.headers || {})
  };

  const response = await fetch(`${YAPILY_BASE_URL}${pathname}`, {
    ...options,
    headers
  });

  const text = await response.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; }
  catch { data = { raw: text }; }

  if (!response.ok) {
    const error = new Error(`Yapily ${response.status}`);
    error.status = response.status;
    error.details = data;
    throw error;
  }
  return data;
}

function unwrap(response) {
  return response?.data ?? response;
}

function pickConsentToken(consent) {
  return consent?.consentToken || consent?.consent?.consentToken || null;
}

// Small in-memory store. It is enough for a classroom demo.
// For production, use a database/session store.
const flows = new Map();
let latestFlowId = null;

app.get('/api/config', (req, res) => {
  res.json({
    institutionId: INSTITUTION_ID,
    applicationUserId: APPLICATION_USER_ID,
    callbackUrl: CALLBACK_URL
  });
});

// Part B step 1: GET /institutions
app.get('/api/institutions', async (req, res) => {
  try {
    const result = await yapily('/institutions');
    const institutions = result?.data || [];
    res.json({ data: institutions });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message, details: err.details || String(err) });
  }
});

// Part B step 2: create account authorisation.
app.post('/api/connect', async (req, res) => {
  try {
    const institutionId = req.body?.institutionId || INSTITUTION_ID;
    const applicationUserId = req.body?.applicationUserId || APPLICATION_USER_ID;

    const body = {
      applicationUserId,
      institutionId,
      callback: CALLBACK_URL,
      // Keeps the actual consent token off the browser URL when supported.
      oneTimeToken: 'true'
    };

    const result = await yapily('/account-auth-requests', {
      method: 'POST',
      body: JSON.stringify(body)
    });

    const data = unwrap(result);
    const flowId = data?.id || data?.state || crypto.randomUUID();
    flows.set(flowId, {
      flowId,
      institutionId,
      applicationUserId,
      authRequest: data,
      createdAt: new Date().toISOString()
    });
    latestFlowId = flowId;

    res.json({
      flowId,
      authorisationUrl: data?.authorisationUrl,
      status: data?.status,
      data
    });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message, details: err.details || String(err) });
  }
});

// Part B step 3/4: Yapily sends the user back here.
app.get('/callback', handleCallback);
app.get('/callback/consent', handleCallback);

async function handleCallback(req, res) {
  try {
    const q = req.query;
    const flow = latestFlowId ? flows.get(latestFlowId) : null;

    if (q.error) {
      return res.redirect(`/?error=${encodeURIComponent(q.error_description || q.error)}`);
    }

    let consent;
    let consentToken = q.consentToken || q['consent-token'] || null;

    // Secure flow: exchange Yapily one-time-token server-side.
    const oneTimeToken = q.oneTimeToken || q['one-time-token'] || null;
    if (!consentToken && oneTimeToken) {
      const result = await yapily('/consent-one-time-token', {
        method: 'POST',
        body: JSON.stringify({ oneTimeToken })
      });
      consent = unwrap(result);
      consentToken = pickConsentToken(consent);
    }

    // OAuth-style redirect: exchange auth code + state server-side.
    if (!consentToken && (q.code || q.authCode)) {
      const result = await yapily('/consent-auth-code', {
        method: 'POST',
        body: JSON.stringify({
          authCode: q.authCode || q.code,
          authState: q.authState || q.state
        })
      });
      consent = unwrap(result);
      consentToken = pickConsentToken(consent);
    }

    // Some sandbox redirect flows expose consent directly.
    if (!consentToken && q.consent) {
      consentToken = q.consent;
    }

    if (!consentToken) {
      return res.status(400).send(renderError(
        'Callback received, but no consent token was found.',
        q
      ));
    }

    // If we received a consent object from an exchange, it normally contains its id.
    let consentId = consent?.id || consent?.consentId || consent?.institutionConsentId || null;

    // Retrieve accounts using the customer consent header.
    const accountsResult = await yapily('/accounts', {
      method: 'GET',
      headers: { consent: consentToken }
    });
    const accounts = accountsResult?.data || [];

    // Get consent duration when we have a Yapily consent id.
    let consentDetails = consent || {};
    if (consentId) {
      try {
        const detailResult = await yapily(`/consents/${encodeURIComponent(consentId)}`);
        consentDetails = unwrap(detailResult);
      } catch (e) {
        // Keep the exchanged consent data if the detail lookup is unavailable.
        consentDetails = { ...consentDetails, _detailLookupError: e.message };
      }
    }

    const completed = {
      flowId: flow?.flowId || latestFlowId,
      institutionId: flow?.institutionId || INSTITUTION_ID,
      applicationUserId: flow?.applicationUserId || APPLICATION_USER_ID,
      consentToken,
      consentId,
      consent: consentDetails,
      accounts,
      completedAt: new Date().toISOString()
    };

    const id = completed.flowId || crypto.randomUUID();
    flows.set(id, { ...(flows.get(id) || {}), ...completed });
    latestFlowId = id;

    // Do not put the consent token in the browser URL.
    res.redirect(`/?connected=1&flowId=${encodeURIComponent(id)}`);
  } catch (err) {
    res.status(err.status || 500).send(renderError(err.message, err.details || err.stack));
  }
}

app.get('/api/session/:flowId', (req, res) => {
  const flow = flows.get(req.params.flowId);
  if (!flow) return res.status(404).json({ error: 'Flow not found or server restarted.' });

  // Never return consentToken to the browser.
  const safe = { ...flow };
  delete safe.consentToken;
  res.json(safe);
});

app.get('/api/status', (req, res) => {
  const flow = latestFlowId ? flows.get(latestFlowId) : null;
  res.json({
    configured: Boolean(process.env.YAPILY_APPLICATION_ID && process.env.YAPILY_APPLICATION_SECRET && CALLBACK_URL),
    callbackUrl: CALLBACK_URL || null,
    latestFlow: flow ? {
      flowId: flow.flowId,
      institutionId: flow.institutionId,
      applicationUserId: flow.applicationUserId,
      status: flow.status,
      hasConsent: Boolean(flow.consentToken),
      accountCount: Array.isArray(flow.accounts) ? flow.accounts.length : 0
    } : null
  });
});

function renderError(message, details) {
  const safe = String(message).replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  const detail = typeof details === 'string' ? details : JSON.stringify(details, null, 2);
  return `<!doctype html><html><head><meta charset="utf-8"><title>Yapily callback error</title></head><body style="font-family:Arial;max-width:900px;margin:40px auto"><h1>Yapily callback error</h1><p>${safe}</p><pre>${String(detail).replaceAll('<','&lt;').replaceAll('>','&gt;')}</pre><p><a href="/">Back to app</a></p></body></html>`;
}

app.listen(PORT, () => {
  console.log(`DABI Lab 3 Part B running on port ${PORT}`);
  console.log(`Callback: ${CALLBACK_URL || '(set CALLBACK_URL in .env)'}`);
});
