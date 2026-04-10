// Routers/Order.js
const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const Orders = require("../repositories/order");
const Counter = require("../repositories/counter");
const Transaction = require("../repositories/transaction");
const { v4: uuid } = require("uuid");
// keep this import if you still use it elsewhere
const { updateOrderStatus } = require("../controllers/orderController");
const { patchOrderStage, listOrderTasks } = require("../controllers/orderLifecycleController");
const Customers = require("../repositories/customer");
const ItemsRepo = require("../repositories/items");
const Users = require("../repositories/users");
const {
  buildDefaultDueDate,
  getPendingOrdersForUser,
  getUnassignedOrders,
  assignOrderToUser,
  buildTaskSummaryMessage,
} = require("../services/orderTaskService");
const {
  copyOrderTemplateFileOAuth,
  isDriveAutomationEnabled,
} = require("../services/googleDriveOAuthService");

/* ----------------------- helpers ----------------------- */
const isProd = process.env.NODE_ENV === "production";

const norm = (s) => String(s || "").trim();
const normLower = (s) => String(s || "").trim().toLowerCase();
const toDate = (v, fallback = new Date()) => (v ? new Date(v) : fallback);
const escapeRegex = (str) => String(str).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Resolve a Mongo filter from any incoming id type */
function idToFilter(anyId) {
  const id = String(anyId || "").trim();
  if (!id) return null;
  if (mongoose.isValidObjectId(id)) return { _id: id };
  if (/^\d+$/.test(id)) return { Order_Number: Number(id) };
  return { Order_uuid: id };
}

/** Normalizes both old and new payload shapes for status change */
function parseStatusPayload(req) {
  // Legacy: { orderId, newStatus }  (newStatus = string | { Task })
  const oldOrderId = req.body?.orderId;
  const oldNewStatus = req.body?.newStatus;

  // DnD: { Order_id, Task }
  const dndId = req.body?.Order_id;
  const dndTask = req.body?.Task;

  // Fallback to URL param (PUT /updateStatus/:id)
  let id = dndId || oldOrderId || req.params?.id;
  let task = dndTask;

  if (!task && typeof oldNewStatus === "string") task = oldNewStatus;
  if (!task && oldNewStatus && typeof oldNewStatus === "object") task = oldNewStatus.Task;

  return { id: id ? String(id).trim() : "", task: task ? String(task).trim() : "" };
}

/**
 * Append a new status entry using a single $push and immediately respond.
 * We DO NOT fetch the whole doc afterwards (avoids serialization/transform issues).
 * Returns { ok, code?, msg? }.
 */
async function pushStatusOnly(filter, task, assignedHint = "DragDrop") {
  try {
    // Read just the last Status_number & Assigned (light, fast)
    const doc = await Orders.findOne(filter, { Status: { $slice: -1 }, _id: 1 }).lean();
    if (!doc) return { ok: false, code: 404, msg: "Order not found" };

    const last = Array.isArray(doc.Status) && doc.Status.length ? doc.Status[0] : null;
    const nextNo = Number(last?.Status_number || 0) + 1;

    const now = new Date();
    const entry = {
      Task: String(task || "").trim() || "Other",
      Assigned: String(last?.Assigned || assignedHint || "System"),
      Status_number: Number.isFinite(nextNo) ? nextNo : 1,
      Delivery_Date: now,
      CreatedAt: now,
    };
    if (!entry.Task) return { ok: false, code: 400, msg: "Task is empty after normalization" };

    const upd = await Orders.updateOne(filter, { $push: { Status: entry } });
    if (upd.matchedCount === 0) return { ok: false, code: 404, msg: "Order not found" };
    if (upd.modifiedCount === 0) return { ok: false, code: 500, msg: "Failed to push status" };

    return { ok: true };
  } catch (e) {
    console.error("[order.updateStatus] pushStatusOnly error:", e);
    return {
      ok: false,
      code: 500,
      msg: isProd ? "Internal error while updating status" : `Internal error: ${e.message}`,
    };
  }
}

/* ----------------------- normalizers ----------------------- */
function normalizeItems(items) {
  if (!Array.isArray(items)) return [];
  return items
    .filter(Boolean)
    .map((it) => {
      const name = String(it.Item ?? it.item ?? "").trim();
      const qty = Number(it.Quantity ?? it.quantity ?? 0);
      const rate = Number(it.Rate ?? it.rate ?? 0);
      const amt = Number(it.Amount ?? it.amount ?? (qty * rate) ?? 0);

      const priorityRaw = it.Priority ?? it.priority ?? "Normal";
      const remarkRaw =
        it.Remark ??
        it.remark ??
        it.remarks ??
        it.comment ??
        it.note ??
        "";

      return {
        Item: name,
        Quantity: qty,
        Rate: rate,
        Amount: amt,
        Priority: String(priorityRaw || "Normal"),
        Remark: String(remarkRaw || ""),
      };
    })
    .filter((it) => it.Item);
}

function normalizeSteps(steps) {
  if (!Array.isArray(steps)) return [];
  return steps.reduce((acc, step) => {
    const label = typeof step?.label === "string" ? step.label.trim() : "";
    if (!label) return acc;

    const amount = Number(step.costAmount ?? 0);
    acc.push({
      uuid: typeof step?.uuid === "string" ? step.uuid.trim() : undefined,
      label,
      normLabel: normLower(label),
      checked: !!step.checked,
      vendorId: step.vendorCustomerUuid ?? step.vendorId ?? null,
      vendorName: step.vendorName ?? null,
      costAmount: Number.isFinite(amount) && amount >= 0 ? amount : 0,
      plannedDate: step.plannedDate ? new Date(step.plannedDate) : undefined,
      status: step.status || "pending",
      posting:
        step.posting && typeof step.posting === "object"
          ? step.posting
          : { isPosted: false, txnId: null, postedAt: null },
    });
    return acc;
  }, []);
}

