const crypto = require('crypto');
const AppError = require('../utils/AppError');

let axiosClient;
const getAxios = () => {
  if (!axiosClient) {
    try {
      axiosClient = require('axios');
    } catch (error) {
      throw new AppError(`Axios is required for Meta API calls: ${error.message}`, 500);
    }
  }

  return axiosClient;
};

const META_API_VERSION = process.env.META_API_VERSION || 'v18.0';
const GRAPH_BASE = `https://graph.facebook.com/${META_API_VERSION}`;

const parseMetaError = (error) => {
  const metaError = error.response?.data?.error;
  if (!metaError) {
    return new AppError(error.message || 'Meta API request failed', error.response?.status || 500);
  }

  const message = `Meta API Error: ${metaError.message} (type=${metaError.type}, code=${metaError.code})`;
  const appError = new AppError(message, error.response?.status || 502);
  appError.meta = metaError;
  return appError;
};

const buildAuth = (accessToken) => ({
  Authorization: `Bearer ${accessToken}`,
  'Content-Type': 'application/json',
});

const httpGet = async (url, { params = {}, headers = {} } = {}) => {
  try {
    const response = await getAxios().get(url, { params, headers, timeout: 30000 });
    return response.data;
  } catch (error) {
    throw parseMetaError(error);
  }
};

const httpPost = async (url, payload, headers = {}) => {
  try {
    const response = await getAxios().post(url, payload, {
      headers,
      timeout: 30000,
    });
    return response.data;
  } catch (error) {
    throw parseMetaError(error);
  }
};

const exchangeCodeForShortLivedToken = async ({ code, redirectUri }) => {
  const clientId = process.env.META_APP_ID;
  const clientSecret = process.env.META_APP_SECRET;

  if (!clientId || !clientSecret) {
    throw new AppError('META_APP_ID and META_APP_SECRET are required', 500);
  }

  return httpGet(`${GRAPH_BASE}/oauth/access_token`, {
    params: {
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      code,
    },
  });
};

const exchangeForLongLivedToken = async (shortLivedToken) => {
  const clientId = process.env.META_APP_ID;
  const clientSecret = process.env.META_APP_SECRET;

  return httpGet(`${GRAPH_BASE}/oauth/access_token`, {
    params: {
      grant_type: 'fb_exchange_token',
      client_id: clientId,
      client_secret: clientSecret,
      fb_exchange_token: shortLivedToken,
    },
  });
};

const debugToken = async (inputToken) => {
  const appId = process.env.META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;
  if (!appId || !appSecret) {
    throw new AppError('META_APP_ID and META_APP_SECRET are required', 500);
  }

  return httpGet(`${GRAPH_BASE}/debug_token`, {
    params: {
      input_token: inputToken,
      access_token: `${appId}|${appSecret}`,
    },
  });
};

const fetchBusinesses = async (accessToken) =>
  httpGet(`${GRAPH_BASE}/me/businesses`, {
    params: { fields: 'id,name' },
    headers: buildAuth(accessToken),
  });

const fetchWabaForBusiness = async (businessId, accessToken) =>
  httpGet(`${GRAPH_BASE}/${businessId}/owned_whatsapp_business_accounts`, {
    params: {
      fields: 'id,name,phone_numbers{id,display_phone_number,verified_name}',
    },
    headers: buildAuth(accessToken),
  });

const sendMessage = async ({ phoneNumberId, accessToken, payload }) =>
  httpPost(`${GRAPH_BASE}/${phoneNumberId}/messages`, payload, buildAuth(accessToken));

const fetchTemplates = async ({ wabaId, accessToken }) => {
  const data = [];
  let nextUrl = `${GRAPH_BASE}/${wabaId}/message_templates`;
  let params = { fields: 'id,name,status,language,category,components', limit: 200 };

  while (nextUrl) {
    const response = await httpGet(nextUrl, {
      params,
      headers: buildAuth(accessToken),
    });

    data.push(...(response.data || []));
    nextUrl = response.paging?.next || null;
    params = {};
  }

  return { data };
};

const verifyWebhookSignature = (rawBody, signatureHeader) => {
  const appSecret = process.env.META_APP_SECRET;
  if (!appSecret || !signatureHeader || !rawBody) {
    return false;
  }

  const expected = crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex');
  const received = signatureHeader.replace('sha256=', '');

  try {
    return crypto.timingSafeEqual(Buffer.from(received), Buffer.from(expected));
  } catch (_error) {
    return false;
  }
};

module.exports = {
  parseMetaError,
  exchangeCodeForShortLivedToken,
  exchangeForLongLivedToken,
  debugToken,
  fetchBusinesses,
  fetchWabaForBusiness,
  sendMessage,
  fetchTemplates,
  verifyWebhookSignature,
};
