const express = require("express");
const router = express.Router();
const Tasks = require("../repositories/tasks");
const { v4: uuid } = require("uuid");
const { createTask } = require("../services/taskService");

router.post("/addTask", async (req, res) => {
    const{Task_name, Task_group, orderId, deadline, status}=req.body

    try{
        const check=await Tasks.findOne({ Task_name: Task_name })
       
        if(check){
            res.json("exist")
        }
        else{
          const newTask = new Tasks({
            Task_name,
            Task_group,
            Task_uuid: uuid(),
            orderId: orderId || null,
            deadline: deadline || null,
            status: ["pending", "in_progress", "done"].includes(String(status || "").toLowerCase())
              ? String(status).toLowerCase()
              : "pending"
        });
        await newTask.save(); 
        res.json("notexist");
        }

    }
    catch(e){
      console.error("Error saving Task:", e);
      res.status(500).json("fail");
    }
  });

router.post("/", async (req, res) => {
  try {
    const task = await createTask(req.body);
    return res.status(201).json({ success: true, result: task });
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to create task",
    });
  }
});



  router.get("/GetTaskList", async (req, res) => {
    try {
      let data = await Tasks.find({});
  
      if (data.length)
        res.json({ success: true, result: data.filter((a) => a.Task_name) });
      else res.json({ success: false, message: "Task Not found" });
    } catch (err) {
      console.error("Error fetching Task:", err);
        res.status(500).json({ success: false, message: err });
    }
  });

  router.get('/:id', async (req, res) => {
    const { id } = req.params; 

    try {
        const task = await Tasks.findById(id);  

        if (!task) {
            return res.status(404).json({
                success: false,
                message: ' Task not found',
            });
        }

        res.status(200).json({
            success: true,
            result: task,
        });
    } catch (error) {
        console.error('Error fetching task:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching task',
            error: error.message,
        });
    }
});

  router.put("/update/:id", async (req, res) => {
    const { id } = req.params;
    const { Task_name, Task_group } = req.body;

    try {
        const user = await Tasks.findByIdAndUpdate(id, {
            Task_name,
            Task_group
        }, { new: true }); 

        if (!user) {
            return res.status(404).json({ success: false, message: "Task not found" });
        }

        res.json({ success: true, result: user });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: "Server error" });
    }
});

router.delete('/Delete/:taskId', async (req, res) => {
  const { taskId } = req.params;
  try {
      const task = await Tasks.findByIdAndDelete(taskId);
      if (!task) {
          return res.status(404).json({ success: false, message: 'Task not found' });
      }
      return res.status(200).json({ success: true, message: 'Task deleted successfully' });
  } catch (error) {
      return res.status(500).json({ success: false, message: 'Error deleting task' });
  }
});



  module.exports = router;
