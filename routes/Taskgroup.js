const express = require("express");
const router = express.Router();
const Taskgroup = require("../repositories/taskgroup");
const { v4: uuid } = require("uuid");
const asyncHandler = require("../utils/asyncHandler");
const AppError = require("../utils/AppError");

router.post(
  "/addTaskgroup",
  asyncHandler(async (req, res) => {
    const { Task_group } = req.body;

    const check = await Taskgroup.findOne({ Task_group });
    if (check) {
      return res.json("exist");
    }

    const newGroup = new Taskgroup({
      Task_group,
      Task_group_uuid: uuid(),
    });

    await newGroup.save();
    res.json("notexist");
  })
);

router.get(
  "/GetTaskgroupList",
  asyncHandler(async (_req, res) => {
    const data = await Taskgroup.find({});

    if (!data.length) {
      throw new AppError("Task Group Not found", 200);
    }

    res.json({ success: true, result: data });
  })
);

module.exports = router;
