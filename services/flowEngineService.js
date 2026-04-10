const axios = require('axios');
const Flow = require('../repositories/Flow');
const FlowSession = require('../repositories/FlowSession');

const normalizeText = (value) => String(value || '').trim();
const normalizeKeyword = (value) => normalizeText(value).toLowerCase();

const getNodeById = (flow, nodeId) => {
  if (!flow || !Array.isArray(flow.nodes) || !nodeId) return null;
  return flow.nodes.find((node) => node.id === nodeId) || null;
};

const getFallbackNextNodeId = (flow, node) => {
  if (!flow || !node) return null;
  if (node.nextNodeId) return node.nextNodeId;

  const edge = (flow.edges || []).find((item) => item.source === node.id);
  return edge?.target || null;
};

const evaluateCondition = (condition, variables = {}) => {
  const left = variables?.[condition.variable];
  const right = condition.value;

  switch (condition.operator) {
    case 'exists':
      return typeof left !== 'undefined' && left !== null && String(left).trim() !== '';
    case 'not_equals':
      return String(left || '') !== String(right || '');
    case 'contains':
      return String(left || '').toLowerCase().includes(String(right || '').toLowerCase());
    case 'equals':
    default:
      return String(left || '').toLowerCase() === String(right || '').toLowerCase();
  }
};

const findStartNode = (flow) => {
  if (!flow || !Array.isArray(flow.nodes) || !flow.nodes.length) return null;
  return flow.nodes.find((node) => node.isStart) || flow.nodes[0];
};

const findTriggeredFlow = async (incomingText) => {
  const keyword = normalizeKeyword(incomingText);
  if (!keyword) return null;

  const candidateFlows =
    typeof Flow.findActiveFlows === 'function'
      ? await Flow.findActiveFlows().lean()
      : await Flow.find({ isActive: true }).sort({ createdAt: 1 }).lean();
  return (
    candidateFlows.find((flow) =>
      Array.isArray(flow.triggerKeywords) &&
      flow.triggerKeywords.some((trigger) => {
        const normalizedTrigger = normalizeKeyword(trigger);
        return normalizedTrigger && (keyword === normalizedTrigger || keyword.includes(normalizedTrigger));
      })
    ) || null
  );
};

const renderButtonPrompt = (node) => {
  const prefix = normalizeText(node.message) || 'Please choose an option:';
  const options = Array.isArray(node.options) && node.options.length ? node.options : Array.isArray(node.buttons) ? node.buttons : [];
  if (!options.length) return prefix;

  const lines = options.map((button, index) => `${index + 1}. ${button.label}`);
  return `${prefix}\n${lines.join('\n')}`;
};

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const handleApiCallNode = async (node, session) => {
  const config = node.apiConfig || {};
  if (!config.url) {
    return { nextNodeId: config.onErrorNodeId || node.defaultNextNodeId || getFallbackNextNodeId(null, node) };
  }

  try {
    const response = await axios({
      url: config.url,
      method: String(config.method || 'GET').toUpperCase(),
      headers: config.headers || {},
      data: config.body || {},
      timeout: Number(config.timeoutMs) || 10000,
    });

    if (config.saveResponseAs) {
      session.variables = {
        ...(session.variables || {}),
        [config.saveResponseAs]: response.data,
      };
    }

    return { nextNodeId: config.nextNodeId || node.nextNodeId || null };
  } catch (_error) {
    return { nextNodeId: config.onErrorNodeId || node.defaultNextNodeId || node.nextNodeId || null };
  }
};

