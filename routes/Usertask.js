const express = require("express");
const router = express.Router();
const Usertasks = require("../repositories/usertask");
const { v4: uuid } = require("uuid");
const { sendMessageToWhatsApp } = require("../services/whatsappService");
const normalizeWhatsAppNumber = require("../utils/normalizeNumber"); // ✅ New import

// Add new user task and optionally send WhatsApp message to user
router.post("/addUsertask", async (req, res) => {
  const { Usertask_name, User, Deadline, Remark } = req.body;

  try {
    const lastUsertask = await Usertasks.findOne().sort({ Usertask_Number: -1 });
    const newTaskNumber = lastUsertask ? lastUsertask.Usertask_Number + 1 : 1;
    const data = await Usertasks.findOne({ Usertask_name });

    if (data) {
      res.json("exist");
    } else {
      const newTask = new Usertasks({
        Usertask_name,
        User,
        Usertask_Number: newTaskNumber,
        Date: new Date().toISOString().split("T")[0],
        Time: new Date().toLocaleTimeString("en-US", { hour12: false }),
        Usertask_uuid: uuid(),
        Deadline,
        Remark,
        Status: "Pending"
      });
      await newTask.save();

      // ✅ Format number before sending message
      try {
        const formattedNumber = normalizeWhatsAppNumber(User);
        await sendMessageToWhatsApp(
          formattedNumber,
          `Hello! Your task "${Usertask_name}" has been created and is pending. Deadline: ${Deadline || "N/A"}`
        );
      } catch (err) {
        console.error("Failed to send WhatsApp message:", err.message);
      }

      res.json("notexist");
    }
  } catch (e) {
    console.error("Error saving Task:", e);
    res.status(500).json("fail");
  }
});

// Direct WhatsApp message route
router.post('/send-message', async (req, res) => {
  const { mobile, message } = req.body;

  if (!mobile || !message) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    const formattedMobile = normalizeWhatsAppNumber(mobile); // ✅ Format mobile number
    const response = await sendMessageToWhatsApp(formattedMobile, message);
    res.status(200).json(response);
  } catch (error) {
    console.error('WhatsApp Send Error:', error);
    res.status(500).json({ error: 'Failed to send message' });
  }
});

// Get all user tasks
router.get("/GetUsertaskList", async (req, res) => {
  try {
    let data = await Usertasks.find({});
    if (data.length)
      res.json({ success: true, result: data.filter((a) => a.Usertask_name) });
    else res.json({ success: false, message: "Task Not found" });
  } catch (err) {
    console.error("Error fetching Task:", err);
    res.status(500).json({ success: false, message: err });
  }
});

// Update a user task
router.put("/update/:id", async (req, res) => {
  const { id } = req.params;
  const { Usertask_name, Usertask_Number, Deadline, Remark, Status } = req.body;

  try {
    const user = await Usertasks.findByIdAndUpdate(
      id,
      {
        Usertask_name,
        Usertask_Number,
        Deadline,
        Remark,
        Status
      },
      { new: true }
    );

    if (!user) {
      return res.status(404).json({ success: false, message: "Task not found" });
    }

    res.json({ success: true, result: user });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

module.exports = router;
