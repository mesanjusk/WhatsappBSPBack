const AutoReply = require('../repositories/AutoReply');

const DEFAULT_DELAY_MIN_SECONDS = 2;
const DEFAULT_DELAY_MAX_SECONDS = 5;
const DEFAULT_CATALOG_FIELDS = [
  'Item Name',
  'Paper Type',
  'gsm',
  'size',
  'Print Side',
  'Printing Color',
  'Lamination Side',
  'Lamination Type',
  'Quantity',
];

const normalizeIncomingText = (text) => String(text || '').trim().toLowerCase();
const normalizeFieldValue = (value) => String(value ?? '').trim();

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

    if (matchType === 'exact' && normalizedText === keyword) return rule;
    if (matchType === 'contains' && normalizedText.includes(keyword)) return rule;
    if (matchType === 'starts_with' && normalizedText.startsWith(keyword)) return rule;
  }

  return null;
};

const getCatalogFields = (rule) => {
  const fields = Array.isArray(rule?.catalogConfig?.selectionFields)
    ? rule.catalogConfig.selectionFields.map(normalizeFieldValue).filter(Boolean)
    : [];

  return fields.length ? fields : DEFAULT_CATALOG_FIELDS;
};

const getCatalogRows = (rule) =>
  (Array.isArray(rule?.catalogRows) ? rule.catalogRows : [])
    .map((row) => (row && typeof row === 'object' ? row : null))
    .filter(Boolean);

const filterCatalogRows = (rows, filters = {}) =>
  rows.filter((row) =>
    Object.entries(filters).every(([field, expected]) => normalizeFieldValue(row?.[field]) === normalizeFieldValue(expected))
  );

const getOptionsForField = (rows, field) => {
  const options = [];
  const seen = new Set();
  for (const row of rows) {
    const value = normalizeFieldValue(row?.[field]);
    if (!value || value === '-') continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    options.push(value);
  }
  return options;
};

const buildCatalogMenuText = ({ rule, field, stepIndex, options, prefix = '' }) => {
  const title = normalizeFieldValue(rule?.catalogConfig?.menuTitle) || 'Product Price Finder';
  const intro = normalizeFieldValue(rule?.catalogConfig?.menuIntro);
  const lines = [title];
  if (intro && stepIndex === 0) lines.push(intro);
  if (prefix) lines.push(prefix);
  lines.push(`Step ${stepIndex + 1}: choose ${field}`);
  options.forEach((option, index) => lines.push(`${index + 1}. ${option}`));
  lines.push('Reply with the option number.');
  return lines.filter(Boolean).join('\n');
};

const buildCatalogResultText = (row) => {
  const rate = normalizeFieldValue(row?.rate || row?.Rate || row?.price || row?.Price);
  const dispatchDays = normalizeFieldValue(row?.['Dispatch Days'] || row?.dispatchDays || row?.dispatch_days);
  const summaryFields = DEFAULT_CATALOG_FIELDS.filter((field) => normalizeFieldValue(row?.[field]) && normalizeFieldValue(row?.[field]) !== '-');
  const summary = summaryFields.map((field) => `${field}: ${normalizeFieldValue(row?.[field])}`).join('\n');
  return [
    'Price details',
    summary,
    rate ? `Rate: ₹${rate}` : '',
    dispatchDays ? `Dispatch Days: ${dispatchDays}` : '',
  ]
    .filter(Boolean)
    .join('\n');
};

const finalizeSession = async (contactDoc, nextState = null) => {
  if (!contactDoc) return;
  contactDoc.customFields = {
    ...(contactDoc.customFields || {}),
    productCatalogSession: nextState,
  };
  await contactDoc.save();
};

