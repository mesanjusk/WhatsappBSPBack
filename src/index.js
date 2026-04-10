require('dotenv').config();
const express = require('express');
const cors = require('cors');
const http = require('http');
const compression = require('compression');
const connectDB = require('./config/mongo');
const { errorHandler, notFound } = require('./middleware/errorHandler');
const { initSocket } = require('./socket');

const usersRouter = require('./routes/Users');
const whatsappRouter = require('./routes/WhatsAppCloud');
const webhookRouter = require('./routes/webhook');

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
});

const app = express();
const server = http.createServer(app);
initSocket(server);

app.use(cors());
app.use(
  express.json({
    limit: '50mb',
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  })
);
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(compression());

app.get('/', (_req, res) => {
  res.status(200).json({ ok: true, service: 'WhatsApp Backend' });
});

app.use('/api/users', usersRouter);
app.use('/api/whatsapp', whatsappRouter);
app.use('/webhook', webhookRouter);
app.use('/api/whatsapp/webhook', webhookRouter);

(async () => {
  await connectDB();
})();

app.use(notFound);
app.use(errorHandler);

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
