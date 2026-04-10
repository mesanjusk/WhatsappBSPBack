const express = require("express");
const router = express.Router();
const Payment_mode = require("../repositories/payment_mode");
const { v4: uuid } = require("uuid");
const asyncHandler = require("../utils/asyncHandler");
const AppError = require("../utils/AppError");

router.post(
  "/addPayment",
  asyncHandler(async (req, res) => {
    const { Payment_name } = req.body;

    const existingPayment = await Payment_mode.findOne({ Payment_name });
    if (existingPayment) {
      return res.json("exist");
    }

    const newPayment = new Payment_mode({
      Payment_name,
      Payment_mode_uuid: uuid(),
    });

    await newPayment.save();
    res.json("notexist");
  })
);

router.get(
  "/GetPaymentList",
  asyncHandler(async (_req, res) => {
    const data = await Payment_mode.find({});

    if (!data.length) {
      throw new AppError("Payment Not found", 200);
    }

    res.json({ success: true, result: data.filter((a) => a.Payment_name) });
  })
);

router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const payment = await Payment_mode.findById(id);

    if (!payment) {
      throw new AppError("Payment not found", 404);
    }

    res.status(200).json({
      success: true,
      result: payment,
    });
  })
);

router.put(
  "/update/:id",
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { Payment_name } = req.body;

    const updatedPayment = await Payment_mode.findOneAndUpdate(
      { _id: id },
      { Payment_name },
      { new: true }
    );

    if (!updatedPayment) {
      throw new AppError("payment not found", 404);
    }

    res.status(200).json({
      success: true,
      message: "payment updated successfully",
      result: updatedPayment,
    });
  })
);

router.delete(
  "/DeletePayment/:paymentUuid",
  asyncHandler(async (req, res) => {
    const { paymentUuid } = req.params;
    const result = await Payment_mode.findOneAndDelete({
      Payment_mode_uuid: paymentUuid,
    });

    if (!result) {
      throw new AppError("payment not found", 404);
    }

    res.json({ success: true, message: "payment deleted successfully" });
  })
);

module.exports = router;