const progressCatalogSession = async ({ rule, contactDoc, incomingText }) => {
  if (!contactDoc || !rule) return null;

  const session = contactDoc.customFields?.productCatalogSession;
  if (!session || String(session.ruleId) !== String(rule._id)) return null;

  const rows = getCatalogRows(rule);
  const fields = getCatalogFields(rule);
  let filters = { ...(session.filters || {}) };
  let stepIndex = Number(session.stepIndex || 0);
  let candidateRows = filterCatalogRows(rows, filters);

  while (stepIndex < fields.length) {
    const field = fields[stepIndex];
    const options = getOptionsForField(candidateRows, field);

    if (!options.length) {
      await finalizeSession(contactDoc, null);
      return { replyType: 'text', reply: 'No matching products were found. Please send the keyword again to restart.' };
    }

    if (options.length === 1) {
      filters[field] = options[0];
      candidateRows = filterCatalogRows(rows, filters);
      stepIndex += 1;
      continue;
    }

    const selectedIndex = Number.parseInt(String(incomingText || '').trim(), 10);
    if (!Number.isFinite(selectedIndex) || selectedIndex < 1 || selectedIndex > options.length) {
      await finalizeSession(contactDoc, { ruleId: String(rule._id), stepIndex, filters, updatedAt: new Date() });
      return {
        replyType: 'text',
        reply: buildCatalogMenuText({
          rule,
          field,
          stepIndex,
          options,
          prefix: 'Please reply with a valid option number.',
        }),
      };
    }

    filters[field] = options[selectedIndex - 1];
    candidateRows = filterCatalogRows(rows, filters);
    stepIndex += 1;
  }

  const resultRow = candidateRows[0] || filterCatalogRows(rows, filters)[0];
  await finalizeSession(contactDoc, null);
  if (!resultRow) {
    return { replyType: 'text', reply: 'No matching products were found. Please send the keyword again to restart.' };
  }
  return { replyType: 'text', reply: buildCatalogResultText(resultRow) };
};

const startCatalogSession = async ({ rule, contactDoc }) => {
  const rows = getCatalogRows(rule);
  const fields = getCatalogFields(rule);
  let filters = {};
  let stepIndex = 0;
  let candidateRows = rows;

  while (stepIndex < fields.length) {
    const field = fields[stepIndex];
    const options = getOptionsForField(candidateRows, field);
    if (!options.length) {
      return { replyType: 'text', reply: 'Catalog is empty for this rule.' };
    }
    if (options.length === 1) {
      filters[field] = options[0];
      candidateRows = filterCatalogRows(rows, filters);
      stepIndex += 1;
      continue;
    }

    await finalizeSession(contactDoc, {
      ruleId: String(rule._id),
      stepIndex,
      filters,
      updatedAt: new Date(),
    });

    return {
      replyType: 'text',
      reply: buildCatalogMenuText({ rule, field, stepIndex, options }),
    };
  }

  const resultRow = candidateRows[0];
  await finalizeSession(contactDoc, null);
  return { replyType: 'text', reply: resultRow ? buildCatalogResultText(resultRow) : 'Catalog is empty for this rule.' };
};

const resolveAutoReplyRule = async (incomingText, filters = {}) => {
  let rules = await AutoReply.find({ isActive: true, ...filters }).sort({ createdAt: 1 }).lean();

  if (!rules.length) {
    rules = await AutoReply.find({
      isActive: true,
      $or: [{ userId: { $exists: false } }, { userId: null }, { userId: '' }],
    })
      .sort({ createdAt: 1 })
      .lean();
  }

  return matchAutoReplyRule(incomingText, rules);
};

const resolveAutoReplyAction = async ({ incomingText, filters = {}, contactDoc = null }) => {
  let rules = await AutoReply.find({ isActive: true, ...filters }).sort({ createdAt: 1 });

  if (!rules.length) {
    rules = await AutoReply.find({
      isActive: true,
      $or: [{ userId: { $exists: false } }, { userId: null }, { userId: '' }],
    }).sort({ createdAt: 1 });
  }

  const sessionRuleId = String(contactDoc?.customFields?.productCatalogSession?.ruleId || '');
  if (sessionRuleId) {
    const sessionRule = rules.find((rule) => String(rule?._id || '') === sessionRuleId && String(rule?.ruleType || 'keyword') === 'product_catalog');
    if (sessionRule) {
      return progressCatalogSession({ rule: sessionRule, contactDoc, incomingText });
    }
  }

  const matchedRule = matchAutoReplyRule(incomingText, rules);
  if (!matchedRule) return null;

  if (String(matchedRule.ruleType || 'keyword') === 'product_catalog') {
    return startCatalogSession({ rule: matchedRule, contactDoc });
  }

  return matchedRule;
};

const resolveReplyDelayMs = (rule) => {
  const configured = Number(rule?.delaySeconds);

  if (Number.isFinite(configured) && configured >= 0) return configured * 1000;

  const randomDelay = Math.floor(Math.random() * (DEFAULT_DELAY_MAX_SECONDS - DEFAULT_DELAY_MIN_SECONDS + 1)) + DEFAULT_DELAY_MIN_SECONDS;
  return randomDelay * 1000;
};

module.exports = {
  normalizeIncomingText,
  matchAutoReplyRule,
  resolveAutoReplyRule,
  resolveAutoReplyAction,
  resolveReplyDelayMs,
  getCatalogFields,
};