function normalizeVendorAssignments(assignments) {
  if (!Array.isArray(assignments)) return [];
  return assignments.reduce((acc, row) => {
    const vendorCustomerUuid = norm(row?.vendorCustomerUuid || row?.vendorId || row?.Customer_uuid);
    const vendorName = norm(row?.vendorName || row?.Customer_name || row?.name);
    if (!vendorCustomerUuid || !vendorName) return acc;

    const amount = Number(row?.amount ?? 0);
    const qty = Number(row?.qty ?? 0);

    acc.push({
      assignmentId: norm(row?.assignmentId) || undefined,
      vendorCustomerUuid,
      vendorName,
      workType: norm(row?.workType || row?.work || row?.label) || "General",
      note: norm(row?.note || row?.remark || row?.description),
      qty: Number.isFinite(qty) && qty >= 0 ? qty : 0,
      amount: Number.isFinite(amount) && amount >= 0 ? amount : 0,
      dueDate: row?.dueDate ? new Date(row.dueDate) : null,
      paymentStatus: ["pending", "partial", "paid"].includes(String(row?.paymentStatus || "").toLowerCase())
        ? String(row.paymentStatus).toLowerCase()
        : "pending",
      status: ["pending", "in_progress", "completed"].includes(String(row?.status || "").toLowerCase())
        ? String(row.status).toLowerCase()
        : "pending",
    });

    return acc;
  }, []);
}



async function enrichOrderItemsAndBuildWorkRows(lineItems = [], inheritedDueDate = null) {
  const itemNames = [...new Set(lineItems.map((row) => norm(row.Item)).filter(Boolean))];
  const catalog = await ItemsRepo.find({ Item_name: { $in: itemNames } }).lean();
  const byName = new Map(catalog.map((item) => [norm(item.Item_name), item]));
  const workRows = [];

  const enrichedItems = lineItems.map((row) => {
    const itemDoc = byName.get(norm(row.Item));
    const qty = Number(row.Quantity || 0);
    const enriched = {
      ...row,
      Item_uuid: itemDoc?.Item_uuid || row.Item_uuid || "",
      Item_group: row.Item_group || itemDoc?.Item_group || "",
      itemType: row.itemType || itemDoc?.itemType || "finished_item",
      Rate: Number(row.Rate || itemDoc?.defaultSaleRate || 0),
    };
    enriched.Amount = Number(row.Amount || qty * Number(enriched.Rate || 0));

    if (itemDoc?.itemType === 'finished_item' && Array.isArray(itemDoc?.bom) && itemDoc.bom.length) {
      itemDoc.bom.forEach((component) => {
        const compQtyBase = Number(component?.qty || 0);
        const wasteFactor = 1 + Number(component?.wastePercent || 0) / 100;
        const requiredQty = Number((qty * compQtyBase * wasteFactor).toFixed(4));
        workRows.push({
          sourceLineId: enriched.lineId,
          sourceItemUuid: enriched.Item_uuid || '',
          sourceItemName: enriched.Item,
          sourceBomComponentId: String(component?._id || ''),
          type: component?.componentType === 'service' ? 'service' : component?.componentType === 'consumable' ? 'consumable' : 'raw_material',
          itemUuid: component?.componentItemUuid || '',
          itemName: component?.componentItemName,
          itemGroup: component?.itemGroup || '',
          unit: component?.unit || 'Nos',
          requiredQty,
          reservedQty: 0,
          consumedQty: 0,
          executionMode: component?.executionMode || 'stock',
          assignedVendorCustomerUuid: null,
          assignedVendorName: null,
          assignedUserUuid: null,
          assignedUserName: null,
          assignLater: true,
          status: 'pending',
          estimatedCost: Number(component?.defaultCost || 0),
          actualCost: 0,
          note: component?.note || '',
          dueDate: inheritedDueDate || null,
        });
      });
    } else if (itemDoc?.itemType === 'raw_material' || itemDoc?.itemType === 'service' || itemDoc?.itemType === 'consumable') {
      workRows.push({
        sourceLineId: enriched.lineId,
        sourceItemUuid: enriched.Item_uuid || '',
        sourceItemName: enriched.Item,
        sourceBomComponentId: '',
        type: itemDoc.itemType === 'service' ? 'service' : itemDoc.itemType === 'consumable' ? 'consumable' : 'raw_material',
        itemUuid: enriched.Item_uuid || '',
        itemName: enriched.Item,
        itemGroup: enriched.Item_group || '',
        unit: itemDoc?.unit || 'Nos',
        requiredQty: qty,
        reservedQty: 0,
        consumedQty: 0,
        executionMode: itemDoc?.executionMode || 'stock',
        assignedVendorCustomerUuid: null,
        assignedVendorName: null,
        assignedUserUuid: null,
        assignedUserName: null,
        assignLater: true,
        status: 'pending',
        estimatedCost: Number(itemDoc?.defaultPurchaseRate || 0),
        actualCost: 0,
        note: row.Remark || '',
        dueDate: inheritedDueDate || null,
      });
    }

    return enriched;
  });

  return { enrichedItems, workRows };
}
/* ----------------------- CREATE NEW ORDER ----------------------- */

