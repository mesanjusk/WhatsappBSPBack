// Routers/OrderMigrate.js
const express = require("express");
const mongoose = require("mongoose");
const router = express.Router();

const Orders = require("../repositories/order");

// ---- Any doc with "old format" matches this filter ----
// Old if: any Step missing 'posting' OR Items missing Priority/Remark OR no Items array but legacy fields exist
const OLD_FILTER = {
  $or: [
    { Steps: { $elemMatch: { posting: { $exists: false } } } },
    { Steps: { $elemMatch: { status: { $exists: false } } } },
    { Items: { $elemMatch: { Priority: { $exists: false } } } },
    { Items: { $elemMatch: { Remark: { $exists: false } } } },
    // legacy single-line present but Items not well formed
    { $and: [
        { $or: [ { Items: { $exists: false } }, { Items: { $size: 0 } } ] },
        { $or: [
          { Amount: { $gt: 0 } },
          { Rate: { $gt: 0 } },
          { Quantity: { $gt: 0 } },
        ] }
      ]
    },
  ],
};

function toNum(v, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

// Build normalized Steps array (idempotent)
function normalizeSteps(steps) {
  const arr = Array.isArray(steps) ? steps : [];
  return arr.map((s) => ({
    label: String(s?.label || s?.Task || "Step").trim(),
    checked: Boolean(s?.checked),
    vendorId: s?.vendorCustomerUuid ?? s?.vendorId ?? null,
    vendorName: s?.vendorName ?? null,
    costAmount: toNum(s?.costAmount, 0),
    plannedDate: s?.plannedDate ? new Date(s.plannedDate) : undefined,
    status: s?.status || "pending",
    posting: s?.posting
      ? {
          isPosted: !!s.posting.isPosted,
          txnId: s.posting.txnId ?? null,   // Mixed in model
          postedAt: s.posting.postedAt ? new Date(s.posting.postedAt) : null
        }
      : { isPosted: false, txnId: null, postedAt: null },
    _id: s?._id, // keep existing ids
  }));
}

// Build normalized Items array (idempotent)
// If Items empty but legacy single-line exists, convert to 1 line
function normalizeItems(doc) {
  const items = Array.isArray(doc.Items) ? doc.Items : [];
  let out = items.map((it) => ({
    Item: String(it?.Item || "").trim(),
    Quantity: toNum(it?.Quantity, 0),
    Rate: toNum(it?.Rate, 0),
    Amount: toNum(it?.Amount, 0),
    Priority: it?.Priority || "Normal",
    Remark: it?.Remark || "",
  })).filter((it) => it.Item);

  // If no valid lines, but legacy single-line fields exist, create one line
  const legacyAmt = toNum(doc.Amount, 0);
  const legacyQty = toNum(doc.Quantity, 0);
  const legacyRate = toNum(doc.Rate, 0);

  const hasLegacy = legacyAmt > 0 || legacyQty > 0 || legacyRate > 0 || (doc.Remark || doc.Priority);
  if (out.length === 0 && hasLegacy) {
    out = [{
      Item: "Misc",
      Quantity: legacyQty || 1,
      Rate: legacyRate || (legacyAmt && legacyQty ? legacyAmt / legacyQty : legacyAmt || 0),
      Amount: legacyAmt || (legacyQty * legacyRate),
      Priority: doc.Priority || "Normal",
      Remark: doc.Remark || "",
    }];
  }

  return out;
}

function recalcTotals(items = [], steps = []) {
  const saleSubtotal = items.reduce((s, it) => s + toNum(it.Amount, 0), 0);
  const stepsCostTotal = steps.reduce((s, st) => s + toNum(st.costAmount, 0), 0);
  return { saleSubtotal, stepsCostTotal };
}

// Lightweight reason flags for UI
function reasonsFor(doc) {
  const reasons = [];
  const steps = doc.Steps || [];
  const items = doc.Items || [];

  if (steps.some((s) => s?.posting == null)) reasons.push("steps:missingPosting");
  if (steps.some((s) => s?.status == null)) reasons.push("steps:missingStatus");
  if (items.some((i) => i?.Priority == null)) reasons.push("items:missingPriority");
  if (items.some((i) => i?.Remark == null)) reasons.push("items:missingRemark");

  const noItems = !Array.isArray(items) || items.length === 0;
  const legacyHasValues =
    toNum(doc.Amount, 0) > 0 || toNum(doc.Rate, 0) > 0 || toNum(doc.Quantity, 0) > 0 || !!doc.Remark || !!doc.Priority;
  if (noItems && legacyHasValues) reasons.push("legacySingleLine");

  return reasons.length ? reasons : ["needsMigration"];
}

/* -------------------- GET: preview flat list -------------------- */
router.get("/migrate/flat", async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit || "100", 10), 1000);
    const docs = await Orders.find(OLD_FILTER, {
      Order_Number: 1,
      Customer_uuid: 1,
      Items: 1,
      Steps: 1,
      Amount: 1,
      Rate: 1,
      Quantity: 1,
      Remark: 1,
      Priority: 1,
      createdAt: 1,
      updatedAt: 1,
    })
      .sort({ Order_Number: -1 })
      .limit(limit)
      .lean();

    const rows = docs.map((d) => ({
      _id: d._id,
      Order_Number: d.Order_Number,
      Customer_uuid: d.Customer_uuid,
      itemsCount: Array.isArray(d.Items) ? d.Items.length : 0,
      stepsCount: Array.isArray(d.Steps) ? d.Steps.length : 0,
      reasons: reasonsFor(d),
      createdAt: d.createdAt,
      updatedAt: d.updatedAt,
    }));

    res.json({ success: true, total: rows.length, rows });
  } catch (e) {
    console.error("migrate/flat error", e);
    res.status(500).json({ success: false, message: e.message });
  }
});

