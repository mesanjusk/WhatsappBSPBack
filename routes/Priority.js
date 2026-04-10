const express = require("express");
const router = express.Router();
const Priority = require("../repositories/priority");
const { v4: uuid } = require("uuid");
const asyncHandler = require("../utils/asyncHandler");
const AppError = require("../utils/AppError");

router.post(
  "/addPriority",
  asyncHandler(async (req, res) => {
    const { Priority_name } = req.body;

    const check = await Priority.findOne({ Priority_name });
    if (check) {
      return res.json("exist");
    }

    const newPriority = new Priority({
      Priority_name,
      Priority_uuid: uuid(),
    });

    await newPriority.save();
    res.json("notexist");
  })
);

router.get(
  "/GetPriorityList",
  asyncHandler(async (_req, res) => {
    const data = await Priority.find({});

    if (!data.length) {
      throw new AppError("Priority Not found", 200);
    }

    res.json({ success: true, result: data.filter((a) => a.Priority_name) });
  })
);

router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const priority = await Priority.findById(id);

    if (!priority) {
      throw new AppError("Priority not found", 404);
    }

    res.status(200).json({
      success: true,
      result: priority,
    });
  })
);

router.put(
  "/update/:id",
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { Priority_name } = req.body;

    const updatedPriority = await Priority.findOneAndUpdate(
      { _id: id },
      { Priority_name },
      { new: true }
    );

    if (!updatedPriority) {
      throw new AppError("Priority not found", 404);
    }

    res.status(200).json({
      success: true,
      message: "Priority updated successfully",
      result: updatedPriority,
    });
  })
);

router.delete(
  "/DeletePriority/:priorityUuid",
  asyncHandler(async (req, res) => {
    const { priorityUuid } = req.params;
    const result = await Priority.findOneAndDelete({ Priority_uuid: priorityUuid });

    if (!result) {
      throw new AppError("Priority not found", 404);
    }

    res.json({ success: true, message: "Priority deleted successfully" });
  })
);

module.exports = router;
