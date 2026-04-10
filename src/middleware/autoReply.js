const AutoReply = require('../repositories/AutoReply');

const DEFAULT_DELAY_MIN_SECONDS = 2;
const DEFAULT_DELAY_MAX_SECONDS = 5;

const normalizeIncomingText = (text) => String(text || '').trim().toLowerCase();

const matchAutoReplyRule = (incomingText, rules = []) => {
  const normalizedText = normalizeIncomingText(incomingText);

  if (!normalizedText || !Array.isArray(rules) || !rules.length) {
    return null;
  }

  for (const rule of rules) {
    if (!rule?.isActive) continue;

    const keyword = normalizeIncomingText(rule.keyword);
    if (!keyword) continue;

    const matchType = String(rule.matchType || 'contains').toLowerCase();

    if (matchType === 'exact' && normalizedText === keyword) {
      return rule;
    }

    if (matchType === 'contains' && normalizedText.includes(keyword)) {
      return rule;
    }

    if (matchType === 'starts_with' && normalizedText.startsWith(keyword)) {
      return rule;
    }
  }

  return null;
};

const resolveAutoReplyRule = async (incomingText) => {
  const rules = await AutoReply.find({ isActive: true }).sort({ createdAt: 1 }).lean();
  return matchAutoReplyRule(incomingText, rules);
};

const resolveReplyDelayMs = (rule) => {
  const configured = Number(rule?.delaySeconds);

  if (Number.isFinite(configured) && configured >= 0) {
    return configured * 1000;
  }

  const randomDelay =
    Math.floor(
      Math.random() * (DEFAULT_DELAY_MAX_SECONDS - DEFAULT_DELAY_MIN_SECONDS + 1)
    ) + DEFAULT_DELAY_MIN_SECONDS;

  return randomDelay * 1000;
};

module.exports = {
  normalizeIncomingText,
  matchAutoReplyRule,
  resolveAutoReplyRule,
  resolveReplyDelayMs,
};