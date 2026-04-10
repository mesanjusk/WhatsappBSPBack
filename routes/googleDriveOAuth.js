const express = require("express");
const router = express.Router();
const GoogleDriveToken = require("../repositories/googleDriveToken");
const {
  getGoogleDriveAuthUrl,
  saveGoogleTokensFromCode,
} = require("../services/googleDriveOAuthService");

router.get("/connect", async (req, res) => {
  try {
    const { returnTo } = req.query;
    const url = getGoogleDriveAuthUrl(returnTo || "");
    return res.redirect(url);
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Failed to start Google OAuth",
      error: error.message,
    });
  }
});

router.get("/callback", async (req, res) => {
  try {
    const { code, state, returnTo } = req.query;

    if (!code) {
      return res.status(400).send("Missing authorization code");
    }

    const result = await saveGoogleTokensFromCode(code);

    const redirectUrl =
      returnTo ||
      state ||
      process.env.FRONTEND_URL ||
      "https://dash.sanjusk.in/home";

    return res.send(`
      <html>
        <head>
          <title>Google Drive Connected</title>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
        </head>
        <body style="font-family: Arial, sans-serif; padding: 24px; line-height: 1.5;">
          <h2>Google Drive connected successfully</h2>
          <p><strong>Connected account:</strong> ${result.email || "Unknown"}</p>
          <p>Redirecting back to your app...</p>
          <script>
            setTimeout(function () {
              window.location.href = ${JSON.stringify(redirectUrl)};
            }, 1200);
          </script>
        </body>
      </html>
    `);
  } catch (error) {
    return res.status(500).send(`
      <html>
        <head>
          <title>Google Drive Connection Failed</title>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
        </head>
        <body style="font-family: Arial, sans-serif; padding: 24px; line-height: 1.5;">
          <h2>Google Drive connection failed</h2>
          <p>${error.message}</p>
        </body>
      </html>
    `);
  }
});

router.get("/status", async (_req, res) => {
  try {
    const token = await GoogleDriveToken.findOne({
      provider: "google_drive",
    }).lean();

    return res.json({
      success: true,
      connected: !!token?.refreshToken,
      email: token?.email || null,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Failed to read Google Drive status",
      error: error.message,
    });
  }
});

module.exports = router;