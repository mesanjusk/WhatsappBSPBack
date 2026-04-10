const formatIST = (date) => {
  const d = new Date(date);

  if (Number.isNaN(d.getTime())) {
    return {
      date: '',
      time: '',
    };
  }

  return {
    date: d.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' }),
    time: d.toLocaleTimeString('en-IN', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
      timeZone: 'Asia/Kolkata',
    }),
  };
};

module.exports = {
  formatIST,
};
