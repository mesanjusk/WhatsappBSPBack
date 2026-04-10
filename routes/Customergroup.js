const express = require("express");
const router = express.Router();
const Customergroup = require("../repositories/customergroup");
const { v4: uuid } = require("uuid");

router.post("/addCustomergroup", async (req, res) => {
    const{ Customer_group}=req.body

    try{
        const check=await Customergroup.findOne({ Customer_group: Customer_group })

        if(check){
            res.json("exist")
        }
        else{
          const newGroup = new Customergroup({
            Customer_group,
            Customer_group_uuid: uuid()
        });
        await newGroup.save(); 
        res.json("notexist");
        }

    }
    catch(e){
      console.error("Error saving group:", e);
      res.status(500).json("fail");
    }
  });



  router.get("/GetCustomergroupList", async (req, res) => {
    try {
      let data = await Customergroup.find({});
  
      if (data.length)
        res.json({ success: true, result: data.filter((a) => a.Customer_group) });
      else res.json({ success: false, message: "Customer Group Not found" });
    } catch (err) {
      console.error("Error fetching group:", err);
        res.status(500).json({ success: false, message: err });
    }
  });

  
  module.exports = router;