/* -------------------- POST: migrate by IDs -------------------- */
router.post("/migrate/ids", async (req, res) => {
  try {
    const { ids = [] } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ success: false, message: "Provide ids: []" });
    }

    const docs = await Orders.find({ _id: { $in: ids.map((id) => new mongoose.Types.ObjectId(id)) } }).lean();
    if (!docs.length) return res.json({ success: true, migrated: 0 });

    const bulk = docs.map((d) => {
      const Steps = normalizeSteps(d.Steps);
      const Items = normalizeItems(d);
      const totals = recalcTotals(Items, Steps);

      // Clear deprecated order-level Priority/Remark (kept in model as select:false)
      const unset = { Priority: "", Remark: "" };

      return {
        updateOne: {
          filter: { _id: d._id },
          update: {
            $set: {
              Steps,
              Items,
              saleSubtotal: totals.saleSubtotal,
              stepsCostTotal: totals.stepsCostTotal,
            },
            $unset: unset,
          },
        },
      };
    });

    if (bulk.length) await Orders.bulkWrite(bulk, { ordered: false });

    res.json({ success: true, migrated: bulk.length });
  } catch (e) {
    console.error("migrate/ids error", e);
    res.status(500).json({ success: false, message: e.message });
  }
});

/* -------------------- POST: migrate ALL matching -------------------- */
router.post("/migrate/all", async (req, res) => {
  try {
    const cursor = Orders.find(OLD_FILTER).cursor();
    let migrated = 0;
    const bulk = [];

    for await (const d of cursor) {
      const Steps = normalizeSteps(d.Steps);
      const Items = normalizeItems(d);
      const totals = recalcTotals(Items, Steps);

      bulk.push({
        updateOne: {
          filter: { _id: d._id },
          update: {
            $set: {
              Steps,
              Items,
              saleSubtotal: totals.saleSubtotal,
              stepsCostTotal: totals.stepsCostTotal,
            },
            $unset: { Priority: "", Remark: "" },
          },
        },
      });

      if (bulk.length >= 500) {
        await Orders.bulkWrite(bulk, { ordered: false });
        migrated += bulk.length;
        bulk.length = 0;
      }
    }

    if (bulk.length) {
      await Orders.bulkWrite(bulk, { ordered: false });
      migrated += bulk.length;
    }

    res.json({ success: true, migrated });
  } catch (e) {
    console.error("migrate/all error", e);
    res.status(500).json({ success: false, message: e.message });
  }
});

module.exports = router;
