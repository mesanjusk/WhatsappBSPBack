const axios = require('axios');
const AppError = require('../utils/AppError');

const GRAPH_VERSION = process.env.WHATSAPP_API_VERSION || process.env.META_API_VERSION || 'v19.0';

const authHeader = (accessToken) => ({ Authorization: `Bearer ${accessToken}` });

const validateManualWhatsAppCredentials = async ({
  accessToken,
  phoneNumberId,
  businessAccountId,
  wabaId,
}) => {
  const normalizedToken = String(accessToken || '').trim();
  const normalizedPhoneNumberId = String(phoneNumberId || '').trim();
  const normalizedBusinessAccountId = String(businessAccountId || '').trim();
  const normalizedWabaId = String(wabaId || '').trim();

  if (!normalizedToken || !normalizedPhoneNumberId || (!normalizedBusinessAccountId && !normalizedWabaId)) {
    throw new AppError('accessToken, phoneNumberId and businessAccountId or wabaId are required', 400);
  }

  try {
    const [tokenResponse, phoneResponse] = await Promise.all([
      axios.get(`https://graph.facebook.com/${GRAPH_VERSION}/me`, {
        headers: authHeader(normalizedToken),
        params: { fields: 'id,name' },
        timeout: 10000,
      }),
      axios.get(`https://graph.facebook.com/${GRAPH_VERSION}/${normalizedPhoneNumberId}`, {
        headers: authHeader(normalizedToken),
        params: {
          fields: 'id,display_phone_number,verified_name,quality_rating,status',
        },
        timeout: 12000,
      }),
    ]);

    const phoneData = phoneResponse?.data || {};
    const accountData = {
      tokenType: 'Bearer',
      appScopedMetaUserId: String(tokenResponse?.data?.id || ''),
      phoneNumberId: String(phoneData.id || normalizedPhoneNumberId),
      displayPhoneNumber: String(phoneData.display_phone_number || ''),
      verifiedName: String(phoneData.verified_name || ''),
    };

    const ownerBusinessAccountId = '';
    const phoneWabaId = '';
    const effectiveBusinessAccountId = normalizedBusinessAccountId;

    let resolvedWabaId = normalizedWabaId || '';
    let wabaMembershipValidated = false;

    if (effectiveBusinessAccountId) {
      try {
        const wabaResponse = await axios.get(
          `https://graph.facebook.com/${GRAPH_VERSION}/${effectiveBusinessAccountId}/owned_whatsapp_business_accounts`,
          {
            headers: authHeader(normalizedToken),
            params: { fields: 'id,name' },
            timeout: 12000,
          }
        );

        const wabas = Array.isArray(wabaResponse?.data?.data) ? wabaResponse.data.data : [];
        const allWabaIds = new Set(wabas.map((waba) => String(waba.id || '')).filter(Boolean));
        const firstWabaId = String(wabas[0]?.id || '');

        if (normalizedWabaId && allWabaIds.size > 0 && !allWabaIds.has(normalizedWabaId)) {
          throw new AppError('wabaId does not belong to the provided businessAccountId', 400);
        }

        resolvedWabaId = normalizedWabaId || firstWabaId || '';
        wabaMembershipValidated = true;
      } catch (error) {
        if (error instanceof AppError) throw error;
      }
    }

    return {
      ...accountData,
      businessAccountId: effectiveBusinessAccountId,
      wabaId: resolvedWabaId,
      metadata: {
        verifiedAt: new Date().toISOString(),
        validationSource: 'meta_graph',
        phoneWabaId,
        ownerBusinessAccountId,
        wabaMembershipValidated,
      },
    };
  } catch (error) {
    if (error instanceof AppError) throw error;
    const apiMessage = error?.response?.data?.error?.message;
    throw new AppError(apiMessage || 'Manual WhatsApp credentials are invalid', 400);
  }
};

module.exports = {
  validateManualWhatsAppCredentials,
};