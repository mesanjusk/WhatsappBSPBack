require("dotenv").config();
const express = require("express");
const cors = require("cors");
const http = require("http");
const connectDB = require("./config/mongo");
const compression = require("compression");
const { errorHandler, notFound } = require("./middleware/errorHandler");
const { requireAuth } = require("./middleware/auth");

// Handle any unhandled promise rejections
process.on("unhandledRejection", (reason) => {
  console.error("Unhandled Rejection:", reason);
});

// Routers
const Users = require("./routes/Users");
const Usergroup = require("./routes/Usergroup");
const Customers = require("./routes/Customer");
const Customergroup = require("./routes/Customergroup");
const Tasks = require("./routes/Task");
const Taskgroup = require("./routes/Taskgroup");
const Items = require("./routes/Items");
const Itemgroup = require("./routes/Itemgroup");
const Priority = require("./routes/Priority");
const Orders = require("./routes/Order");
const Enquiry = require("./routes/Enquiry");
const Payment_mode = require("./routes/Payment_mode");
const Transaction = require("./routes/Transaction");
const Attendance = require("./routes/Attendance");
const Vendors = require("./routes/Vendor");
const Note = require("./routes/Note");
const Usertasks = require("./routes/Usertask");
const OrderMigrate = require("./routes/OrderMigrate");
const paymentFollowupRouter = require("./routes/paymentFollowup");
const Dashboard = require("./routes/Dashboard");
const WhatsAppCloud = require("./routes/WhatsAppCloud");
const Contacts = require("./routes/Contact");
const webhookRouter = require("./routes/webhook");
const googleDriveOAuthRoutes = require("./routes/googleDriveOAuth");
const FlowRouter = require("./routes/Flow");
const UpiPayments = require("./routes/UpiPayments");
const {
  verifyWebhook,
  receiveWebhook,
  getAnalytics,
} = require("./controllers/whatsappController");
const { initSocket } = require("./socket");

const app = express();
const server = http.createServer(app);
initSocket(server);

// ---------- Core middleware ----------
app.use(cors());
app.use(
  express.json({
    limit: "50mb",
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  })
);
app.use(express.urlencoded({ extended: true, limit: "50mb" }));
app.use(compression());

// ---------- Health check ----------
app.get("/", (_req, res) =>
  res.json({ ok: true, service: "MIS Backend" })
);

// ---------- API namespace ----------
app.use("/api/users", Users);
app.use("/api/usergroup", Usergroup);
app.use("/api/customers", Customers);
app.use("/api/customergroup", Customergroup);
app.use("/api/tasks", Tasks);
app.use("/api/taskgroup", Taskgroup);
app.use("/api/items", Items);
app.use("/api/itemgroup", Itemgroup);
app.use("/api/priority", Priority);
app.use("/api/orders", Orders);
app.use("/api/enquiry", Enquiry);
app.use("/api/payment_mode", Payment_mode);
app.use("/api/transaction", Transaction);
app.use("/api/attendance", Attendance);
app.use("/api/vendors", Vendors);
app.use("/api/note", Note);
app.use("/api/usertasks", Usertasks);
app.use("/api/orders-migrate", OrderMigrate);
app.use("/api/paymentfollowup", paymentFollowupRouter);
app.use("/api/dashboard", Dashboard);
app.use("/api/whatsapp", WhatsAppCloud);
app.use("/api/contacts", Contacts);
app.use("/api/upi", UpiPayments);
app.use("/api", FlowRouter);

// ---------- WhatsApp webhook aliases ----------
app.use("/webhook", webhookRouter);

app.get("/analytics", requireAuth, getAnalytics);

// ---------- Legacy paths (optional) ----------
app.use("/user", Users);
app.use("/usergroup", Usergroup);
app.use("/customer", Customers);
app.use("/customergroup", Customergroup);
app.use("/tasks", Tasks);
app.use("/taskgroup", Taskgroup);
app.use("/items", Items);
app.use("/item", Items);
app.use("/itemgroup", Itemgroup);
app.use("/priority", Priority);
app.use("/order", Orders);
app.use("/enquiry", Enquiry);
app.use("/payment_mode", Payment_mode);
app.use("/transaction", Transaction);
app.use("/attendance", Attendance);
app.use("/vendors", Vendors);
app.use("/note", Note);
app.use("/usertasks", Usertasks);
app.use("/usertask", Usertasks);
app.use("/paymentfollowup", paymentFollowupRouter);
app.use("/dashboard", Dashboard);
app.use("/contacts", Contacts);
app.use("/api/google-drive", googleDriveOAuthRoutes);
app.use("/", FlowRouter);

// ---------- Init DB ---------
(async () => {
  await connectDB();
})();

// ---------- Error handling ----------
app.use(notFound);
app.use(errorHandler);

const PORT = Number(process.env.PORT) || 5000;

server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
