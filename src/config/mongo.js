const mongoose = require("mongoose");

const connectDB = async () => {
  try {
    const mongoURI = process.env.MONGO_URI;

    if (!mongoURI) {
      throw new Error("MONGO_URI is not set");
    }

    const isProduction = process.env.NODE_ENV === 'production';

    await mongoose.connect(mongoURI, {
      autoIndex: !isProduction,
    });

    if (!isProduction) {
      await mongoose.connection.syncIndexes();
      console.log("✅ MongoDB connected and indexes synced");
      return;
    }

    console.log("✅ MongoDB connected");
  } catch (error) {
    console.error("❌ MongoDB connection error:", error);
    process.exit(1);
  }
};

module.exports = connectDB;
