const express = require("express");
const router = express.Router();
const Note = require("../repositories/note");
const { v4: uuid } = require("uuid");

router.post("/addNote", async (req, res) => {
  const { Customer_uuid, Note_name, Order_uuid } = req.body;

  try {
      const check = await Note.findOne({ Note_name: Note_name });
      if (check) {
          return res.json({ success: false, message: "Note already exists" });
      }

      const newNote = new Note({
          Note_name,
          Order_uuid,
          Customer_uuid,
          Note_uuid: uuid(),
      });
      await newNote.save();
      res.json({ success: true, message: "Note added successfully" });
  } catch (e) {
      res.status(500).json({ success: false, message: "Internal server error" });
  }
});



router.get("/:Order_uuid", async (req, res) => {
  const { Order_uuid } = req.params;
  try {
    const notes = await Note.find({ Order_uuid });

    if (notes.length === 0) {
         return res.status(404).json({
        success: false,
        message: "No notes found for this customer.",
      });
    }
    res.status(200).json({
      success: true,
      result: notes,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error fetching notes",
      error: error.message,
    });
  }
});



  module.exports = router;