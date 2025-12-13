const express = require("express");
const cors = require("cors");
const app = express();
const port = 3000;
app.use(cors());
app.use(express.json());
require("dotenv").config();

const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const uri = `mongodb+srv://${process.env.DB_USERNAME}:${process.env.DB_PASSWORD}@cluster0.zuity7f.mongodb.net/?appName=Cluster0`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    await client.connect();
    const db = client.db("public-infra-report-server");
    const issuesCollection = db.collection("all-issues");
    const userCollection = db.collection("users");

    console.log("Connected to MongoDB successfully!");

    // ========== TEST ENDPOINTS ==========

    // Test endpoint
    app.get("/test", (req, res) => {
      res.send({
        success: true,
        message: "Server is running",
        timestamp: new Date().toISOString(),
      });
    });

    // Test MongoDB connection
    app.get("/test-mongo", async (req, res) => {
      try {
        const testDoc = {
          _id: "test_" + new Date().getTime(),
          title: "Test Issue",
          description: "Testing MongoDB connection",
          reportedBy: "Test User",
          userEmail: "test@example.com",
          status: "pending",
          reportedAt: new Date().toISOString(),
        };

        const result = await issuesCollection.insertOne(testDoc);

        res.send({
          success: true,
          message: "MongoDB connection successful",
          insertedId: result.insertedId,
        });
      } catch (error) {
        console.error("MongoDB test error:", error);
        res.status(500).send({
          success: false,
          message: "MongoDB connection failed",
          error: error.message,
        });
      }
    });

    // ========== USER MANAGEMENT ENDPOINTS ==========

    // Update user role endpoint
    app.post("/update-role", async (req, res) => {
      try {
        const { email, role } = req.body;

        console.log(`Updating ${email} role to: ${role}`);

        if (!email || !role) {
          return res.status(400).send({
            success: false,
            message: "Email and role are required",
          });
        }

        // Check if user exists
        const user = await userCollection.findOne({ email: email });
        if (!user) {
          return res.status(404).send({
            success: false,
            message: "User not found",
          });
        }

        // Update the user role
        const result = await userCollection.updateOne(
          { email: email },
          { 
            $set: { 
              role: role, 
              updatedAt: new Date().toISOString() 
            } 
          }
        );

        if (result.matchedCount === 0) {
          return res.status(404).send({
            success: false,
            message: "User not found",
          });
        }

        res.send({
          success: true,
          message: `Role updated to ${role} for ${email}`,
          modifiedCount: result.modifiedCount,
        });
      } catch (error) {
        console.error("Error updating role:", error);
        res.status(500).send({
          success: false,
          message: "Failed to update role",
        });
      }
    });

    // Endpoint to check user role
    app.get("/check-role/:email", async (req, res) => {
      try {
        const { email } = req.params;

        const user = await userCollection.findOne({ email: email });

        if (!user) {
          return res.status(404).send({
            success: false,
            message: "User not found",
          });
        }

        res.send({
          success: true,
          email: user.email,
          role: user.role || "user",
          displayName: user.displayName,
          createdAt: user.createdAt,
        });
      } catch (error) {
        console.error("Error checking role:", error);
        res.status(500).send({
          success: false,
          message: "Failed to check role",
        });
      }
    });

    // ========== USER ENDPOINTS ==========

    // Create new user (signup)
    app.post("/users", async (req, res) => {
      try {
        const user = req.body;
        console.log("Creating new user:", user.email);

        if (!user.email) {
          return res.status(400).send({
            success: false,
            message: "Email is required",
          });
        }

        // Check if user already exists
        const existingUser = await userCollection.findOne({
          email: user.email,
        });
        if (existingUser) {
          return res.send({
            success: true,
            message: "User already exists",
            user: existingUser,
          });
        }

        // Add default values
        user.role = user.role || "user";
        user.createdAt = new Date().toISOString();
        user.updatedAt = new Date().toISOString();

        const result = await userCollection.insertOne(user);

        res.send({
          success: true,
          message: "User created successfully",
          insertedId: result.insertedId,
          user: user,
        });
      } catch (error) {
        console.error("Error creating user:", error);
        res.status(500).send({
          success: false,
          message: "Failed to create user",
          error: error.message,
        });
      }
    });

    // User validation endpoint
    app.post("/validate-user", async (req, res) => {
      try {
        const { email, uid } = req.body;

        console.log(`🔍 Validating user: ${email}, UID: ${uid}`);

        if (!email) {
          return res.status(400).send({
            success: false,
            message: "Email is required",
          });
        }

        const user = await userCollection.findOne({ email: email });

        if (!user) {
          return res.status(404).send({
            success: false,
            message: "User not found",
            valid: false,
          });
        }

        // Check if UID matches (optional security check)
        if (uid && user.uid && user.uid !== uid) {
          console.log(`⚠️ UID mismatch for ${email}`);
          return res.send({
            success: true,
            valid: false,
            message: "User session invalid",
          });
        }

        res.send({
          success: true,
          valid: true,
          user: {
            email: user.email,
            role: user.role || "user",
            displayName: user.displayName,
          },
        });
      } catch (error) {
        console.error("Error validating user:", error);
        res.status(500).send({
          success: false,
          message: "Failed to validate user",
        });
      }
    });

    // Get user by email
    app.get("/users/:email", async (req, res) => {
      try {
        const { email } = req.params;

        const user = await userCollection.findOne({ email: email });

        if (!user) {
          return res.status(404).send({
            success: false,
            message: "User not found",
          });
        }

        res.send({
          success: true,
          user: user,
        });
      } catch (error) {
        console.error("Error fetching user:", error);
        res.status(500).send({
          success: false,
          message: "Failed to fetch user",
        });
      }
    });

    // Get all users (admin only)
    app.get("/users", async (req, res) => {
      try {
        const cursor = userCollection.find();
        const users = await cursor.toArray();

        res.send({
          success: true,
          count: users.length,
          users: users,
        });
      } catch (error) {
        console.error("Error fetching users:", error);
        res.status(500).send({
          success: false,
          message: "Failed to fetch users",
        });
      }
    });

    // Update user by email
    app.patch("/users/:email", async (req, res) => {
      try {
        const { email } = req.params;
        const updates = req.body;

        updates.updatedAt = new Date().toISOString();

        const result = await userCollection.updateOne(
          { email: email },
          { $set: updates }
        );

        if (result.modifiedCount === 0) {
          return res.status(404).send({
            success: false,
            message: "User not found or no changes made",
          });
        }

        res.send({
          success: true,
          message: "User updated successfully",
        });
      } catch (error) {
        console.error("Error updating user:", error);
        res.status(500).send({
          success: false,
          message: "Failed to update user",
        });
      }
    });

    // ========== ISSUE ENDPOINTS ==========

    // Get all issues
    app.get("/issues", async (req, res) => {
      try {
        const cursor = issuesCollection.find();
        const result = await cursor.toArray();

        res.send({
          success: true,
          count: result.length,
          issues: result,
        });
      } catch (error) {
        console.error("Error fetching issues:", error);
        res.status(500).send({
          success: false,
          message: "Failed to fetch issues",
        });
      }
    });

    // Get my issues by user email
    app.get("/my-issues", async (req, res) => {
      try {
        const userEmail = req.query.email;

        if (!userEmail) {
          return res.status(400).send({
            success: false,
            message: "Email query parameter is required",
          });
        }

        const query = {
          $or: [{ userEmail: userEmail }, { reportedBy: userEmail }],
        };

        const result = await issuesCollection.find(query).toArray();

        res.send({
          success: true,
          count: result.length,
          issues: result,
        });
      } catch (error) {
        console.error("Error fetching my-issues:", error);
        res.status(500).send({
          success: false,
          message: "Failed to fetch my issues",
        });
      }
    });

    // Submit new issue
    app.post("/issues", async (req, res) => {
      try {
        const issueData = req.body;

        const requiredFields = ["title", "description", "category", "location"];
        const missingFields = requiredFields.filter(
          (field) => !issueData[field]
        );

        if (missingFields.length > 0) {
          return res.status(400).send({
            success: false,
            message: `Missing required fields: ${missingFields.join(", ")}`,
          });
        }

        if (!issueData._id) {
          issueData._id = new ObjectId().toString();
        }

        const currentTime = new Date().toISOString();

        const completeIssueData = {
          _id: issueData._id,
          title: issueData.title,
          description: issueData.description,
          category: issueData.category,
          location: issueData.location,
          reportedBy: issueData.reportedBy || issueData.reporterName || "User",
          userEmail: issueData.userEmail || issueData.email || "",
          status: issueData.status || "pending",
          priority: issueData.priority || "normal",
          image:
            issueData.image ||
            (issueData.images && issueData.images[0]) ||
            null,
          images: issueData.images || [],
          upvotes: 0,
          upvotedBy: [],
          reportedAt: currentTime,
          progress: 0,
          assignedTo: null,
          latitude: issueData.latitude || null,
          longitude: issueData.longitude || null,
          comments: [],
          timeline: [
            {
              status: "pending",
              message: "Issue reported by citizen",
              updatedBy:
                issueData.reportedBy || issueData.reporterName || "User",
              updatedAt: currentTime,
            },
          ],
        };

        const result = await issuesCollection.insertOne(completeIssueData);

        res.send({
          success: true,
          message: "Issue submitted successfully",
          insertedId: result.insertedId,
          data: completeIssueData,
        });
      } catch (error) {
        console.error("Error submitting issue:", error);
        res.status(500).send({
          success: false,
          message: "Failed to submit issue to MongoDB",
          error: error.message,
        });
      }
    });

    // GET single issue by ID
    app.get("/issues/:id", async (req, res) => {
      try {
        const { id } = req.params;

        const issue = await issuesCollection.findOne({ _id: id });

        if (!issue) {
          return res.status(404).send({
            success: false,
            message: "Issue not found",
            data: null,
          });
        }

        res.send({
          success: true,
          data: issue,
        });
      } catch (error) {
        console.error("Error:", error);
        res.status(500).send({
          success: false,
          message: "Server error",
          data: null,
        });
      }
    });

    // DELETE issue by ID
    app.delete("/issues/:id", async (req, res) => {
      try {
        const { id } = req.params;

        const result = await issuesCollection.deleteOne({ _id: id });

        if (result.deletedCount === 0) {
          return res.status(404).send({
            success: false,
            message: "Issue not found",
          });
        }

        res.send({
          success: true,
          message: "Issue deleted successfully",
        });
      } catch (error) {
        console.error("Error deleting issue:", error);
        res.status(500).send({
          success: false,
          message: "Failed to delete issue",
        });
      }
    });

    // UPDATE issue by ID
    app.patch("/issues/:id", async (req, res) => {
      try {
        const { id } = req.params;
        const updates = req.body;

        updates.updatedAt = new Date().toISOString();

        const result = await issuesCollection.updateOne(
          { _id: id },
          { $set: updates }
        );

        if (result.modifiedCount === 0) {
          return res.status(404).send({
            success: false,
            message: "Issue not found or no changes made",
          });
        }

        res.send({
          success: true,
          message: "Issue updated successfully",
        });
      } catch (error) {
        console.error("Error updating issue:", error);
        res.status(500).send({
          success: false,
          message: "Failed to update issue",
        });
      }
    });

    // UPVOTE endpoint - toggle upvote
    app.post("/issues/:id/upvote", async (req, res) => {
      try {
        const { id } = req.params;
        const { userId } = req.body;

        if (!userId) {
          return res.status(400).send({
            success: false,
            message: "User ID is required",
          });
        }

        const issue = await issuesCollection.findOne({ _id: id });

        if (!issue) {
          return res.status(404).send({
            success: false,
            message: "Issue not found",
          });
        }

        const currentUpvotedBy = issue.upvotedBy || [];

        let updatedIssue;
        let hasUpvoted;

        if (currentUpvotedBy.includes(userId)) {
          updatedIssue = await issuesCollection.findOneAndUpdate(
            { _id: id },
            {
              $inc: { upvotes: -1 },
              $pull: { upvotedBy: userId },
            },
            { returnDocument: "after" }
          );
          hasUpvoted = false;
        } else {
          updatedIssue = await issuesCollection.findOneAndUpdate(
            { _id: id },
            {
              $inc: { upvotes: 1 },
              $push: { upvotedBy: userId },
            },
            { returnDocument: "after" }
          );
          hasUpvoted = true;
        }

        res.send({
          success: true,
          upvotes: updatedIssue.upvotes,
          hasUpvoted: hasUpvoted,
        });
      } catch (error) {
        console.error("Upvote error:", error);
        res.status(500).send({
          success: false,
          message: "Server error",
        });
      }
    });

    // Search issues by user email
    app.get("/issues/user/:email", async (req, res) => {
      try {
        const { email } = req.params;

        const query = {
          $or: [{ userEmail: email }, { reportedBy: email }],
        };

        const cursor = issuesCollection.find(query);
        const result = await cursor.toArray();

        res.send({
          success: true,
          count: result.length,
          issues: result,
        });
      } catch (error) {
        console.error("Error searching user issues:", error);
        res.status(500).send({
          success: false,
          message: "Failed to search user issues",
        });
      }
    });

    // Get issue statistics
    app.get("/issues-stats", async (req, res) => {
      try {
        const totalIssues = await issuesCollection.countDocuments();
        const pendingIssues = await issuesCollection.countDocuments({
          status: "pending",
        });
        const inProgressIssues = await issuesCollection.countDocuments({
          status: "in progress",
        });
        const resolvedIssues = await issuesCollection.countDocuments({
          status: "resolved",
        });

        res.send({
          success: true,
          stats: {
            total: totalIssues,
            pending: pendingIssues,
            inProgress: inProgressIssues,
            resolved: resolvedIssues,
          },
        });
      } catch (error) {
        console.error("Error fetching stats:", error);
        res.status(500).send({
          success: false,
          message: "Failed to fetch statistics",
        });
      }
    });

    await client.db("admin").command({ ping: 1 });
    console.log("✅ Pinged MongoDB deployment. Connection successful!");
  } catch (error) {
    console.error("Failed to connect to MongoDB:", error);
  }
}

run().catch(console.dir);

app.get("/", (req, res) => {
  res.send({
    message: "Public Infrastructure Report Server is running 🚀",
    endpoints: {
      test: "GET /test",
      users: "POST /users, GET /users, GET /users/:email",
      issues:
        "GET /issues, POST /issues, GET /issues/:id, DELETE /issues/:id, PATCH /issues/:id",
      myIssues: "GET /my-issues?email=user@example.com",
      upvote: "POST /issues/:id/upvote",
      stats: "GET /issues-stats",
      updateRole: "POST /update-role",
      checkRole: "GET /check-role/:email",
    },
  });
});

app.listen(port, () => {
  console.log(`🚀 Server is running on http://localhost:${port}`);
});