router.post("/addOrder", async (req, res) => {
  try {
    const {
      Customer_uuid,
      Status = [{}],
      Steps = [],
      Items = [],
      orderMode,
      orderNote,
      vendorAssignments = [],
      Type,
      isEnquiry,
      stage = "enquiry",
      priority = "medium",
      dueDate = null,
      assignedTo = null,
    } = req.body;

    const rawType = typeof Type === "string" ? Type.trim().toLowerCase() : "";

    const isEnquiryOnly =
      (typeof isEnquiry === "boolean" && isEnquiry) ||
      rawType === "enquiry" ||
      rawType === "inquiry" ||
      rawType.includes("enquiry") ||
      rawType.includes("inquiry");

    const now = new Date();

    const endOfToday = new Date();
    endOfToday.setHours(20, 0, 0, 0);

    const effectiveDueDate = dueDate ? new Date(dueDate) : (!isEnquiryOnly ? endOfToday : null);

    const statusDefaults = {
      Task: isEnquiryOnly ? "Enquiry" : "Design",
      Assigned: "None",
      Status_number: 1,
      Delivery_Date: effectiveDueDate || now,
      CreatedAt: now,
    };

    const updatedStatus = (Status || []).map((s) => ({
      ...statusDefaults,
      ...s,
      Delivery_Date: toDate(s?.Delivery_Date, now),
      CreatedAt: toDate(s?.CreatedAt, now),
    }));

    if (
      !updatedStatus[0]?.Task ||
      !updatedStatus[0]?.Assigned ||
      !updatedStatus[0]?.Delivery_Date
    ) {
      return res.status(400).json({
        success: false,
        message: "Task, Assigned, and Delivery_Date are required in Status[0].",
      });
    }

    const flatSteps = normalizeSteps(Steps);
    const normalizedVendorAssignments = normalizeVendorAssignments(vendorAssignments);
    const requestedOrderMode = String(orderMode || "").trim().toLowerCase();
    const finalOrderMode = requestedOrderMode === "items" ? "items" : "note";
    const normalizedOrderNote = norm(
      orderNote || req.body?.Remark || req.body?.remark || req.body?.note || req.body?.comments || req.body?.description
    );
    const lineItems = normalizeItems(Items);
    const { enrichedItems, workRows } = await enrichOrderItemsAndBuildWorkRows(lineItems, effectiveDueDate);

    const topRemark = normalizedOrderNote;

    if (finalOrderMode === "note" && lineItems.length === 0 && String(topRemark).trim()) {
      lineItems.push({
        Item: "Order Note",
        Quantity: 0,
        Rate: 0,
        Amount: 0,
        Priority: "Normal",
        Remark: String(topRemark).trim(),
      });
    }

    const currentCounter = await Counter.findById("order_number").lean();
    if (!currentCounter?.seq) {
      const lastOrder = await Orders.findOne({}, { Order_Number: 1 })
        .sort({ Order_Number: -1 })
        .lean();

      const seedValue = Number(lastOrder?.Order_Number || 0);

      await Counter.updateOne(
        { _id: "order_number" },
        { $max: { seq: seedValue } },
        { upsert: true }
      );
    }

    const counter = await Counter.findByIdAndUpdate(
      "order_number",
      { $inc: { seq: 1 } },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    ).lean();

    const newOrderNumber = Number(counter?.seq || 1);

    const newOrder = new Orders({
      Order_uuid: uuid(),
      Order_Number: newOrderNumber,
      Customer_uuid,
      Status: updatedStatus,
      orderMode: finalOrderMode,
      orderNote: normalizedOrderNote,
      vendorAssignments: normalizedVendorAssignments,
      Steps: flatSteps,
      Items: enrichedItems,
      workRows,
      stage: String(stage || (isEnquiryOnly ? "enquiry" : "design")).toLowerCase(),
      stageHistory: [
        { stage: String(stage || (isEnquiryOnly ? "enquiry" : "design")).toLowerCase(), timestamp: new Date() },
      ],
      priority: ["low", "medium", "high"].includes(String(priority || "").toLowerCase())
        ? String(priority).toLowerCase()
        : "medium",
      dueDate: effectiveDueDate || null,
      assignedTo: assignedTo || null,
      driveFile: {
        status: "pending",
      },
    });

    await newOrder.save();

    let driveFile = {
      status: "skipped",
      templateFileId: process.env.DRIVE_TEMPLATE_FILE_ID || null,
      folderId: process.env.DRIVE_TARGET_FOLDER_ID || null,
      error: null,
    };

    let driveWarning = null;

    try {
      if (isDriveAutomationEnabled() && !isEnquiryOnly) {
        const customer = await Customers.findOne({ Customer_uuid }).lean();

        if (!customer) {
          throw new Error("Customer not found for drive file copy");
        }

        const finalDescription =
  String(topRemark || "").trim() ||
  (lineItems?.[0]?.Remark || "").trim() ||
  "Work";

const shortDescription = finalDescription.slice(0, 40);

  
const copiedFile = await copyOrderTemplateFileOAuth({
  templateFileId: process.env.DRIVE_TEMPLATE_FILE_ID,
  targetFolderId: process.env.DRIVE_TARGET_FOLDER_ID,
  orderNumber: newOrderNumber,
  customerName: customer.Customer_name,
  description: finalDescription,
  mobileNumber: customer.Mobile_number || "",
});


        driveFile = {
          status: "created",
          templateFileId: process.env.DRIVE_TEMPLATE_FILE_ID || null,
          fileId: copiedFile.id || null,
          folderId: process.env.DRIVE_TARGET_FOLDER_ID || null,
          name: copiedFile.name || null,
          description: copiedFile.description || String(topRemark || "").trim(),
          webViewLink: copiedFile.webViewLink || null,
          webContentLink: copiedFile.webContentLink || null,
          error: null,
          createdAt: new Date(),
        };
      }
    } catch (driveErr) {
      console.error("Google Drive copy error:", driveErr);
      driveFile = {
        status: "failed",
        templateFileId: process.env.DRIVE_TEMPLATE_FILE_ID || null,
        folderId: process.env.DRIVE_TARGET_FOLDER_ID || null,
        error: driveErr.message || "Unknown drive error",
        createdAt: null,
      };
      driveWarning = driveErr.message || "Drive copy failed";
    }

    await Orders.updateOne(
      { _id: newOrder._id },
      { $set: { driveFile } }
    );

    const savedOrder = await Orders.findById(newOrder._id).lean();

    return res.json({
      success: true,
      message: isEnquiryOnly
        ? "Enquiry added successfully"
        : driveFile.status === "created"
          ? "Order added successfully and Drive file created"
          : "Order added successfully",
      orderId: newOrder._id,
      orderNumber: newOrderNumber,
      result: savedOrder,
      driveFile,
      warning: driveWarning,
    });
  } catch (error) {
    console.error("Error saving order:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to add order",
      error: error.message,
    });
  }
});

router.patch("/:id/stage", patchOrderStage);
router.get("/:id/tasks", listOrderTasks);

