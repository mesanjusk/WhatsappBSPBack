const express = require("express");
const router = express.Router();
const Items = require("../repositories/items");
const { v4: uuid } = require("uuid");
const Transaction = require("../repositories/transaction");
const Order = require("../repositories/order");

const normalizeArray = (value) => {
  if (!value) return [];
  if (Array.isArray(value)) return value.map((v) => String(v || "").trim()).filter(Boolean);
  return String(value)
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
};

const normalizeBom = (bom = []) => {
  if (!Array.isArray(bom)) return [];
  return bom
    .map((row) => ({
      componentItemUuid: String(row?.componentItemUuid || row?.Item_uuid || "").trim(),
      componentItemName: String(row?.componentItemName || row?.componentName || row?.Item_name || "").trim(),
      componentType: ["raw_material", "service", "finished_item", "consumable"].includes(String(row?.componentType || "").trim())
        ? String(row.componentType).trim()
        : "raw_material",
      itemGroup: String(row?.itemGroup || row?.Item_group || "").trim(),
      qty: Number(row?.qty ?? row?.Quantity ?? 0) || 0,
      unit: String(row?.unit || "Nos").trim() || "Nos",
      wastePercent: Number(row?.wastePercent ?? 0) || 0,
      executionMode: ["stock", "purchase", "in_house", "vendor", "hybrid"].includes(String(row?.executionMode || "").trim())
        ? String(row.executionMode).trim()
        : "stock",
      preferredVendorUuids: normalizeArray(row?.preferredVendorUuids),
      preferredUserGroups: normalizeArray(row?.preferredUserGroups),
      preferredUserNames: normalizeArray(row?.preferredUserNames),
      defaultCost: Number(row?.defaultCost ?? 0) || 0,
      note: String(row?.note || "").trim(),
    }))
    .filter((row) => row.componentItemName);
};

router.post("/addItem", async (req, res) => {
  const {
    Item_name,
    Item_group,
    itemType = "finished_item",
    unit = "Nos",
    stockTracked = false,
    openingStock = 0,
    reorderLevel = 0,
    defaultPurchaseRate = 0,
    defaultSaleRate = 0,
    executionMode = "stock",
    preferredVendorUuids = [],
    preferredUserGroups = [],
    preferredUserNames = [],
    description = "",
    bom = [],
  } = req.body;

  try {
    const check = await Items.findOne({ Item_name: Item_name });
    if (check) return res.json("exist");

    const newItem = new Items({
      Item_name,
      Item_group,
      Item_uuid: uuid(),
      itemType,
      unit,
      stockTracked: Boolean(stockTracked),
      openingStock: Number(openingStock || 0),
      reorderLevel: Number(reorderLevel || 0),
      defaultPurchaseRate: Number(defaultPurchaseRate || 0),
      defaultSaleRate: Number(defaultSaleRate || 0),
      executionMode,
      preferredVendorUuids: normalizeArray(preferredVendorUuids),
      preferredUserGroups: normalizeArray(preferredUserGroups),
      preferredUserNames: normalizeArray(preferredUserNames),
      description: String(description || "").trim(),
      bom: normalizeBom(bom),
    });
    await newItem.save();
    res.json("notexist");
  } catch (e) {
    console.error("Error saving Item:", e);
    res.status(500).json("fail");
  }
});

router.get("/GetItemList", async (_req, res) => {
  try {
    const [data, orders, transactions] = await Promise.all([
      Items.find({}).sort({ Item_name: 1 }),
      Order.find({}, "Items"),
      Transaction.find({}, "Item"),
    ]);

    const usedFromOrders = new Set();
    orders.forEach((order) => {
      (order.Items || []).forEach((line) => {
        if (line?.Item) usedFromOrders.add(line.Item);
      });
    });
    const usedFromTransactions = new Set(transactions.map((t) => t.Item).filter(Boolean));
    const allUsed = new Set([...usedFromOrders, ...usedFromTransactions]);

    const itemWithUsage = data.map((i) => ({
      ...i.toObject(),
      isUsed: allUsed.has(i.Item_name),
      bomCount: Array.isArray(i.bom) ? i.bom.length : 0,
    }));

    res.json({ success: true, result: itemWithUsage });
  } catch (err) {
    console.error("Error fetching Item:", err);
    res.status(500).json({ success: false, message: err.message || err });
  }
});

router.get('/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const item = await Items.findById(id);
    if (!item) {
      return res.status(404).json({ success: false, message: 'Item not found' });
    }
    res.status(200).json({ success: true, result: item });
  } catch (error) {
    console.error('Error fetching item:', error);
    res.status(500).json({ success: false, message: 'Error fetching item', error: error.message });
  }
});

router.put('/update/:id', async (req, res) => {
  const { id } = req.params;
  const payload = {
    ...req.body,
    preferredVendorUuids: normalizeArray(req.body?.preferredVendorUuids),
    preferredUserGroups: normalizeArray(req.body?.preferredUserGroups),
    preferredUserNames: normalizeArray(req.body?.preferredUserNames),
    bom: normalizeBom(req.body?.bom),
  };
  try {
    const item = await Items.findByIdAndUpdate(id, payload, { new: true });
    if (!item) {
      return res.status(404).json({ success: false, message: 'Item not found' });
    }
    res.json({ success: true, result: item });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

router.delete('/Delete/:itemId', async (req, res) => {
  const { itemId } = req.params;
  try {
    const item = await Items.findByIdAndDelete(itemId);
    if (!item) {
      return res.status(404).json({ success: false, message: 'Item not found' });
    }
    return res.status(200).json({ success: true, message: 'Item deleted successfully' });
  } catch (_error) {
    return res.status(500).json({ success: false, message: 'Error deleting item' });
  }
});

module.exports = router;
