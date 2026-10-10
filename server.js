
import express from "express";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

const app = express();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(express.json());

// Homepage
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// Health check
app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

// Load institutions from Yapily
app.get("/api/institutions", async (req, res) => {
  try {
    const appId = process.env.YAPILY_APPLICATION_ID;
    const appSecret = process.env.YAPILY_APPLICATION_SECRET;

    if (!appId || !appSecret) {
      return res.status(500).json({
        error: "Yapily credentials are missing in Render."
      });
    }

    const auth = Buffer.from(`${appId}:${appSecret}`).toString("base64");

    const response = await fetch(
      "https://api.yapily.com/institutions",
      {
        method: "GET",
        headers: {
          Authorization: `Basic ${auth}`,
          Accept: "application/json"
        }
      }
    );

    const body = await response.text();

    let data;
    try {
      data = JSON.parse(body);
    } catch {
      console.error("Yapily returned a non-JSON response.");
      return res.status(502).json({
        error: "Yapily returned an unexpected response."
      });
    }

    if (!response.ok) {
      console.error(
        "Yapily institutions request failed:",
        response.status
      );

      return res.status(response.status).json({
        error:
          data.message ||
          data.error ||
          "Yapily institutions request failed."
      });
    }

    return res.json(data);
  } catch (error) {
    console.error("Institutions request failed:", error.message);

    return res.status(502).json({
      error: "Could not connect to Yapily."
    });
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`DABI Lab 3 server running on port ${PORT}`);
});