/* ----------------------- UNIFIED VIEW ----------------------- */
router.get("/all-data", async (req, res) => {
  try {
    const delivered = await Orders.find({ Status: { $elemMatch: { Task: "Delivered" } } });

    const report = await Orders.find({
      Status: { $elemMatch: { Task: "Delivered" } },
      Items: { $exists: true, $not: { $size: 0 } },
    });

    const outstanding = await Orders.find({
      Status: { $not: { $elemMatch: { Task: "Delivered" } } },
    });

    const allvendors = await Orders.aggregate([
      {
        $addFields: {
          stepsNeedingVendor: {
            $filter: {
              input: "$Steps",
              as: "st",
              cond: {
                $or: [
                  { $eq: ["$$st.vendorId", null] },
                  { $eq: ["$$st.vendorId", ""] },
                  { $eq: ["$$st.posting.isPosted", false] },
                ],
              },
            },
          },
        },
      },
      { $match: { "stepsNeedingVendor.0": { $exists: true } } },
      {
        $project: {
          Order_uuid: 1,
          Order_Number: 1,
          Customer_uuid: 1,
          ItemsRemarks: "$Items.Remark",
          StepsPending: {
            $map: {
              input: "$stepsNeedingVendor",
              as: "s",
              in: {
                stepId: "$$s._id",
                label: "$$s.label",
                vendorId: "$$s.vendorId",
                vendorName: "$$s.vendorName",
                costAmount: "$$s.costAmount",
                isPosted: "$$s.posting.isPosted",
              },
            },
          },
        },
      },
      { $sort: { Order_Number: -1 } },
    ]);

    const bills = await Orders.find({
      Status: { $elemMatch: { Task: "Delivered" } },
      $or: [{ Items: { $exists: false } }, { Items: { $size: 0 } }],
    });

    res.json({ delivered, report, outstanding, allvendors, bills });
  } catch (error) {
    console.error("Error generating unified report:", error.message);
    res.status(500).json({ error: "Failed to load report data" });
  }
});

/* ------------------ BILL STATUS (Paid/Unpaid) ------------------ */
/**
 * Supports BOTH payload shapes:
 * - frontend old: { billStatus: "paid" }
 * - frontend new: { status: "paid" }
 */
// ------------------ BILL STATUS (Paid/Unpaid) ------------------
router.patch("/bills/:id/status", async (req, res) => {
  try {
    const id = String(req.params.id || "").trim();
    const filter = idToFilter(id);
    if (!filter) {
      return res.status(400).json({ success: false, message: "Invalid Order id" });
    }

    const incoming = String(req.body?.billStatus || "").toLowerCase().trim();
    if (!["paid", "unpaid"].includes(incoming)) {
      return res.status(400).json({
        success: false,
        message: "billStatus must be 'paid' or 'unpaid'",
      });
    }

    const paidBy = req.body?.paidBy ? String(req.body.paidBy).trim() : null;
    const paidNote = req.body?.paidNote ? String(req.body.paidNote).trim() : null;

    const billPaidAt = incoming === "paid" ? new Date() : null;

    const set = {
      billStatus: incoming,
      billPaidAt,
      billPaidBy: incoming === "paid" ? (paidBy || "system") : null,
      billPaidNote: incoming === "paid" ? paidNote : null,
      billPaidTxnUuid: incoming === "paid" ? (req.body?.txnUuid || null) : null,
      billPaidTxnId: incoming === "paid" ? (req.body?.txnId ?? null) : null,
    };

    // ✅ Update only (fast + safe)
    const upd = await Orders.updateOne(filter, { $set: set }, { runValidators: false });
    if (upd.matchedCount === 0) {
      return res.status(404).json({ success: false, message: "Order not found" });
    }

    // ✅ Return minimal fields (prevents response failure after DB update)
    return res.json({
      success: true,
      result: {
        billStatus: incoming,
        billPaidAt,
        billPaidBy: incoming === "paid" ? (paidBy || "system") : null,
      },
    });
  } catch (e) {
    console.error("PATCH /order/bills/:id/status error:", e);
    return res.status(500).json({ success: false, message: e.message });
  }
});


/* ----------------------- LATEST-STATUS AWARE LISTS ----------------------- */
const latestStatusProjectionStages = [
  {
    $addFields: {
      latestStatus: {
        $cond: [
          { $gt: [{ $size: { $ifNull: ["$Status", []] } }, 0] },
          { $arrayElemAt: ["$Status", { $subtract: [{ $size: "$Status" }, 1] }] },
          null,
        ],
      },
    },
  },
  {
    $addFields: {
      latestTaskLower: {
        $toLower: {
          $trim: { input: { $ifNull: ["$latestStatus.Task", ""] } },
        },
      },
      hasBillable: {
        $anyElementTrue: {
          $map: {
            input: { $ifNull: ["$Items", []] },
            as: "it",
            in: {
              $gt: [
                {
                  $toDouble: { $ifNull: ["$$it.Amount", 0] },
                },
                0,
              ],
            },
          },
        },
      },
    },
  },
];

