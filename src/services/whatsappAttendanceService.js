const User = require('../repositories/users');
const Attendance = require('../repositories/attendance');
const { AppSetting } = require('../repositories/appSetting');
const { markAttendance } = require('./attendanceService');
const { getPendingOrdersForUser, buildTaskSummaryMessage, rolloverPendingOrders } = require('./orderTaskService');

const SETTING_KEY = 'whatsapp_attendance_config';

const DEFAULT_CONFIG = {
  enabled: true,
  markUnknownNumbers: false,
  unknownNumberReply: 'Your number is not registered. Contact admin.',
  duplicateReply: 'Attendance for this action is already marked today.',
  invalidTransitionReply: 'This command is not allowed right now.',
  commands: [
    {
      key: 'start',
      label: 'Day Start',
      aliases: ['start', 'hi'],
      attendanceType: 'In',
      nextAllowed: ['Lunch Out', 'Out'],
      successMessage: 'Attendance marked. Start time {{time}}.',
      duplicateMessage: 'Attendance start already marked today.',
      invalidMessage: 'Day start is already marked.',
      enabled: true,
    },
    {
      key: 'lunch',
      label: 'Lunch Break',
      aliases: ['lunch', 'break'],
      attendanceType: 'Lunch Out',
      nextAllowed: ['Lunch In'],
      successMessage: 'Lunch break marked at {{time}}.',
      duplicateMessage: 'Lunch break already marked.',
      invalidMessage: 'Lunch break can only be marked after start.',
      enabled: true,
    },
    {
      key: 'restart',
      label: 'Restart After Lunch',
      aliases: ['restart', 'back', 'resume'],
      attendanceType: 'Lunch In',
      nextAllowed: ['Out'],
      successMessage: 'Back from lunch marked at {{time}}.',
      duplicateMessage: 'Back from lunch already marked.',
      invalidMessage: 'Restart can only be used after lunch break.',
      enabled: true,
    },
    {
      key: 'end',
      label: 'Day End',
      aliases: ['end', 'done', 'close'],
      attendanceType: 'Out',
      nextAllowed: [],
      successMessage: 'Day end marked at {{time}}.',
      duplicateMessage: 'Day end already marked.',
      invalidMessage: 'Day end can only be marked after start.',
      enabled: true,
    },
  ],
};

function normalizeAliases(list = []) {
  return [...new Set(list.map((value) => String(value || '').trim().toLowerCase()).filter(Boolean))];
}

async function getAttendanceConfig() {
  let value = await AppSetting.getSetting(SETTING_KEY, null);
  if (!value) {
    await AppSetting.upsertSetting({
      key: SETTING_KEY,
      value: DEFAULT_CONFIG,
      description: 'WhatsApp attendance command configuration',
    });
    value = DEFAULT_CONFIG;
  }

  return {
    ...DEFAULT_CONFIG,
    ...value,
    commands: Array.isArray(value?.commands) && value.commands.length > 0
      ? value.commands.map((command) => ({
          ...command,
          aliases: normalizeAliases(command.aliases),
        }))
      : DEFAULT_CONFIG.commands,
  };
}

async function saveAttendanceConfig(payload) {
  const sanitized = {
    enabled: payload?.enabled !== false,
    markUnknownNumbers: Boolean(payload?.markUnknownNumbers),
    unknownNumberReply: String(payload?.unknownNumberReply || DEFAULT_CONFIG.unknownNumberReply),
    duplicateReply: String(payload?.duplicateReply || DEFAULT_CONFIG.duplicateReply),
    invalidTransitionReply: String(payload?.invalidTransitionReply || DEFAULT_CONFIG.invalidTransitionReply),
    commands: Array.isArray(payload?.commands)
      ? payload.commands.map((command, index) => ({
          key: String(command?.key || `command_${index + 1}`).trim().toLowerCase(),
          label: String(command?.label || command?.key || `Command ${index + 1}`).trim(),
          aliases: normalizeAliases(command?.aliases),
          attendanceType: String(command?.attendanceType || '').trim(),
          nextAllowed: Array.isArray(command?.nextAllowed)
            ? command.nextAllowed.map((value) => String(value || '').trim()).filter(Boolean)
            : [],
          successMessage: String(command?.successMessage || ''),
          duplicateMessage: String(command?.duplicateMessage || ''),
          invalidMessage: String(command?.invalidMessage || ''),
          enabled: command?.enabled !== false,
        })).filter((command) => command.attendanceType && command.aliases.length > 0)
      : DEFAULT_CONFIG.commands,
  };

  await AppSetting.upsertSetting({
    key: SETTING_KEY,
    value: sanitized,
    description: 'WhatsApp attendance command configuration',
  });

  return sanitized;
}

