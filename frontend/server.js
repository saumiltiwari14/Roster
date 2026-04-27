const path = require("path");
const express = require("express");

const app = express();
app.set("trust proxy", 1);

const publicDir = path.join(__dirname, "..", "public");

app.use(express.static(publicDir));

app.get("/", (_req, res) => {
  res.sendFile(path.join(publicDir, "index.html"));
});

module.exports = app;
