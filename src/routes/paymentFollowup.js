// routes/paymentFollowup.js
const express = require("express");
const router = express.Router();
const { v4: uuid } = require("uuid");
const PaymentFollowup = require("../repositories/paymentFollowup");

/* ----------------------- helpers ----------------------- */
const norm = (s) => String(s || "").trim();
const toDate = (v, fallback = new Date()) => (v ? new Date(v) : fallback);

// Add a new payment follow-up
router.post("/add", async (req, res) => {
  try {
    const Customer = norm(req.body.Customer);
    const Amount = Number(req.body.Amount || 0);
    const Title = norm(req.body.Title);
    const Remark = norm(req.body.Remark);
    const Followup_date = toDate(req.body.Followup_date);

    if (!Customer || !Amount || Amount <= 0) {
      return res
        .status(400)
        .json({ success: false, message: "Customer and valid Amount required" });
    }

    // De-duplication rule:
    // Same customer + followup_date (same day) + amount considered duplicate.
    const start = new Date(Followup_date);
    start.setHours(0, 0, 0, 0);
    const end = new Date(Followup_date);
    end.setHours(23, 59, 59, 999);

    const exists = await PaymentFollowup.findOne({
      customer_name: Customer,
      amount: Amount,
      followup_date: { $gte: start, $lte: end },
    }).lean();

    if (exists) {
      // Match your existing front-end pattern
      return res.send("exist");
    }

    const doc = await PaymentFollowup.create({
      followup_uuid: uuid(),
      customer_name: Customer,
      amount: Amount,
      title: Title,
      remark: Remark,
      followup_date: Followup_date,
      status: "pending",
      created_by: norm(req.user?.name || ""), // optional if you attach auth
    });

    if (doc?._id) {
      return res.send("notexist");
    }
    return res.json({ success: true, result: doc });
  } catch (err) {
    console.error("Add payment follow-up error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

// List follow-ups (optional query: status=pending/done, customer=Name)
router.get("/list", async (req, res) => {
  try {
    const status = norm(req.query.status);
    const customer = norm(req.query.customer);

    const q = {};
    if (status) q.status = status;
    if (customer) q.customer_name = customer;

    const result = await PaymentFollowup.find(q)
      .sort({ createdAt: -1 })
      .lean();

    return res.json({ success: true, result });
  } catch (err) {
    console.error("List payment follow-ups error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

// Update status (pending/done)
router.patch("/:id/status", async (req, res) => {
  try {
    const id = req.params.id; // Mongo _id
    const status = norm(req.body.status).toLowerCase();
    if (!["pending", "done"].includes(status)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid status" });
    }

    const updated = await PaymentFollowup.findByIdAndUpdate(
      id,
      { status },
      { new: true }
    ).lean();

    if (!updated) {
      return res
        .status(404)
        .json({ success: false, message: "Follow-up not found" });
    }
    return res.json({ success: true, result: updated });
  } catch (err) {
    console.error("Update payment follow-up status error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

module.exports = router;