const processSession = async ({ flow, session, incomingText, incomingReplyId }) => {
  const outgoingMessages = [];
  let currentNodeId = session.currentNodeId;
  let userInput = normalizeText(incomingText);
  let safetyCounter = 0;

  while (currentNodeId && safetyCounter < 25) {
    safetyCounter += 1;
    const node = getNodeById(flow, currentNodeId);

    if (!node) {
      session.isCompleted = true;
      session.completedAt = new Date();
      break;
    }

    if (node.type === 'message' || node.type === 'text') {
      if (node.message) outgoingMessages.push(node.message);
      session.awaiting = { nodeId: null, inputType: null };
      currentNodeId = getFallbackNextNodeId(flow, node);
      session.currentNodeId = currentNodeId || node.id;
      continue;
    }

    if (node.type === 'delay') {
      const safeDelayMs = Math.max(0, Number(node.delayMs) || 0);
      if (safeDelayMs > 0) {
        await wait(safeDelayMs);
      }
      session.awaiting = { nodeId: null, inputType: null };
      currentNodeId = getFallbackNextNodeId(flow, node);
      session.currentNodeId = currentNodeId || node.id;
      continue;
    }

    if (node.type === 'question') {
      const waitingForThisNode = session.awaiting?.nodeId === node.id && session.awaiting?.inputType === 'question';

      if (!waitingForThisNode) {
        if (node.message) outgoingMessages.push(node.message);
        session.awaiting = { nodeId: node.id, inputType: 'question' };
        session.currentNodeId = node.id;
        break;
      }

      if (!userInput) break;

      const variableKey = node.variableKey || node.id;
      session.variables = {
        ...(session.variables || {}),
        [variableKey]: userInput,
      };

      session.awaiting = { nodeId: null, inputType: null };
      userInput = '';
      currentNodeId = getFallbackNextNodeId(flow, node);
      session.currentNodeId = currentNodeId || node.id;
      continue;
    }

    if (node.type === 'button' || (Array.isArray(node.options) && node.options.length > 0)) {
      const waitingForThisNode = session.awaiting?.nodeId === node.id && session.awaiting?.inputType === 'button';

      if (!waitingForThisNode) {
        outgoingMessages.push(renderButtonPrompt(node));
        session.awaiting = { nodeId: node.id, inputType: 'button' };
        session.currentNodeId = node.id;
        break;
      }

      const options =
        Array.isArray(node.options) && node.options.length > 0
          ? node.options.map((item) => ({ ...item, value: item.label, id: item.label }))
          : Array.isArray(node.buttons)
          ? node.buttons
          : [];
      const selectedOption = options.find((item, index) => {
        const normalizedLabel = normalizeKeyword(item.label);
        const normalizedValue = normalizeKeyword(item.value);
        return (
          normalizeKeyword(userInput) === normalizedLabel ||
          normalizeKeyword(userInput) === normalizedValue ||
          normalizeKeyword(incomingReplyId) === normalizeKeyword(item.id) ||
          String(index + 1) === String(userInput).trim()
        );
      });

      if (!selectedOption) {
        outgoingMessages.push('Invalid option. Please choose one of the listed buttons.');
        outgoingMessages.push(renderButtonPrompt(node));
        break;
      }

      session.variables = {
        ...(session.variables || {}),
        [node.variableKey || `${node.id}_selection`]: selectedOption.value || selectedOption.label,
      };
      session.awaiting = { nodeId: null, inputType: null };
      userInput = '';
      currentNodeId = selectedOption.nextNodeId || getFallbackNextNodeId(flow, node);
      session.currentNodeId = currentNodeId || node.id;
      continue;
    }

    if (node.type === 'condition') {
      const conditions = Array.isArray(node.conditions) ? node.conditions : [];
      const matched = conditions.find((condition) => evaluateCondition(condition, session.variables || {}));

      currentNodeId = matched?.nextNodeId || node.defaultNextNodeId || getFallbackNextNodeId(flow, node);
      session.currentNodeId = currentNodeId || node.id;
      continue;
    }

    if (node.type === 'api_call') {
      const result = await handleApiCallNode(node, session);
      currentNodeId = result.nextNodeId || getFallbackNextNodeId(flow, node);
      session.currentNodeId = currentNodeId || node.id;
      continue;
    }

    if (node.type === 'end') {
      if (node.message) outgoingMessages.push(node.message);
      session.isCompleted = true;
      session.completedAt = new Date();
      session.awaiting = { nodeId: null, inputType: null };
      break;
    }

    currentNodeId = getFallbackNextNodeId(flow, node);
    session.currentNodeId = currentNodeId || node.id;
  }

  if (safetyCounter >= 25) {
    session.isCompleted = true;
    session.completedAt = new Date();
  }

  await session.save();

  return {
    handled: outgoingMessages.length > 0 || !session.isCompleted,
    outgoingMessages,
    session,
  };
};

const processIncomingMessageFlow = async ({ payload, sendText }) => {
  const user = normalizeText(payload?.from);
  if (!user) return { handled: false, reason: 'missing_user' };

  const incomingText = normalizeText(payload?.message);
  let session = await FlowSession.findOne({
    isCompleted: false,
    $or: [{ user }, { phone: user }],
  }).sort({ updatedAt: -1 });
  let flow = null;

  if (session) {
    flow = await Flow.findById(session.flowId).lean();

    if (!flow || !flow.isActive) {
      session.isCompleted = true;
      session.completedAt = new Date();
      await session.save();
      return { handled: false, reason: 'inactive_flow_session' };
    }
  } else {
    flow = typeof Flow.findMatchingFlow === 'function' ? await Flow.findMatchingFlow(incomingText) : await findTriggeredFlow(incomingText);
    if (!flow) return { handled: false, reason: 'no_trigger' };

    const startNode = findStartNode(flow);
    if (!startNode) return { handled: false, reason: 'flow_missing_start_node' };

    session = await FlowSession.create({
      user,
      phone: user,
      flowId: flow._id,
      currentNodeId: startNode.id,
      variables: {},
      awaiting: { nodeId: null, inputType: null },
      isCompleted: false,
    });
  }

  const result = await processSession({
    flow,
    session,
    incomingReplyId: normalizeText(payload?.replyId),
    incomingText: session.createdAt && session.createdAt.getTime() === session.updatedAt.getTime() ? '' : incomingText,
  });

  for (const message of result.outgoingMessages) {
    try {
      await sendText({ to: user, body: message });
    } catch (error) {
      console.error('[flow-engine] Failed to send flow message:', error?.response?.data || error?.message || error);
    }
  }

 return {
  handled: result.outgoingMessages.length > 0,
  flowId: flow._id,
  sessionId: result.session._id,
  completed: Boolean(result.session.isCompleted),
  sentMessages: result.outgoingMessages.length,
};
};

module.exports = {
  processIncomingMessageFlow,
};
