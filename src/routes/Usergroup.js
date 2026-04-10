const express = require("express");
const router = express.Router();
const Usergroup = require("../repositories/usergroup");
const { v4: uuid } = require("uuid");
const asyncHandler = require("../utils/asyncHandler");
const AppError = require("../utils/AppError");

router.post(
  "/addUsergroup",
  asyncHandler(async (req, res) => {
    const { User_group } = req.body;

    const check = await Usergroup.findOne({ User_group });
    if (check) {
      return res.json("exist");
    }

    const newGroup = new Usergroup({
      User_group,
      User_group_uuid: uuid(),
    });

    await newGroup.save();
    res.json("notexist");
  })
);

router.get(
  "/GetUsergroupList",
  asyncHandler(async (_req, res) => {
    const data = await Usergroup.find({});

    if (!data.length) {
      throw new AppError("User Group Not found", 200);
    }

    res.json({ success: true, result: data.filter((a) => a.User_group) });
  })
);

router.get(
  "/getGroup/:userGroup",
  asyncHandler(async (req, res) => {
    const userGroup = req.params.userGroup;

    const group = await Usergroup.findOne({ User_group: userGroup });

    if (!group) {
      throw new AppError("User Group not found!", 404);
    }

    res.status(200).json({ success: true, group });
  })
);

module.exports = router;
