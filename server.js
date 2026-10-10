
import express from "express";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { randomUUID } from "crypto";

dotenv.config();

const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(express.json());

// Temporary in-memory storage for this lab.
// Sessions are lost if the Render service restarts.
const sessions = new Map();

const YAPILY_BASE_URL = "https://api.yapily.com";

function getAuthHeaders() {
  const appId = process.env.YAPILY_APPLICATION_ID;
  const appSecret = process.env.YAPILY_APPLICATION_SECRET;

  if (!appId || !appSecret) {
    throw new Error(
      "YAPILY_APPLICATION_ID or YAPILY_APPLICATION_SECRET is missing in Render."
    );
  }

  const encoded = Buffer.from(`${appId}:${appSecret}`).toString("base64");

  return {
    Authorization: `Basic ${encoded}`,
    Accept: "application/json",
    "Content-Type": "application/json"
  };
}

async function readJsonResponse(response) {
  const raw = await response.text();

  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(
      `Yapily returned non-JSON (HTTP ${response.status}): ${raw.slice(0, 200)}`
    );
  }
}

// Homepage
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// Health check
app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

// Load institutions
app.get("/api/institutions", async (req, res) => {
  try {
    const response = await fetch(`${YAPILY_BASE_URL}/institutions`, {
      method: "GET",
      headers: getAuthHeaders()
    });

    const data = await readJsonResponse(response);

    if (!response.ok) {
      console.error("Institutions request failed:", data);

      return res.status(response.status).json({
        error: data.message || data.error || "Could not load institutions."
      });
    }

    return res.json(data);
  } catch (error) {
    console.error("Institutions error:", error.message);

    return res.status(502).json({
      error: error.message
    });
  }
});

// Create a read-only AIS authorisation request
app.post("/api/connect", async (req, res) => {
  try {
    const applicationUserId = process.env.YAPILY_APPLICATION_USER_ID;
    const callback = process.env.YAPILY_CALLBACK_URL;
    const institutionId = req.body?.institutionId;

    if (!applicationUserId || !callback) {
      return res.status(500).json({
        error:
          "Set YAPILY_APPLICATION_USER_ID and YAPILY_CALLBACK_URL in Render."
      });
    }

    if (institutionId !== "modelo-sandbox") {
      return res.status(400).json({
        error: "Unsupported institution."
      });
    }

    const response = await fetch(
      `${YAPILY_BASE_URL}/account-auth-requests`,
      {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({
          applicationUserId,
          institutionId,
          callback,
          accountRequest: {}
        })
      }
    );

    const data = await readJsonResponse(response);

    if (!response.ok) {
      console.error("Consent request failed:", data);

      return res.status(response.status).json({
        error: data.message || data.error || "Could not create consent request.",
        details: data
      });
    }

    const result = data.data || data;
    const authorisationUrl =
      result.authorisationUrl || result.authorisation_url;

    if (!authorisationUrl) {
      return res.status(502).json({
        error: "Yapily did not return an authorisation URL.",
        details: data
      });
    }

    return res.json({
      authorisationUrl,
      id: result.id
    });
  } catch (error) {
    console.error("Connect error:", error.message);

    return res.status(502).json({
      error: error.message
    });
  }
});

// Yapily redirects the browser here after bank authorization.
// The callback URL in Render and Yapily Console must match this route.
app.get("/callback", (req, res) => {
  const consentToken =
    req.query.consent ||
    req.query.consentToken ||
    req.query["consent-token"];

  if (req.query.error) {
    return res.status(400).send(`
      <h1>Bank authorization was not completed</h1>
      <p>${String(req.query.error)}</p>
      <p><a href="/">Return to the app</a></p>
    `);
  }

  if (!consentToken || typeof consentToken !== "string") {
    return res.status(400).send(`
      <h1>Consent token not received</h1>
      <p>Yapily returned to the callback, but no consent token was found.</p>
      <p>Check the callback URL and the query parameters returned by Yapily.</p>
      <p><a href="/">Return to the app</a></p>
    `);
  }

  const flowId = randomUUID();

  sessions.set(flowId, {
    consentToken,
    authorizedAt: new Date().toISOString()
  });

  return res.redirect(`/?flowId=${encodeURIComponent(flowId)}`);
});

// Retrieve account information using the consent token
app.get("/api/session/:flowId", async (req, res) => {
  try {
    const session = sessions.get(req.params.flowId);

    if (!session) {
      return res.status(404).json({
        error:
          "Session not found. The service may have restarted, or the flow ID is invalid. Please reconnect."
      });
    }

    const headers = getAuthHeaders();
    headers.consent = session.consentToken;

    const response = await fetch(`${YAPILY_BASE_URL}/accounts`, {
      method: "GET",
      headers
    });

    const data = await readJsonResponse(response);

    if (!response.ok) {
      console.error("Accounts request failed:", data);

      return res.status(response.status).json({
        error: data.message || data.error || "Could not retrieve accounts.",
        details: data
      });
    }

    return res.json({
      consent: {
        status: "AUTHORIZED",
        authorizedAt: session.authorizedAt,
        expiresAt: null,
        reconfirmBy: null
      },
      accounts: data.data || []
    });
  } catch (error) {
    console.error("Session error:", error.message);

    return res.status(502).json({
      error: error.message
    });
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`DABI Lab 3 server running on port ${PORT}`);
});