router.get("/tasks/mine", async (req, res) => {
  try {
    const userName = String(req.query.userName || req.user?.userName || "").trim();
    if (!userName) {
      return res.status(400).json({ success: false, message: "userName is required" });
    }

    const user = await Users.findOne({ User_name: userName });
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    const result = await getPendingOrdersForUser(user);
    res.json({
      success: true,
      result: {
        ...result,
        message: buildTaskSummaryMessage({ employee: user, orders: result.orders }),
      },
    });
  } catch (error) {
    console.error("tasks/mine error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

router.get("/tasks/queue", async (_req, res) => {
  try {
    const rows = await getUnassignedOrders();
    res.json({ success: true, result: rows });
  } catch (error) {
    console.error("tasks/queue error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

router.patch("/:id/assign", async (req, res) => {
  try {
    const updated = await assignOrderToUser({
      orderId: req.params.id,
      userId: req.body?.userId,
      userName: req.body?.userName,
      assignedBy: req.body?.assignedBy || req.user?.userName || "System",
      via: req.body?.via || "app",
    });

    res.json({ success: true, result: updated });
  } catch (error) {
    console.error("assign order error:", error);
    const code = /not found/i.test(error.message) ? 404 : 400;
    res.status(code).json({ success: false, message: error.message });
  }
});

router.get("/GetOrderList", async (req, res) => {
  try {
    const rows = await Orders.aggregate([
      ...latestStatusProjectionStages,
      {
        $match: {
          latestTaskLower: { $nin: ["delivered", "cancel", "cancelled"] },
        },
      },
    ]);
    res.json({ success: true, result: rows });
  } catch (err) {
    console.error("GetOrderList error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get("/GetDeliveredList", async (req, res) => {
  try {
    const rows = await Orders.aggregate([
      ...latestStatusProjectionStages,
      {
        $match: {
          latestTaskLower: "delivered",
          hasBillable: false,
        },
      },
    ]);
    res.json({ success: true, result: rows });
  } catch (err) {
    console.error("GetDeliveredList error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get("/GetBillList", async (req, res) => {
  try {
    const rows = await Orders.aggregate([
      ...latestStatusProjectionStages,
      {
        $match: {
          latestTaskLower: "delivered",
          hasBillable: true,
        },
      },
    ]);
    res.json({ success: true, result: rows });
  } catch (err) {
    console.error("GetBillList error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

/* ----------------------- ✅ NEW: PAGED BILLS LIST ----------------------- */
/**
 * GET /order/GetBillListPaged?page=1&limit=50&search=&task=&paid=
 * - search: matches Customer_uuid, Items.Remark, Order_Number (if numeric)
 * - task: mostly redundant because bills are delivered only, but kept for your UI
 * - paid: paid/unpaid
 */
router.get("/GetBillListPaged", async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page || "1", 10), 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit || "50", 10), 1), 200);
    const skip = (page - 1) * limit;

    const search = String(req.query.search || "").trim();
    const task = String(req.query.task || "").trim().toLowerCase();
    const paid = String(req.query.paid || "").trim().toLowerCase();

    const rx = search ? new RegExp(escapeRegex(search), "i") : null;

    // safer numeric convert for Amount (handles ₹, commas, etc.)
    const amountToDouble = (path) => ({
      $convert: {
        input: {
          $replaceAll: {
            input: {
              $replaceAll: {
                input: {
                  $replaceAll: {
                    input: { $toString: { $ifNull: [path, "0"] } },
                    find: "₹",
                    replacement: "",
                  },
                },
                find: ",",
                replacement: "",
              },
            },
            find: " ",
            replacement: "",
          },
        },
        to: "double",
        onError: 0,
        onNull: 0,
      },
    });

    const pipeline = [
      // latestStatus + billable + paid normalize
      {
        $addFields: {
          latestStatus: {
            $cond: [
              { $gt: [{ $size: { $ifNull: ["$Status", []] } }, 0] },
              { $arrayElemAt: ["$Status", { $subtract: [{ $size: "$Status" }, 1] }] },
              null,
            ],
          },
        },
      },
      {
        $addFields: {
          latestTaskLower: {
            $toLower: { $trim: { input: { $ifNull: ["$latestStatus.Task", ""] } } },
          },
          billStatusLower: {
            $toLower: { $trim: { input: { $ifNull: ["$billStatus", ""] } } },
          },
          hasBillable: {
            $anyElementTrue: {
              $map: {
                input: { $ifNull: ["$Items", []] },
                as: "it",
                in: { $gt: [amountToDouble("$$it.Amount"), 0] },
              },
            },
          },
        },
      },

      // bills = delivered + billable
      { $match: { latestTaskLower: "delivered", hasBillable: true } },

      ...(task ? [{ $match: { latestTaskLower: task } }] : []),
      ...(paid ? [{ $match: { billStatusLower: paid } }] : []),

      ...(rx
        ? [
          {
            $match: {
              $or: [
                { Customer_uuid: rx },
                { "Items.Remark": rx },
                ...(Number.isFinite(Number(search)) ? [{ Order_Number: Number(search) }] : []),
              ],
            },
          },
        ]
        : []),

      { $sort: { Order_Number: -1 } },

      {
        $facet: {
          data: [{ $skip: skip }, { $limit: limit }],
          total: [{ $count: "count" }],
        },
      },
    ];

    const result = await Orders.aggregate(pipeline);
    const rows = result?.[0]?.data || [];
    const total = result?.[0]?.total?.[0]?.count || 0;

    return res.json({ success: true, result: rows, total, page, limit });
  } catch (err) {
    console.error("GetBillListPaged error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ----------------------- CUSTOMER CHECKS ----------------------- */
router.get("/CheckCustomer/:customerUuid", async (req, res) => {
  const { customerUuid } = req.params;
  try {
    const orderExists = await Orders.findOne({ Customer_uuid: customerUuid });
    res.json({ exists: !!orderExists });
  } catch (error) {
    console.error("Error checking orders:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

router.post("/CheckMultipleCustomers", async (req, res) => {
  try {
    const { ids } = req.body;
    const linked = await Orders.find({ Customer_uuid: { $in: ids } }).distinct("Customer_uuid");
    res.status(200).json({ linkedIds: linked });
  } catch (err) {
    res.status(500).json({ error: "Error checking linked orders" });
  }
});

/* ----------------------- RAW FEED for AllVendors ----------------------- */
router.get("/allvendors-raw", async (req, res) => {
  try {
    const deliveredOnly = String(req.query.deliveredOnly || "").toLowerCase() === "true";

    const pipeline = [
      {
        $project: {
          Order_Number: 1,
          Customer_uuid: 1,
          Items: 1,
          Steps: 1,
          Status: 1,
          latestStatus: {
            $cond: [
              { $gt: [{ $size: { $ifNull: ["$Status", []] } }, 0] },
              { $arrayElemAt: ["$Status", { $subtract: [{ $size: "$Status" }, 1] }] },
              null,
            ],
          },
        },
      },
      {
        $addFields: {
          RemarkText: {
            $let: {
              vars: {
                rems: {
                  $filter: {
                    input: {
                      $map: {
                        input: { $ifNull: ["$Items", []] },
                        as: "it",
                        in: { $trim: { input: { $ifNull: ["$$it.Remark", ""] } } },
                      },
                    },
                    as: "r",
                    cond: { $ne: ["$$r", ""] },
                  },
                },
              },
              in: {
                $reduce: {
                  input: "$$rems",
                  initialValue: "",
                  in: {
                    $cond: [
                      { $eq: ["$$value", ""] },
                      "$$this",
                      { $concat: ["$$value", " | ", "$$this"] },
                    ],
                  },
                },
              },
            },
          },
        },
      },
      ...(deliveredOnly ? [{ $match: { "latestStatus.Task": { $regex: /^delivered$/i } } }] : []),
      { $sort: { Order_Number: -1 } },
    ];

    const docs = await Orders.aggregate(pipeline);
    res.json({ rows: docs, total: docs.length });
  } catch (e) {
    console.error("allvendors-raw error:", e);
    res.status(500).json({ error: e.message });
  }
});

/* ----------------------- LEGACY PAGE: ALL VENDORS ----------------------- */
router.get("/allvendors", async (req, res) => {
  try {
    const search = (req.query.search || "").trim();

    const match = {};
    if (search) {
      const num = +search;
      match.$or = [
        { Order_Number: Number.isNaN(num) ? -1 : num },
        { Customer_uuid: new RegExp(search, "i") },
        { "Items.Remark": new RegExp(search, "i") },
      ];
    }

    const rows = await Orders.aggregate([
      { $match: Object.keys(match).length ? match : {} },
      {
        $addFields: {
          stepsNeedingVendor: {
            $filter: {
              input: "$Steps",
              as: "st",
              cond: {
                $or: [
                  { $eq: ["$$st.vendorId", null] },
                  { $eq: ["$$st.vendorId", ""] },
                  { $eq: ["$$st.posting.isPosted", false] },
                ],
              },
            },
          },
        },
      },
      { $match: { "stepsNeedingVendor.0": { $exists: true } } },
      {
        $project: {
          Order_uuid: 1,
          Order_Number: 1,
          Customer_uuid: 1,
          Items: 1,
          StepsPending: {
            $map: {
              input: "$stepsNeedingVendor",
              as: "s",
              in: {
                stepId: "$$s._id",
                label: "$$s.label",
                vendorId: "$$s.vendorId",
                vendorName: "$$s.vendorName",
                costAmount: "$$s.costAmount",
                isPosted: "$$s.posting.isPosted",
              },
            },
          },
        },
      },
      { $sort: { Order_Number: -1 } },
    ]);

    res.json({ rows, total: rows.length });
  } catch (e) {
    console.error("allvendors error:", e);
    res.status(500).json({ error: e.message });
  }
});

/* ----------------------- DnD STATUS (no-readback, success-on-push) ----------------------- */

/** POST /order/updateStatus — accepts {Order_id, Task} and {orderId, newStatus} */
router.post("/updateStatus", async (req, res) => {
  const { id, task } = parseStatusPayload(req);
  if (!id || !task) {
    if (!isProd) console.error("[order.updateStatus] bad payload:", { body: req.body });
    return res.status(400).json({ success: false, message: "Order id and Task are required" });
  }

  const filter = idToFilter(id);
  if (!filter) return res.status(400).json({ success: false, message: "Invalid Order id" });

  const out = await pushStatusOnly(filter, task, "DragDrop");
  if (!out.ok) {
    if (!isProd) console.error("[order.updateStatus] fail:", out.msg, { id, task, filter });
    return res.status(out.code || 500).json({ success: false, message: out.msg });
  }

  return res.json({ success: true, message: "Status updated" });
});

/** PUT /order/updateStatus/:id — UI fallback */
router.put("/updateStatus/:id", async (req, res) => {
  const id = String(req.params.id || "").trim();
  const task = String(req.body?.Task || req.body?.task || "").trim();

  if (!id || !task) {
    if (!isProd) console.error("[order.updateStatus/:id] bad payload:", { params: req.params, body: req.body });
    return res.status(400).json({ success: false, message: "Order id and Task are required" });
  }

  const filter = idToFilter(id);
  if (!filter) return res.status(400).json({ success: false, message: "Invalid Order id" });

  const out = await pushStatusOnly(filter, task, "DragDrop");
  if (!out.ok) {
    if (!isProd) console.error("[order.updateStatus/:id] fail:", out.msg, { id, task, filter });
    return res.status(out.code || 500).json({ success: false, message: out.msg });
  }

  return res.json({ success: true, message: "Status updated" });
});

/** POST /order/addStatus — legacy alias */
router.post("/addStatus", async (req, res) => {
  const { id, task } = parseStatusPayload(req);
  if (!id || !task) {
    if (!isProd) console.error("[order.addStatus] bad payload:", { body: req.body });
    return res.status(400).json({ success: false, message: "Order id and Task are required" });
  }
  const filter = idToFilter(id);
  if (!filter) return res.status(400).json({ success: false, message: "Invalid Order id" });

  const out = await pushStatusOnly(filter, task, "API");
  if (!out.ok) {
    if (!isProd) console.error("[order.addStatus] fail:", out.msg, { id, task, filter });
    return res.status(out.code || 500).json({ success: false, message: out.msg });
  }

  return res.json({ success: true, message: "Status added" });
});

/* ----------------------- UPDATE ORDER (generic) ----------------------- */
router.put("/updateOrder/:id", async (req, res) => {
  try {
    const { Delivery_Date, Items, ...otherFields } = req.body;

    if (Items) otherFields.Items = normalizeItems(Items);

    const order = await Orders.findById(req.params.id);
    if (!order) return res.status(404).json({ success: false, message: "Order not found" });

    if (Delivery_Date) {
      const lastIndex = (order.Status?.length || 1) - 1;
      if (lastIndex >= 0) {
        order.Status[lastIndex].Delivery_Date = toDate(
          Delivery_Date,
          order.Status[lastIndex].Delivery_Date
        );
      }
    }

    Object.assign(order, otherFields);
    const saved = await order.save();
    return res.json({ success: true, result: saved });
  } catch (err) {
    console.error("Update error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

/* ----------------------- UPDATE DELIVERY (Items only) ----------------------- */
router.put("/updateDelivery/:id", async (req, res) => {
  const { id } = req.params;
  const { Customer_uuid, Items } = req.body;

  try {
    const isObjectId = mongoose.isValidObjectId(id);
    const filter = isObjectId ? { _id: id } : { Order_uuid: id };

    const incoming = normalizeItems(Items || []);
    if (!Customer_uuid && incoming.length === 0) {
      return res.status(400).json({ success: false, message: "Nothing to update" });
    }

    const update = {};
    if (Customer_uuid) update.$set = { Customer_uuid };
    if (incoming.length > 0) update.$push = { Items: { $each: incoming } };

    const result = await Orders.updateOne(filter, update, { runValidators: false });
    if (result.matchedCount === 0) {
      return res.status(404).json({ success: false, message: "Order not found" });
    }

    const refreshed = await Orders.findOne(filter).lean();

    return res.status(200).json({
      success: true,
      message: "Order updated successfully",
      result: refreshed,
    });
  } catch (error) {
    console.error("Error updating order:", error);
    res
      .status(500)
      .json({ success: false, message: "Error updating order", error: error.message });
  }
});

/* ----------------------- REPORTS: VENDOR MISSING ----------------------- */
router.get("/reports/vendor-missing", async (req, res) => {
  try {
    const page = parseInt(req.query.page || "1", 10);
    const limit = parseInt(req.query.limit || "20", 10);
    const skip = (page - 1) * limit;
    const deliveredOnly = req.query.deliveredOnly === "true";
    const search = (req.query.search || "").trim();

    const match = {};
    if (deliveredOnly) match.Status = { $elemMatch: { Task: "Delivered" } };
    if (search) {
      const num = +search;
      match.$or = [
        { Order_Number: Number.isNaN(num) ? -1 : num },
        { Customer_uuid: new RegExp(search, "i") },
        { "Items.Remark": new RegExp(search, "i") },
      ];
    }

    const pipeline = [
      { $match: match },
      {
        $addFields: {
          stepsNeedingVendor: {
            $filter: {
              input: "$Steps",
              as: "st",
              cond: {
                $or: [
                  { $eq: ["$$st.vendorId", null] },
                  { $eq: ["$$st.vendorId", ""] },
                  { $eq: ["$$st.posting.isPosted", false] },
                ],
              },
            },
          },
        },
      },
      { $match: { "stepsNeedingVendor.0": { $exists: true } } },
      {
        $project: {
          Order_uuid: 1,
          Order_Number: 1,
          Customer_uuid: 1,
          Items: 1,
          StepsPending: {
            $map: {
              input: "$stepsNeedingVendor",
              as: "s",
              in: {
                stepId: "$$s._id",
                label: "$$s.label",
                vendorId: "$$s.vendorId",
                vendorName: "$$s.vendorName",
                costAmount: "$$s.costAmount",
                isPosted: "$$s.posting.isPosted",
              },
            },
          },
        },
      },
      { $sort: { Order_Number: -1 } },
      { $facet: { data: [{ $skip: skip }, { $limit: limit }], total: [{ $count: "count" }] } },
    ];

    const result = await Orders.aggregate(pipeline);
    const data = result[0]?.data || [];
    const total = result[0]?.total?.[0]?.count || 0;
    res.json({ page, limit, total, rows: data });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* ------------------ CREATE STEP ------------------ */
router.post("/orders/:orderId/steps", async (req, res) => {
  const { orderId } = req.params;
  const {
    uuid: stepUuid,
    label,
    vendorCustomerUuid = null,
    vendorId = null,
    vendorName = null,
    costAmount = 0,
    plannedDate = null,
    checked = false,
    status = "pending",
  } = req.body;

  if (!label || typeof label !== "string") {
    return res.status(400).json({ ok: false, error: "label is required" });
  }

  try {
    const order = await Orders.findById(orderId);
    if (!order) return res.status(404).json({ ok: false, error: "Order not found" });

    const step = {
      uuid: stepUuid ? String(stepUuid).trim() : undefined,
      label: String(label).trim(),
      normLabel: normLower(label),
      checked: !!checked,
      vendorId: vendorCustomerUuid ?? vendorId ?? null,
      vendorName,
      costAmount: Number(costAmount || 0),
      plannedDate: plannedDate ? new Date(plannedDate) : undefined,
      status,
      posting: { isPosted: false, txnId: null, postedAt: null },
    };

    order.Steps = Array.isArray(order.Steps) ? order.Steps : [];
    order.Steps.push(step);
    await order.save();

    const created = order.Steps[order.Steps.length - 1];
    res.json({ ok: true, stepId: created._id, steps: order.Steps });
  } catch (e) {
    console.error("create step error:", e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

/* ------------------ EDIT STEP ------------------ */
router.patch("/orders/:orderId/steps/:stepId", async (req, res) => {
  const { orderId, stepId } = req.params;
  const allowed = [
    "uuid",
    "label",
    "vendorId",
    "vendorCustomerUuid",
    "vendorName",
    "costAmount",
    "plannedDate",
    "status",
    "checked",
  ];
  const patch = {};
  for (const k of allowed) if (k in req.body) patch[k] = req.body[k];

  try {
    const order = await Orders.findById(orderId);
    if (!order) return res.status(404).json({ ok: false, error: "Order not found" });

    const step = order.Steps.id(stepId);
    if (!step) return res.status(404).json({ ok: false, error: "Step not found" });

    if ("plannedDate" in patch && patch.plannedDate) patch.plannedDate = new Date(patch.plannedDate);
    if ("costAmount" in patch) patch.costAmount = Number(patch.costAmount || 0);
    if ("vendorCustomerUuid" in patch && patch.vendorCustomerUuid && !patch.vendorId) {
      patch.vendorId = patch.vendorCustomerUuid;
    }
    if ("label" in patch && patch.label) {
      patch.label = String(patch.label).trim();
      patch.normLabel = normLower(patch.label);
    }
    if ("uuid" in patch && patch.uuid) {
      patch.uuid = String(patch.uuid).trim();
    }

    Object.assign(step, patch);
    await order.save();
    res.json({ ok: true, step });
  } catch (e) {
    console.error("edit step error:", e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

/* --------- ASSIGN VENDOR & POST (purchase journal) --------- */
router.post("/orders/:orderId/steps/:stepId/assign-vendor", async (req, res) => {
  const { orderId, stepId } = req.params;
  const { vendorId, vendorName, vendorCustomerUuid, costAmount, plannedDate, createdBy } = req.body;

  const resolvedVendor = vendorId || vendorCustomerUuid || vendorName;
  if (!resolvedVendor)
    return res
      .status(400)
      .json({ ok: false, error: "Provide vendorId or vendorCustomerUuid or vendorName" });

  const amount = Number(costAmount ?? 0);
  if (Number.isNaN(amount) || amount < 0)
    return res.status(400).json({ ok: false, error: "Invalid costAmount" });

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const order = await Orders.findById(orderId).session(session);
      if (!order) throw new Error("Order not found");

      const step = order.Steps.id(stepId);
      if (!step) throw new Error("Step not found");

      step.vendorId = vendorCustomerUuid ?? vendorId ?? step.vendorId ?? null;
      step.vendorName = vendorName ?? step.vendorName ?? null;
      step.costAmount = amount;
      if (plannedDate) step.plannedDate = new Date(plannedDate);

      if (step.posting?.isPosted) {
        await order.save({ session });
        return res.json({
          ok: true,
          message: "Vendor saved. Step already posted.",
          txnId: step.posting.txnId,
        });
      }

      if (amount === 0) {
        step.status = "done";
        step.posting = { isPosted: false, txnId: null, postedAt: null };
        await order.save({ session });
        return res.json({ ok: true, message: "Vendor saved (no posting for 0 amount)." });
      }

      const lines = [
        { Account_id: `${resolvedVendor}`, Type: "Debit", Amount: amount },
        // TODO: replace with your real Purchase/Cash/Bank account id
        { Account_id: "fdf29a16-1e87-4f57-82d6-6b31040d3f1e", Type: "Credit", Amount: amount },
      ];

      const txnDate = plannedDate ? new Date(plannedDate) : new Date();

      const lastTxn = await Transaction.findOne({}, { Transaction_id: 1 })
        .sort({ Transaction_id: -1 })
        .session(session)
        .lean();
      const nextId = (lastTxn?.Transaction_id || 0) + 1;

      const txnDocs = await Transaction.create(
        [
          {
            Transaction_uuid: uuid(),
            Transaction_id: nextId,
            Order_uuid: order.Order_uuid || null,
            Order_number: order.Order_Number,
            Transaction_date: txnDate,
            Description: `Outsource step: ${step.label} (Order #${order.Order_Number})`,
            Total_Debit: amount,
            Total_Credit: amount,
            Payment_mode: "purchase",
            Created_by: createdBy || "system",
            image: null,
            Journal_entry: lines,
          },
        ],
        { session }
      );

      step.posting = { isPosted: true, txnId: txnDocs[0]._id, postedAt: new Date() };
      step.status = "posted";

      await order.save({ session });
      res.json({ ok: true, txnId: txnDocs[0]._id, transactionId: nextId });
    });
  } catch (e) {
    console.error("assign-vendor error:", e);
    res.status(500).json({ ok: false, error: e.message });
  } finally {
    session.endSession();
  }
});

/* ------------------ TOGGLE STEP (add/remove) ------------------ */
router.post("/steps/toggle", async (req, res) => {
  try {
    const { orderId, step = {}, checked } = req.body || {};
    if (!orderId || typeof checked !== "boolean") {
      return res.status(400).json({ success: false, message: "orderId and checked are required" });
    }
    const uuidStr = norm(step.uuid || "");
    const label = norm(step.label || "");
    const labelNorm = normLower(label);

    if (!uuidStr && !label) {
      return res.status(400).json({ success: false, message: "Provide step.uuid or step.label" });
    }

    const find = { _id: orderId };

    if (checked) {
      // ADD
      const doc = await Orders.findOne(find, { Steps: 1 }).lean();
      if (!doc) return res.status(404).json({ success: false, message: "Order not found" });

      const exists =
        Array.isArray(doc.Steps) &&
        doc.Steps.some((s) =>
          (uuidStr && String(s.uuid || "") === uuidStr) ||
          (label && normLower(s.normLabel || s.label || "") === labelNorm)
        );

      if (exists) return res.json({ success: true, updated: false });

      const now = new Date();
      await Orders.updateOne(find, {
        $push: {
          Steps: {
            uuid: uuidStr || undefined,
            label,
            normLabel: labelNorm,
            checked: true,
            vendorId: null,
            vendorName: null,
            costAmount: 0,
            plannedDate: undefined,
            status: "pending",
            posting: { isPosted: false, txnId: null, postedAt: null },
            addedAt: now,
          },
        },
      });
      return res.json({ success: true, updated: true });
    }

    // UNCHECK
    const pullOr = [];
    if (uuidStr) pullOr.push({ uuid: uuidStr });
    if (label) {
      pullOr.push({ normLabel: labelNorm });
      pullOr.push({ label: new RegExp(`^\\s*${escapeRegex(label)}\\s*$`, "i") });
    }

    const result = await Orders.updateOne(find, { $pull: { Steps: { $or: pullOr } } });
    return res.json({ success: true, updated: result.modifiedCount > 0 });
  } catch (e) {
    console.error("/order/steps/toggle error", e);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

/* ----------------------- ✅ IMPORTANT: KEEP THIS LAST ----------------------- */
/* GET BY ID (must be LAST, otherwise it captures /GetBillListPaged etc.) */
router.get("/:id", async (req, res) => {
  const orderId = req.params.id;
  try {
    if (!mongoose.isValidObjectId(orderId)) {
      return res.status(400).json({ message: "Invalid order id" });
    }
    const order = await Orders.findById(orderId);
    if (!order) return res.status(404).json({ message: "Order not found" });
    res.json(order);
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
});

module.exports = router;
