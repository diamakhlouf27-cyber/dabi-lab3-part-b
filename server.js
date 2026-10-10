require("dotenv").config();

const express = require("express");
const path = require("path");

const app = express();

app.use(express.json());

// Serve index.html from the repository root
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// Health check
app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`DABI Lab 3 server running on port ${PORT}`);
});
