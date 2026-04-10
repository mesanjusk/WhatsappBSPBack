const express = require("express");
const router = express.Router();
const GoogleDriveToken = require("../repositories/googleDriveToken");
const {
  getGoogleDriveAuthUrl,
  saveGoogleTokensFromCode,
} = require("../services/googleDriveOAuthService");

router.get("/connect", async (_req, res) => {
  try {
    const url = getGoogleDriveAuthUrl();
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
    const { code } = req.query;

    if (!code) {
      return res.status(400).send("Missing authorization code");
    }

    const result = await saveGoogleTokensFromCode(code);

    return res.send(`
      <html>
        <body style="font-family: Arial; padding: 24px;">
          <h2>Google Drive connected successfully</h2>
          <p>Connected account: ${result.email || "Unknown"}</p>
          <p>You can now return to your app.</p>
        </body>
      </html>
    `);
  } catch (error) {
    return res.status(500).send(`
      <html>
        <body style="font-family: Arial; padding: 24px;">
          <h2>Google Drive connection failed</h2>
          <p>${error.message}</p>
        </body>
      </html>
    `);
  }
});

router.get("/status", async (_req, res) => {
  try {
    const token = await GoogleDriveToken.findOne({ provider: "google_drive" }).lean();

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