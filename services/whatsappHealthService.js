const axios = require('axios');

const TOKEN_ERROR_CODES = new Set([190, 10, 102, 200, 2500]);

const getGraphVersion = () => process.env.WHATSAPP_API_VERSION || process.env.META_API_VERSION || 'v19.0';

const classifyWhatsAppApiError = (error) => {
  if (!error) {
    return { code: 'NETWORK_ERROR', message: 'Unknown error' };
  }

  if (error.response) {
    const status = Number(error.response.status || 0);
    const apiError = error.response.data?.error || {};
    const apiCode = Number(apiError.code || 0);

    if (status === 401 || status === 403 || TOKEN_ERROR_CODES.has(apiCode)) {
      return { code: 'TOKEN_EXPIRED', message: 'WhatsApp token is invalid or expired' };
    }

    return {
      code: 'NETWORK_ERROR',
      message: 'WhatsApp API request failed',
      status,
    };
  }

  return { code: 'NETWORK_ERROR', message: 'Unable to reach WhatsApp API' };
};

const validateWhatsAppConfig = () => {
  const accessToken = String(process.env.WHATSAPP_ACCESS_TOKEN || '').trim();
  const phoneNumberId = String(process.env.WHATSAPP_PHONE_NUMBER_ID || '').trim();

  if (!accessToken || !phoneNumberId) {
    return {
      ok: false,
      error: {
        code: 'INVALID_CONFIG',
        message: 'Missing WhatsApp access token or phone number id',
      },
    };
  }

  return {
    ok: true,
    accessToken,
    phoneNumberId,
    graphVersion: getGraphVersion(),
  };
};

const checkWhatsAppHealth = async () => {
  const config = validateWhatsAppConfig();
  if (!config.ok) {
    return {
      isConnected: false,
      reason: config.error.code,
    };
  }

  const { accessToken, phoneNumberId, graphVersion } = config;

  try {
    const response = await axios.get(
      `https://graph.facebook.com/${graphVersion}/${phoneNumberId}`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        params: { fields: 'id,display_phone_number,verified_name,quality_rating,status' },
        timeout: 10000,
      }
    );

    if (!response?.data?.id) {
      return { isConnected: false, reason: 'NETWORK_ERROR' };
    }

    return { isConnected: true, reason: null };
  } catch (error) {
    const normalized = classifyWhatsAppApiError(error);
    console.error('[whatsapp] health-check failed:', normalized.code, error?.response?.status || error?.message);
    return {
      isConnected: false,
      reason: normalized.code,
    };
  }
};

module.exports = {
  classifyWhatsAppApiError,
  validateWhatsAppConfig,
  checkWhatsAppHealth,
};
