// utils/normalizeNumber.js
function normalizeWhatsAppNumber(number) {
  // Ensure number is a string and strip non-digits
  number = String(number).trim().replace(/\D/g, '');

  // If already starts with '91', return as is
  if (number.startsWith('91')) return number;

  // Otherwise, add '91' country code
  return '91' + number;
}

module.exports = normalizeWhatsAppNumber;
