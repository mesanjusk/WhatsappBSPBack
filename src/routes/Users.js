const express = require("express");
const router = express.Router();
const Users = require("../repositories/users");
const { v4: uuid } = require("uuid");
const jwt = require('jsonwebtoken');
const { hashPassword, isHashedPassword, verifyPassword } = require("../utils/password");
const Transaction = require("../repositories/transaction");
const Order = require("../repositories/order");

// LOGIN
// LOGIN
router.post("/login", async (req, res) => {
  const { User_name, Password } = req.body;

  try {
    const user = await Users.findOne({ User_name });
    if (!user) return res.json({ status: "notexist" });

    const isValidPassword = verifyPassword(Password, user.Password);

    if (isValidPassword) {

      // ✅ CREATE JWT TOKEN
      const token = jwt.sign(
        {
          id: user._id,   // VERY IMPORTANT (used in authenticateToken)
          userName: user.User_name,
          userGroup: user.User_group,
        },
        process.env.ACCESS_TOKEN_SECRET,
        { expiresIn: "99d" }
      );

      if (!isHashedPassword(user.Password)) {
        try {
          user.Password = hashPassword(Password);
          await user.save();
        } catch (hashError) {
          console.error("Password migration failed:", hashError);
        }
      }

      // ✅ SEND TOKEN TO FRONTEND
      res.json({
        status: "exist",
        token: token,
        userGroup: user.User_group,
        userMobile: user.Mobile_number,
      });

    } else {
      res.json({ status: "invalid", message: "Invalid credentials." });
    }
  } catch (e) {
    console.error("Error during login:", e);
    res.status(500).json({ status: "fail" });
  }
});


// ADD USER
router.post("/addUser", async (req, res) => {
  const {
    User_name,
    Password,
    Mobile_number,
    Amount,
    User_group,
    Allowed_Task_Groups
  } = req.body;

  try {
    const check = await Users.findOne({ Mobile_number });
    if (check) {
      res.json("exist");
    } else {
      const newUser = new Users({
        User_name,
        Password: hashPassword(Password),
        Mobile_number,
        User_group,
        Amount,
        Allowed_Task_Groups,
        User_uuid: uuid()
      });
      await newUser.save();
      res.json("notexist");
    }
  } catch (e) {
    console.error("Error saving user:", e);
    res.status(500).json("fail");
  }
});

// GET USER LIST WITH USAGE AND TASK GROUPS
router.get("/GetUserList", async (req, res) => {
  try {
    const [data, orders, transactions] = await Promise.all([
      Users.find({}),
      Order.find({}, 'Status'),
      Transaction.find({}, 'Created_by')
    ]);

    const usedFromOrders = new Set();
    for (const od of orders) {
      for (const entry of od.Status) {
        usedFromOrders.add(entry.Assigned);
      }
    }
    const usedFromTransactions = new Set(transactions.map(t => t.Created_by));
    const allUsed = new Set([...usedFromOrders, ...usedFromTransactions]);

    const userWithUsage = data.map(user => ({
      ...user._doc,
      isUsed: allUsed.has(user.User_name),
      Allowed_Task_Groups: user.Allowed_Task_Groups || []
    }));

    res.json({
      success: true,
      result: userWithUsage,
    });
  } catch (err) {
    console.error("Error fetching users:", err);
    res.status(500).json({ success: false, message: err });
  }
});

// UPDATE USER BY ID (Method 1)
router.put("/updateUser/:id", async (req, res) => {
  const { id } = req.params;
  const { User_name, Password, Mobile_number, User_group, Allowed_Task_Groups } = req.body;

  try {
    const updatePayload = {
      User_name,
      Mobile_number,
      User_group,
      Allowed_Task_Groups
    };

    if (Password) {
      updatePayload.Password = isHashedPassword(Password) ? Password : hashPassword(Password);
    }

    const user = await Users.findByIdAndUpdate(id, updatePayload, { new: true });


    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    res.json({ success: true, result: user });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// AUTH TOKEN CHECK
const authenticateToken = (req, res, next) => {
  const token = req.headers['authorization']?.split(' ')[1];
  if (!token) return res.sendStatus(401);

  jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, user) => {
    if (err) return res.sendStatus(403);
    req.user = user;
    next();
  });
};

// GET LOGGED IN USER GROUP
router.get('/GetLoggedInUser', authenticateToken, async (req, res) => {
  try {
    const user = await Users.findById(req.user.id).select('User_group');
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    res.json({ success: true, result: { group: user.User_group } });
  } catch (error) {
    console.error('Error fetching user group:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

// GET SINGLE USER BY ID
router.get('/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const user = await Users.findById(id);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    res.status(200).json({
      success: true,
      result: user,
    });
  } catch (error) {
    console.error('Error fetching user:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching user',
      error: error.message,
    });
  }
});

// UPDATE USER BY ID (Method 2)
router.put('/update/:id', async (req, res) => {
  const { id } = req.params;
  const { User_name, Mobile_number, User_group, Allowed_Task_Groups } = req.body;

  try {
    const updatedUser = await Users.findOneAndUpdate(
      { _id: id },
      { User_name, Mobile_number, User_group, Allowed_Task_Groups },
      { new: true }
    );

    if (!updatedUser) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    res.status(200).json({
      success: true,
      message: 'User updated successfully',
      result: updatedUser,
    });
  } catch (error) {
    console.error('Error updating user:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating user',
      error: error.message,
    });
  }
});

// GET USER BY NAME
router.get('/getUserByName/:username', async (req, res) => {
  const { username } = req.params;

  try {
    const user = await Users.findOne({ User_name: username });
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    res.status(200).json({
      success: true,
      result: user,
    });
  } catch (error) {
    console.error('Error fetching user:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching user',
      error: error.message,
    });
  }
});

// DELETE USER
router.delete('/DeleteUser/:userUuid', async (req, res) => {
  const { userUuid } = req.params;
  try {
    const result = await Users.findOneAndDelete({ User_uuid: userUuid });
    if (!result) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    res.json({ success: true, message: 'User deleted successfully' });
  } catch (error) {
    console.error('Error deleting user:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

module.exports = router;