function normalizePhoneForLookup(phone) {
  return String(phone || '').replace(/\D/g, '');
}

async function findEmployeeByWhatsAppNumber(rawPhone) {
  const normalizedPhone = normalizePhoneForLookup(rawPhone);
  if (!normalizedPhone) return null;
  const last10 = normalizedPhone.slice(-10);

  return User.findOne({
    $or: [
      { phone: normalizedPhone },
      { phone: `+${normalizedPhone}` },
      { phone: last10 },
      { Mobile_number: last10 },
      {
        $expr: {
          $eq: [{ $toString: '$Mobile_number' }, last10],
        },
      },
    ],
  }).lean();
}

function getIstDate(date = new Date()) {
  return new Date(date.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
}

function formatMessage(template, values) {
  let text = String(template || '');
  Object.entries(values || {}).forEach(([key, value]) => {
    text = text.replaceAll(`{{${key}}}`, String(value ?? ''));
  });
  return text;
}

async function processWhatsAppAttendanceCommand({ payload, sendText }) {
  const config = await getAttendanceConfig();
  if (!config.enabled) return { handled: false };

  const incomingText = String(payload?.message || payload?.text || '').trim().toLowerCase();
  if (!incomingText) return { handled: false };

  const command = (config.commands || []).find((entry) => entry.enabled && entry.aliases.includes(incomingText));
  if (!command) return { handled: false };

  const employee = await findEmployeeByWhatsAppNumber(payload?.from);
  if (!employee) {
    if (config.markUnknownNumbers && sendText) {
      await sendText({ to: payload.from, body: config.unknownNumberReply });
    }
    return { handled: true, success: false, reason: 'unknown_number' };
  }

  const eventTime = getIstDate(new Date());
  const attendanceDate = new Date(eventTime.toISOString().split('T')[0]);
  let attendance = await Attendance.findOne({ Employee_uuid: employee.User_uuid, Date: attendanceDate });
  const currentType = attendance?.User?.length ? attendance.User[attendance.User.length - 1]?.Type : null;
  const attendanceType = command.attendanceType;

  const isAllowed = (() => {
    if (!attendance) return attendanceType === 'In';
    if (currentType === attendanceType) return false;
    if (!currentType) return attendanceType === 'In';
    const startAllowed = ['Lunch Out', 'Out'];
    const lunchOutAllowed = ['Lunch In'];
    const lunchInAllowed = ['Out'];
    const map = {
      In: startAllowed,
      'Lunch Out': lunchOutAllowed,
      'Lunch In': lunchInAllowed,
      Out: [],
    };
    return (map[currentType] || []).includes(attendanceType);
  })();

  if (!isAllowed) {
    if (sendText) {
      await sendText({ to: payload.from, body: command.invalidMessage || config.invalidTransitionReply });
    }
    return { handled: true, success: false, reason: 'invalid_transition' };
  }

  if (!attendance) {
    const result = await markAttendance({
      employeeUuid: employee.User_uuid,
      type: attendanceType,
      status: 'Present',
      time: eventTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      source: 'whatsapp',
      createdAt: eventTime,
      addInitialEntry: true,
    });
    attendance = result.attendance;
  } else {
    const duplicate = attendance.User.some((entry) => entry.Type === attendanceType);
    if (duplicate) {
      if (sendText) {
        await sendText({ to: payload.from, body: command.duplicateMessage || config.duplicateReply });
      }
      return { handled: true, success: false, reason: 'duplicate' };
    }

    attendance.User.push({
      Type: attendanceType,
      Time: eventTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      CreatedAt: eventTime,
      SourceCommand: incomingText,
    });
    attendance.Status = attendanceType === 'Out' ? 'Completed' : 'Present';
    attendance.source = 'whatsapp';
    await attendance.save();
  }

  if (sendText) {
    await sendText({
      to: payload.from,
      body: formatMessage(command.successMessage, {
        time: eventTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        name: employee.name || employee.User_name || 'User',
        command: incomingText,
      }),
    });
  }

  if (attendanceType === 'In' && sendText) {
    await rolloverPendingOrders();
    const taskResult = await getPendingOrdersForUser(employee);
    await sendText({
      to: payload.from,
      body: buildTaskSummaryMessage({ employee, orders: taskResult.orders }),
    });
  }

  return { handled: true, success: true, attendanceType, employee };
}

module.exports = {
  getAttendanceConfig,
  saveAttendanceConfig,
  processWhatsAppAttendanceCommand,
};
