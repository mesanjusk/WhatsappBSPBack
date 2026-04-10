const express = require("express");
const router = express.Router();
const Enquiry = require("../repositories/enquiry");
const { v4: uuid } = require("uuid");

router.post("/addEnquiry", async (req, res) => {
  const { Customer_name, Priority = "Normal", Item = "New Enquiry", Task = "Design", Delivery_Date, Assigned = "Sai", Remark } = req.body;

  try {
   
      const currentDate = new Date().toISOString().split('T')[0]; 
      
      const lastEnquiry = await Enquiry.findOne().sort({ Enquiry_Number: -1 });
      const newEnquiryNumber = lastEnquiry ? lastEnquiry.Enquiry_Number + 1 : 1;

      const newEnquiry = new Enquiry({
        Enquiry_uuid: uuid(),
        Enquiry_Number: newEnquiryNumber,
          Customer_name,
          Priority: Priority || "Normal",
          Item: Item || "New Category", 
          Task: Task || "Design",       
          Delivery_Date: Delivery_Date || currentDate, 
          Assigned: Assigned || "Sai",  
          Remark
      });

      await newEnquiry.save();
      res.json({ success: true, message: "Enquiry added successfully" });
  } catch (error) {
      console.error("Error saving Enquiry:", error);
      res.status(500).json({ success: false, message: "Failed to add Enquiry" });
  }
});


  module.exports = router;