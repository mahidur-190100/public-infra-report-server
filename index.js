const express = require("express");
const cors = require("cors");
const app = express();
const port = 3000;
app.use(cors());
app.use(express.json());
require("dotenv").config();

const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const uri = `mongodb+srv://${process.env.DB_USERNAME}:${process.env.DB_PASSWORD}@cluster0.zuity7f.mongodb.net/?appName=Cluster0`;

const stripe = require("stripe")(process.env.STRIPE_SECRET);

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
    const paymentsCollection = db.collection("payments"); // New collection for payments

    console.log("Connected to MongoDB successfully!");

    // ========== USER AUTHENTICATION & DASHBOARD ROUTING ==========

    // Get user dashboard info based on role
    app.get("/user-dashboard-info/:email", async (req, res) => {
      try {
        const { email } = req.params;

        const user = await userCollection.findOne({ email: email });

        if (!user) {
          return res.status(404).send({
            success: false,
            message: "User not found",
          });
        }

        // Determine dashboard type based on role
        let dashboardType = "user"; // Default
        let redirectPath = "/dashboard";

        if (user.role === "admin") {
          dashboardType = "admin";
          redirectPath = "/dashboard/admin";
        } else if (user.role === "staff") {
          dashboardType = "staff";
          redirectPath = "/dashboard/staff";
        }

        res.send({
          success: true,
          user: {
            email: user.email,
            role: user.role || "user",
            displayName: user.displayName,
            isPremium: user.isPremium || false,
            createdAt: user.createdAt,
          },
          dashboard: {
            type: dashboardType,
            redirectPath: redirectPath,
            shouldRedirect: dashboardType !== "user",
          },
        });
      } catch (error) {
        console.error("Error fetching user dashboard info:", error);
        res.status(500).send({
          success: false,
          message: "Failed to fetch user dashboard info",
        });
      }
    });

    // Validate user and return proper dashboard info
    // In your server.js, update the /validate-user endpoint (around line 135):
    app.post("/validate-user", async (req, res) => {
      try {
        const { email, uid } = req.body;

        // console.log(` Validating user: ${email}, UID: ${uid}`);

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

        if (uid && user.uid && user.uid !== uid) {
          // console.log(` UID mismatch for ${email}`);
          return res.send({
            success: true,
            valid: false,
            message: "User session invalid",
          });
        }

        // Determine dashboard type based on role
        let dashboardType = "user";
        let redirectPath = "/dashboard";

        if (user.role === "admin") {
          dashboardType = "admin";
          redirectPath = "/dashboard/admin";
        } else if (user.role === "staff") {
          dashboardType = "staff";
          redirectPath = "/dashboard/staff";
        }

        res.send({
          success: true,
          valid: true,
          user: {
            email: user.email,
            role: user.role || "user",
            displayName: user.displayName,
            isPremium: user.isPremium || false,
            name: user.name || user.displayName,
            id: user._id || email,
            createdAt: user.createdAt,
            // Return the actual user ID for checking ownership
            userId: user._id?.toString() || email,
          },
          dashboard: {
            type: dashboardType,
            redirectPath: redirectPath,
            shouldRedirect: dashboardType !== "user",
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

    // Get user's assigned issues (for staff dashboard)
    app.get("/staff/issues", async (req, res) => {
      try {
        const { staffEmail, staffId } = req.query;

        if (!staffEmail && !staffId) {
          return res.status(400).send({
            success: false,
            message: "Staff email or ID is required",
          });
        }

        // Build query to find issues assigned to this staff
        let query = {};

        if (staffId) {
          // If staffId is provided (could be email or actual ID)
          query = {
            $or: [
              { assignedTo: staffId },
              { "assignedTo.id": staffId },
              { "assignedTo.email": staffEmail },
            ],
          };
        } else if (staffEmail) {
          query = {
            $or: [
              { assignedTo: staffEmail },
              { "assignedTo.email": staffEmail },
            ],
          };
        }

        const cursor = issuesCollection.find(query);
        const issues = await cursor.toArray();

        res.send({
          success: true,
          count: issues.length,
          issues: issues,
        });
      } catch (error) {
        console.error("Error fetching staff issues:", error);
        res.status(500).send({
          success: false,
          message: "Failed to fetch staff issues",
        });
      }
    });

    // Get staff dashboard statistics
    app.get("/staff/dashboard-stats", async (req, res) => {
      try {
        const { staffEmail, staffId } = req.query;

        if (!staffEmail && !staffId) {
          return res.status(400).send({
            success: false,
            message: "Staff email or ID is required",
          });
        }

        // Build query to find issues assigned to this staff
        let query = {};

        if (staffId) {
          query = {
            $or: [
              { assignedTo: staffId },
              { "assignedTo.id": staffId },
              { "assignedTo.email": staffEmail },
            ],
          };
        } else if (staffEmail) {
          query = {
            $or: [
              { assignedTo: staffEmail },
              { "assignedTo.email": staffEmail },
            ],
          };
        }

        const allIssues = await issuesCollection.find(query).toArray();
        const totalIssues = allIssues.length;

        // Calculate stats
        const pendingIssues = allIssues.filter(
          (issue) => issue.status && issue.status.toLowerCase() === "pending"
        ).length;

        const resolvedIssues = allIssues.filter(
          (issue) => issue.status && issue.status.toLowerCase() === "resolved"
        ).length;

        const inProgressIssues = allIssues.filter(
          (issue) =>
            issue.status &&
            (issue.status.toLowerCase() === "in-progress" ||
              issue.status.toLowerCase() === "in progress")
        ).length;

        // Today's tasks (issues created today or due today)
        const today = new Date().toISOString().split("T")[0];
        const todaysTasks = allIssues.filter((issue) => {
          const createdDate = new Date(issue.createdAt || issue.reportedAt)
            .toISOString()
            .split("T")[0];
          const dueDate = issue.dueDate
            ? new Date(issue.dueDate).toISOString().split("T")[0]
            : null;
          return createdDate === today || dueDate === today;
        }).length;

        // Weekly resolved (last 7 days)
        const oneWeekAgo = new Date();
        oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
        const weeklyResolved = allIssues.filter((issue) => {
          if (issue.status && issue.status.toLowerCase() === "resolved") {
            const resolvedDate = issue.resolvedAt
              ? new Date(issue.resolvedAt)
              : new Date(issue.updatedAt);
            return resolvedDate >= oneWeekAgo;
          }
          return false;
        }).length;

        // Calculate average resolution time
        let totalResolutionTime = 0;
        let resolvedCount = 0;

        allIssues.forEach((issue) => {
          if (
            issue.status &&
            issue.status.toLowerCase() === "resolved" &&
            (issue.createdAt || issue.reportedAt) &&
            issue.resolvedAt
          ) {
            const created = new Date(issue.createdAt || issue.reportedAt);
            const resolved = new Date(issue.resolvedAt);
            const diffTime = Math.abs(resolved - created);
            const diffDays = diffTime / (1000 * 60 * 60 * 24);
            totalResolutionTime += diffDays;
            resolvedCount++;
          }
        });

        const averageResolutionTime =
          resolvedCount > 0
            ? (totalResolutionTime / resolvedCount).toFixed(1)
            : 0;

        res.send({
          success: true,
          stats: {
            assignedIssues: totalIssues,
            pendingIssues: pendingIssues,
            resolvedIssues: resolvedIssues,
            inProgressIssues: inProgressIssues,
            todaysTasks: todaysTasks,
            weeklyResolved: weeklyResolved,
            averageResolutionTime: averageResolutionTime,
          },
        });
      } catch (error) {
        console.error("Error fetching staff dashboard stats:", error);
        res.status(500).send({
          success: false,
          message: "Failed to fetch staff dashboard statistics",
        });
      }
    });

    // Get limited resolved issues for home page
    app.get("/resolved-issues/limit", async (req, res) => {
      try {
        const limit = parseInt(req.query.limit) || 6;

        const cursor = issuesCollection
          .find({
            status: { $regex: /^resolved$/i },
          })
          .sort({ resolvedAt: -1, reportedAt: -1 })
          .limit(limit);

        const resolvedIssues = await cursor.toArray();

        res.send({
          success: true,
          count: resolvedIssues.length,
          issues: resolvedIssues,
        });
      } catch (error) {
        console.error("Error fetching resolved issues:", error);
        res.status(500).send({
          success: false,
          message: "Failed to fetch resolved issues",
        });
      }
    });

    // ========== PAYMENT MANAGEMENT ENDPOINTS ==========

    // Create a new payment record
    app.post("/create-payment", async (req, res) => {
      try {
        const paymentData = req.body;

        // console.log(" Creating payment record for:", paymentData.userEmail);

        // Validate required fields
        if (
          !paymentData.userEmail ||
          !paymentData.amount ||
          !paymentData.planType
        ) {
          return res.status(400).send({
            success: false,
            message: "User email, amount, and plan type are required",
          });
        }

        // Generate unique IDs
        const paymentId = new ObjectId().toString();
        const invoiceNumber = `INV-${new Date().getFullYear()}-${Math.floor(
          1000 + Math.random() * 9000
        )}`;
        const transactionId = `TXN${Date.now()}${paymentData.userEmail
          .substring(0, 4)
          .toUpperCase()}`;

        // Calculate subscription dates
        const startDate = new Date();
        const endDate = new Date();

        if (paymentData.planType === "yearly") {
          endDate.setFullYear(endDate.getFullYear() + 1);
        } else {
          endDate.setMonth(endDate.getMonth() + 1);
        }

        // Create complete payment document
        const completePaymentData = {
          _id: paymentId,
          userId: paymentData.userId || paymentData.userEmail,
          userName: paymentData.userName || paymentData.userEmail.split("@")[0],
          userEmail: paymentData.userEmail,
          userPhone: paymentData.userPhone || "",
          userRole: paymentData.userRole || "user",
          plan:
            paymentData.planType === "yearly"
              ? "Yearly Premium"
              : "Monthly Premium",
          amount:
            parseInt(paymentData.amount) ||
            (paymentData.planType === "yearly" ? 4999 : 499),
          currency: "INR",
          status: "completed",
          paymentMethod: paymentData.paymentMethod || "Card",
          cardLastFour: paymentData.cardLastFour || null,
          transactionId: transactionId,
          invoiceNumber: invoiceNumber,
          paymentDate: new Date().toISOString(),
          subscriptionStart: startDate.toISOString(),
          subscriptionEnd: endDate.toISOString(),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          metadata: paymentData.metadata || {},
        };

        // Save to payments collection
        const paymentResult = await paymentsCollection.insertOne(
          completePaymentData
        );

        // Update user record with premium status
        await userCollection.updateOne(
          { email: paymentData.userEmail },
          {
            $set: {
              isPremium: true,
              subscriptionType: paymentData.planType,
              subscriptionStart: startDate.toISOString(),
              subscriptionEnd: endDate.toISOString(),
              lastPayment: new Date().toISOString(),
              paymentMethod: paymentData.paymentMethod || "Card",
              updatedAt: new Date().toISOString(),
            },
          }
        );

        // console.log(
        //   ` Payment recorded successfully for ${paymentData.userEmail}`
        // );
        // console.log(`Amount: ₹${completePaymentData.amount}`);
        // console.log(` Invoice: ${invoiceNumber}`);

        res.send({
          success: true,
          message: "Payment recorded successfully",
          paymentId: paymentResult.insertedId,
          invoiceNumber: invoiceNumber,
          transactionId: transactionId,
          payment: completePaymentData,
        });
      } catch (error) {
        console.error(" Error creating payment:", error);
        res.status(500).send({
          success: false,
          message: "Failed to record payment",
          error: error.message,
        });
      }
    });

    // Get all payments (for admin)
    app.get("/payments", async (req, res) => {
      try {
        const cursor = paymentsCollection.find().sort({ paymentDate: -1 });
        const payments = await cursor.toArray();

        res.send({
          success: true,
          count: payments.length,
          payments: payments,
        });
      } catch (error) {
        console.error("Error fetching payments:", error);
        res.status(500).send({
          success: false,
          message: "Failed to fetch payments",
        });
      }
    });

    // Get payments by user email
    app.get("/payments/user/:email", async (req, res) => {
      try {
        const { email } = req.params;

        const cursor = paymentsCollection
          .find({ userEmail: email })
          .sort({ paymentDate: -1 });
        const payments = await cursor.toArray();

        res.send({
          success: true,
          count: payments.length,
          payments: payments,
        });
      } catch (error) {
        console.error("Error fetching user payments:", error);
        res.status(500).send({
          success: false,
          message: "Failed to fetch user payments",
        });
      }
    });

    // Get payment statistics
    app.get("/payments/stats", async (req, res) => {
      try {
        const totalPayments = await paymentsCollection.countDocuments();
        const completedPayments = await paymentsCollection.countDocuments({
          status: "completed",
        });

        // Calculate total revenue
        const cursor = paymentsCollection.find({ status: "completed" });
        const allPayments = await cursor.toArray();
        const totalRevenue = allPayments.reduce(
          (sum, payment) => sum + (payment.amount || 0),
          0
        );

        // Get today's payments
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);

        const todayPayments = await paymentsCollection.countDocuments({
          paymentDate: {
            $gte: today.toISOString(),
            $lt: tomorrow.toISOString(),
          },
        });

        res.send({
          success: true,
          stats: {
            total: totalPayments,
            completed: completedPayments,
            totalRevenue: totalRevenue,
            today: todayPayments,
          },
        });
      } catch (error) {
        console.error("Error fetching payment stats:", error);
        res.status(500).send({
          success: false,
          message: "Failed to fetch payment statistics",
        });
      }
    });

    // ========== USER MANAGEMENT ENDPOINTS ==========

    app.post("/update-role", async (req, res) => {
      try {
        const { email, role } = req.body;

        // console.log(`Updating ${email} role to: ${role}`);

        if (!email || !role) {
          return res.status(400).send({
            success: false,
            message: "Email and role are required",
          });
        }

        const user = await userCollection.findOne({ email: email });
        if (!user) {
          return res.status(404).send({
            success: false,
            message: "User not found",
          });
        }

        const result = await userCollection.updateOne(
          { email: email },
          {
            $set: {
              role: role,
              updatedAt: new Date().toISOString(),
            },
          }
        );

        if (result.matchedCount === 0) {
          return res.status(404).send({
            success: false,
            message: "User not found",
          });
        }

        // Get updated user info
        const updatedUser = await userCollection.findOne({ email: email });

        res.send({
          success: true,
          message: `Role updated to ${role} for ${email}`,
          modifiedCount: result.modifiedCount,
          user: {
            email: updatedUser.email,
            role: updatedUser.role,
            displayName: updatedUser.displayName,
            dashboardType:
              role === "staff" ? "staff" : role === "admin" ? "admin" : "user",
          },
        });
      } catch (error) {
        console.error("Error updating role:", error);
        res.status(500).send({
          success: false,
          message: "Failed to update role",
        });
      }
    });

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
          dashboardType:
            user.role === "staff"
              ? "staff"
              : user.role === "admin"
              ? "admin"
              : "user",
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

    app.post("/users", async (req, res) => {
      try {
        const user = req.body;
        // console.log("Creating new user:", user.email);

        if (!user.email) {
          return res.status(400).send({
            success: false,
            message: "Email is required",
          });
        }

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

        user.role = user.role || "user";
        user.isPremium = false;
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

    // Get all pending issues (for admin to reject)
    app.get("/issues/pending", async (req, res) => {
      try {
        // Get issues that are pending (not in progress, not resolved, not rejected)
        const query = {
          status: {
            $regex: /^pending$/i,
          },
        };

        const cursor = issuesCollection.find(query).sort({ reportedAt: -1 });
        const issues = await cursor.toArray();

        res.send({
          success: true,
          count: issues.length,
          issues: issues,
        });
      } catch (error) {
        console.error("Error fetching pending issues:", error);
        res.status(500).send({
          success: false,
          message: "Failed to fetch pending issues",
        });
      }
    });

    // Get rejected issues
    app.get("/issues/rejected", async (req, res) => {
      try {
        const query = {
          status: {
            $regex: /^rejected$/i,
          },
        };

        const cursor = issuesCollection.find(query).sort({ rejectedAt: -1 });
        const issues = await cursor.toArray();

        res.send({
          success: true,
          count: issues.length,
          issues: issues,
        });
      } catch (error) {
        console.error("Error fetching rejected issues:", error);
        res.status(500).send({
          success: false,
          message: "Failed to fetch rejected issues",
        });
      }
    });

    // Reject an issue (admin only)
    app.post("/issues/:id/reject", async (req, res) => {
      try {
        const { id } = req.params;
        const { userId, rejectionReason } = req.body;

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

        // Get user info to check if admin
        let user = null;
        if (userId.includes("@")) {
          user = await userCollection.findOne({ email: userId });
        } else {
          try {
            user = await userCollection.findOne({ _id: new ObjectId(userId) });
          } catch (error) {
            user = await userCollection.findOne({ email: userId });
          }
        }

        if (!user) {
          return res.status(404).send({
            success: false,
            message: "User not found",
          });
        }

        const userRole = user.role || "user";
        const userName = user.displayName || user.name || "Admin";

        // Only admin can reject issues
        if (userRole !== "admin") {
          return res.status(403).send({
            success: false,
            message: "Only administrators can reject issues",
          });
        }

        // Check if issue is already rejected
        if (issue.status && issue.status.toLowerCase() === "rejected") {
          return res.status(400).send({
            success: false,
            message: "Issue is already rejected",
          });
        }

        // Check if issue is already in progress or resolved
        if (
          issue.status &&
          (issue.status.toLowerCase() === "in progress" ||
            issue.status.toLowerCase() === "in-progress" ||
            issue.status.toLowerCase() === "resolved")
        ) {
          return res.status(400).send({
            success: false,
            message: `Cannot reject issue with status: ${issue.status}`,
          });
        }

        const currentTime = new Date().toISOString();
        const reason = rejectionReason || "Issue rejected by administrator";

        // Update issue status to rejected
        const result = await issuesCollection.updateOne(
          { _id: id },
          {
            $set: {
              status: "rejected",
              rejectionReason: reason,
              rejectedAt: currentTime,
              rejectedBy: userName,
              updatedAt: currentTime,
            },
            $push: {
              timeline: {
                status: "rejected",
                message: reason,
                updatedBy: userName,
                updatedAt: currentTime,
              },
            },
          }
        );

        if (result.modifiedCount === 0) {
          return res.status(404).send({
            success: false,
            message: "Issue not found or no changes made",
          });
        }

        // Get updated issue
        const updatedIssue = await issuesCollection.findOne({ _id: id });

        res.send({
          success: true,
          message: "Issue rejected successfully",
          issue: updatedIssue,
          userRole: userRole,
          timestamp: currentTime,
        });
      } catch (error) {
        console.error("Error rejecting issue:", error);
        res.status(500).send({
          success: false,
          message: "Failed to reject issue",
        });
      }
    });

    // Undo rejection (admin only)
    app.post("/issues/:id/undo-reject", async (req, res) => {
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

        // Get user info to check if admin
        let user = null;
        if (userId.includes("@")) {
          user = await userCollection.findOne({ email: userId });
        } else {
          try {
            user = await userCollection.findOne({ _id: new ObjectId(userId) });
          } catch (error) {
            user = await userCollection.findOne({ email: userId });
          }
        }

        if (!user) {
          return res.status(404).send({
            success: false,
            message: "User not found",
          });
        }

        const userRole = user.role || "user";
        const userName = user.displayName || user.name || "Admin";

        // Only admin can undo rejection
        if (userRole !== "admin") {
          return res.status(403).send({
            success: false,
            message: "Only administrators can undo rejection",
          });
        }

        // Check if issue is actually rejected
        if (!issue.status || issue.status.toLowerCase() !== "rejected") {
          return res.status(400).send({
            success: false,
            message: "Issue is not rejected",
          });
        }

        const currentTime = new Date().toISOString();

        // Update issue status back to pending
        const result = await issuesCollection.updateOne(
          { _id: id },
          {
            $set: {
              status: "pending",
              updatedAt: currentTime,
            },
            $unset: {
              rejectionReason: "",
              rejectedAt: "",
              rejectedBy: "",
            },
            $push: {
              timeline: {
                status: "pending",
                message: "Rejection undone by administrator",
                updatedBy: userName,
                updatedAt: currentTime,
              },
            },
          }
        );

        if (result.modifiedCount === 0) {
          return res.status(404).send({
            success: false,
            message: "Issue not found or no changes made",
          });
        }

        // Get updated issue
        const updatedIssue = await issuesCollection.findOne({ _id: id });

        res.send({
          success: true,
          message: "Rejection undone successfully",
          issue: updatedIssue,
          userRole: userRole,
        });
      } catch (error) {
        console.error("Error undoing rejection:", error);
        res.status(500).send({
          success: false,
          message: "Failed to undo rejection",
        });
      }
    });

    // Get all staff members
    app.get("/staff", async (req, res) => {
      try {
        const cursor = userCollection.find({ role: "staff" });
        const staffMembers = await cursor.toArray();

        res.send({
          success: true,
          count: staffMembers.length,
          staff: staffMembers,
        });
      } catch (error) {
        console.error("Error fetching staff:", error);
        res.status(500).send({
          success: false,
          message: "Failed to fetch staff",
        });
      }
    });

    // ========== ISSUE ENDPOINTS ==========

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

    // Assign issue to staff
    app.post("/issues/:id/assign", async (req, res) => {
      try {
        const { id } = req.params;
        const { staffId, staffName, staffEmail } = req.body;

        if (!staffId || !staffEmail) {
          return res.status(400).send({
            success: false,
            message: "Staff ID and email are required",
          });
        }

        const issue = await issuesCollection.findOne({ _id: id });

        if (!issue) {
          return res.status(404).send({
            success: false,
            message: "Issue not found",
          });
        }

        const currentTime = new Date().toISOString();

        const updateResult = await issuesCollection.updateOne(
          { _id: id },
          {
            $set: {
              assignedTo: {
                id: staffId,
                name: staffName,
                email: staffEmail,
              },
              status: "assigned",
              updatedAt: currentTime,
            },
            $push: {
              timeline: {
                status: "assigned",
                message: `Issue assigned to staff: ${staffName} (${staffEmail})`,
                updatedBy: "Admin",
                updatedAt: currentTime,
              },
            },
          }
        );

        if (updateResult.modifiedCount === 0) {
          return res.status(404).send({
            success: false,
            message: "Issue not found or no changes made",
          });
        }

        res.send({
          success: true,
          message: `Issue assigned to ${staffName}`,
        });
      } catch (error) {
        console.error("Error assigning issue:", error);
        res.status(500).send({
          success: false,
          message: "Failed to assign issue",
        });
      }
    });

    // Update issue status (for staff)
    app.post("/issues/:id/update-status", async (req, res) => {
      try {
        const { id } = req.params;
        const { status, message, updatedBy, updatedByEmail } = req.body;

        if (!status) {
          return res.status(400).send({
            success: false,
            message: "Status is required",
          });
        }

        const issue = await issuesCollection.findOne({ _id: id });

        if (!issue) {
          return res.status(404).send({
            success: false,
            message: "Issue not found",
          });
        }

        const currentTime = new Date().toISOString();
        const statusMessage = message || `Status changed to ${status}`;
        const updatedByName = updatedBy || "Staff";

        const updates = {
          status: status,
          updatedAt: currentTime,
        };

        // If resolved, add resolved timestamp
        if (status.toLowerCase() === "resolved") {
          updates.resolvedAt = currentTime;
          updates.progress = 100;
        }

        const updateResult = await issuesCollection.updateOne(
          { _id: id },
          {
            $set: updates,
            $push: {
              timeline: {
                status: status,
                message: statusMessage,
                updatedBy: updatedByName,
                updatedAt: currentTime,
              },
            },
          }
        );

        if (updateResult.modifiedCount === 0) {
          return res.status(404).send({
            success: false,
            message: "Issue not found or no changes made",
          });
        }

        res.send({
          success: true,
          message: `Issue status updated to ${status}`,
        });
      } catch (error) {
        console.error("Error updating issue status:", error);
        res.status(500).send({
          success: false,
          message: "Failed to update issue status",
        });
      }
    });

    // Update the upvote endpoint (around line 740-800)
    app.post("/issues/:id/upvote", async (req, res) => {
      try {
        const { id } = req.params;
        const { userId, userEmail, userRole } = req.body;

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

        // Get user info to check restrictions
        let user = null;
        if (userEmail) {
          user = await userCollection.findOne({ email: userEmail });
        } else if (userId.includes("@")) {
          // userId might be email
          user = await userCollection.findOne({ email: userId });
        } else {
          user = await userCollection.findOne({ _id: new ObjectId(userId) });
        }

        // Check if user exists
        if (!user) {
          return res.status(404).send({
            success: false,
            message: "User not found",
          });
        }

        const userRoleFromDB = user.role || "user";
        const userEmailFromDB = user.email;

        // RULE 1: Admin and Staff cannot upvote
        if (userRoleFromDB === "admin" || userRoleFromDB === "staff") {
          return res.status(403).send({
            success: false,
            message: "Admin and staff members cannot upvote issues",
            canUpvote: false,
            reason: "role_restriction",
          });
        }

        // RULE 2: User cannot upvote their own issue
        // Check by email (most reliable)
        if (
          issue.userEmail &&
          userEmailFromDB &&
          issue.userEmail.toLowerCase() === userEmailFromDB.toLowerCase()
        ) {
          return res.status(403).send({
            success: false,
            message: "You cannot upvote your own issue",
            canUpvote: false,
            reason: "own_issue",
          });
        }

        // Also check by reportedBy field
        if (
          issue.reportedBy &&
          user.displayName &&
          issue.reportedBy.toLowerCase() === user.displayName.toLowerCase()
        ) {
          return res.status(403).send({
            success: false,
            message: "You cannot upvote your own issue",
            canUpvote: false,
            reason: "own_issue",
          });
        }

        // If user has no email in profile, check by userId in issue
        if (issue.userId && issue.userId === user._id?.toString()) {
          return res.status(403).send({
            success: false,
            message: "You cannot upvote your own issue",
            canUpvote: false,
            reason: "own_issue",
          });
        }

        const currentUpvotedBy = issue.upvotedBy || [];

        let updatedIssue;
        let hasUpvoted;

        if (currentUpvotedBy.includes(userId)) {
          // Remove upvote
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
          // Add upvote
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
          canUpvote: true,
          userRole: userRoleFromDB,
          message: hasUpvoted ? "Upvoted successfully" : "Upvote removed",
        });
      } catch (error) {
        console.error("Upvote error:", error);
        res.status(500).send({
          success: false,
          message: "Server error",
        });
      }
    });

    // Also add a helper endpoint to check if user can upvote
    app.post("/issues/:id/can-upvote", async (req, res) => {
      try {
        const { id } = req.params;
        const { userId, userEmail } = req.body;

        if (!userId || !userEmail) {
          return res.status(400).send({
            success: false,
            message: "User ID and email are required",
          });
        }

        const issue = await issuesCollection.findOne({ _id: id });

        if (!issue) {
          return res.status(404).send({
            success: false,
            message: "Issue not found",
          });
        }

        const user = await userCollection.findOne({ email: userEmail });

        if (!user) {
          return res.status(404).send({
            success: false,
            message: "User not found",
          });
        }

        const userRole = user.role || "user";

        // Check restrictions
        let canUpvote = true;
        let reason = "";
        let message = "You can upvote this issue";

        // Rule 1: Admin/Staff cannot upvote
        if (userRole === "admin" || userRole === "staff") {
          canUpvote = false;
          reason = "role_restriction";
          message = "Admin and staff cannot upvote issues";
        }
        // Rule 2: User cannot upvote their own issue
        else if (
          issue.userEmail &&
          issue.userEmail.toLowerCase() === userEmail.toLowerCase()
        ) {
          canUpvote = false;
          reason = "own_issue";
          message = "You cannot upvote your own issue";
        } else if (
          issue.reportedBy &&
          user.displayName &&
          issue.reportedBy.toLowerCase() === user.displayName.toLowerCase()
        ) {
          canUpvote = false;
          reason = "own_issue";
          message = "You cannot upvote your own issue";
        }

        // Check if already upvoted
        const hasUpvoted = issue.upvotedBy && issue.upvotedBy.includes(userId);

        res.send({
          success: true,
          canUpvote: canUpvote,
          reason: reason,
          message: message,
          hasUpvoted: hasUpvoted || false,
          userRole: userRole,
          issue: {
            reporterEmail: issue.userEmail,
            reporterName: issue.reportedBy,
          },
        });
      } catch (error) {
        console.error("Can-upvote check error:", error);
        res.status(500).send({
          success: false,
          message: "Server error",
        });
      }
    });

    // ========== EDIT & DELETE ENDPOINTS WITH RESTRICTIONS ==========

    // Check if user can edit/delete an issue
    app.post("/issues/:id/check-permissions", async (req, res) => {
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

        // Get user info
        let user = null;
        if (userId.includes("@")) {
          user = await userCollection.findOne({ email: userId });
        } else {
          try {
            user = await userCollection.findOne({ _id: new ObjectId(userId) });
          } catch (error) {
            user = await userCollection.findOne({ email: userId });
          }
        }

        if (!user) {
          return res.status(404).send({
            success: false,
            message: "User not found",
          });
        }

        const userRole = user.role || "user";
        const userEmail = user.email || userId;

        // Check if user is the reporter
        const isReporter =
          (issue.userEmail &&
            userEmail &&
            issue.userEmail.toLowerCase() === userEmail.toLowerCase()) ||
          (issue.reportedBy &&
            user.displayName &&
            issue.reportedBy.toLowerCase() === user.displayName.toLowerCase());

        // Permissions:
        // - Admin can edit/delete any issue
        // - Staff can edit status/assign but not delete
        // - Users can only edit/delete their own issues
        const canEdit =
          userRole === "admin" ||
          userRole === "staff" ||
          (userRole === "user" && isReporter);

        const canDelete =
          userRole === "admin" || (userRole === "user" && isReporter);

        res.send({
          success: true,
          permissions: {
            canEdit: canEdit,
            canDelete: canDelete,
            canUpdateStatus: userRole === "admin" || userRole === "staff",
            canAssign: userRole === "admin",
            isReporter: isReporter,
            userRole: userRole,
            issueOwner: issue.userEmail || issue.reportedBy,
          },
          issue: {
            reporterEmail: issue.userEmail,
            reporterName: issue.reportedBy,
            status: issue.status,
          },
        });
      } catch (error) {
        console.error("Permission check error:", error);
        res.status(500).send({
          success: false,
          message: "Server error",
        });
      }
    });

    // Update issue (with restrictions)

    app.patch("/issues/:id", async (req, res) => {
      try {
        const { id } = req.params;
        const updates = req.body;

        // Extract user info for permission check (optional)
        const userId = updates.userId;
        const updateType = updates.updateType || "general";

        // Remove auth info from updates to avoid storing in issue
        delete updates.userId;
        delete updates.updateType;
        delete updates.userRole;
        delete updates.userEmail;

        updates.updatedAt = new Date().toISOString();

        // Get the issue first
        const issue = await issuesCollection.findOne({ _id: id });

        if (!issue) {
          return res.status(404).send({
            success: false,
            message: "Issue not found",
          });
        }

        // If userId is provided, check permissions
        if (userId) {
          // Get user info
          let user = null;
          if (userId.includes("@")) {
            user = await userCollection.findOne({ email: userId });
          } else {
            try {
              user = await userCollection.findOne({
                _id: new ObjectId(userId),
              });
            } catch (error) {
              user = await userCollection.findOne({ email: userId });
            }
          }

          if (!user) {
            return res.status(404).send({
              success: false,
              message: "User not found",
            });
          }

          const userRole = user.role || "user";
          const userEmail = user.email || userId;
          const userName =
            user.displayName || user.name || userId.split("@")[0];

          // Check if user is the reporter
          const isReporter =
            (issue.userEmail &&
              userEmail &&
              issue.userEmail.toLowerCase() === userEmail.toLowerCase()) ||
            (issue.reportedBy &&
              user.displayName &&
              issue.reportedBy.toLowerCase() ===
                user.displayName.toLowerCase());

          // Determine allowed updates based on user role
          const allowedUpdates = {};
          let timelineEntry = null;

          if (userRole === "admin") {
            // Admin can update anything
            Object.assign(allowedUpdates, updates);
            timelineEntry = {
              status: updates.status || issue.status,
              message: "Issue updated by administrator",
              updatedBy: userName,
              updatedAt: updates.updatedAt,
            };
          } else if (userRole === "staff") {
            // Staff can only update status, progress, assignedTo, and comments
            if (updates.status) allowedUpdates.status = updates.status;
            if (updates.progress !== undefined)
              allowedUpdates.progress = updates.progress;
            if (updates.assignedTo)
              allowedUpdates.assignedTo = updates.assignedTo;
            if (updates.comments) allowedUpdates.comments = updates.comments;

            // Add timeline entry for significant updates
            if (updates.status && updates.status !== issue.status) {
              timelineEntry = {
                status: updates.status,
                message: `Status changed to ${updates.status} by staff`,
                updatedBy: userName,
                updatedAt: updates.updatedAt,
              };

              // If resolved, add resolved timestamp
              if (updates.status.toLowerCase() === "resolved") {
                allowedUpdates.resolvedAt = updates.updatedAt;
                allowedUpdates.progress = 100;
              }
            } else if (Object.keys(allowedUpdates).length > 0) {
              timelineEntry = {
                status: issue.status,
                message: "Issue details updated by staff",
                updatedBy: userName,
                updatedAt: updates.updatedAt,
              };
            }
          } else if (userRole === "user" && isReporter) {
            // Users can only update their own issues' basic info
            if (updates.title) allowedUpdates.title = updates.title;
            if (updates.description)
              allowedUpdates.description = updates.description;
            if (updates.category) allowedUpdates.category = updates.category;
            if (updates.location) allowedUpdates.location = updates.location;
            if (updates.image) allowedUpdates.image = updates.image;
            if (updates.priority) allowedUpdates.priority = updates.priority;

            // Add timeline entry
            if (Object.keys(allowedUpdates).length > 0) {
              timelineEntry = {
                status: issue.status,
                message: "Issue details updated by reporter",
                updatedBy: userName,
                updatedAt: updates.updatedAt,
              };
            }
          } else {
            return res.status(403).send({
              success: false,
              message: "You don't have permission to edit this issue",
            });
          }

          // Add updatedAt to allowed updates
          allowedUpdates.updatedAt = updates.updatedAt;

          // Validate that there are updates to make
          if (
            Object.keys(allowedUpdates).length === 1 &&
            allowedUpdates.updatedAt
          ) {
            return res.status(400).send({
              success: false,
              message: "No valid updates provided for your user role",
            });
          }

          // Add timeline entry if exists
          if (timelineEntry) {
            allowedUpdates.$push = { timeline: timelineEntry };
          }

          const result = await issuesCollection.updateOne(
            { _id: id },
            { $set: allowedUpdates }
          );

          if (result.modifiedCount === 0) {
            return res.status(404).send({
              success: false,
              message: "Issue not found or no changes made",
            });
          }

          // Get updated issue
          const updatedIssue = await issuesCollection.findOne({ _id: id });

          return res.send({
            success: true,
            message: "Issue updated successfully",
            data: updatedIssue,
            userRole: userRole,
            isReporter: isReporter,
          });
        } else {
          // No userId provided - use original behavior (backward compatibility)
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
        }
      } catch (error) {
        console.error("Error updating issue:", error);
        res.status(500).send({
          success: false,
          message: "Failed to update issue",
          error: error.message,
        });
      }
    });

    // ========== BOOST PAYMENT ENDPOINTS ==========

    // Create boost_payment collection
    const boostPaymentCollection = db.collection("boost_payment");

    // Process boost payment
    app.post("/boost-payment", async (req, res) => {
      try {
        const boostData = req.body;

        console.log(
          "🚀 Processing boost payment for issue:",
          boostData.issueId
        );

        // Validate required fields
        if (!boostData.issueId || !boostData.userEmail || !boostData.amount) {
          return res.status(400).send({
            success: false,
            message: "Issue ID, user email, and amount are required",
          });
        }

        // Generate unique IDs
        const boostId = new ObjectId().toString();
        const transactionId = `BOOST-${Date.now()}-${Math.floor(
          1000 + Math.random() * 9000
        )}`;

        // Create complete boost payment document
        const completeBoostData = {
          _id: boostId,
          issueId: boostData.issueId,
          issueTitle: boostData.issueTitle,
          userId: boostData.userId || boostData.userEmail,
          userName: boostData.userName || boostData.userEmail.split("@")[0],
          userEmail: boostData.userEmail,
          amount: parseInt(boostData.amount) || 100,
          currency: boostData.currency || "INR",
          status: "completed",
          paymentMethod: boostData.paymentMethod || "Card",
          cardLastFour: boostData.cardLastFour || null,
          transactionId: transactionId,
          boostType: boostData.boostType || "priority_boost",
          oldPriority: boostData.oldPriority || "normal",
          newPriority: boostData.newPriority || "high",
          paymentDate: new Date().toISOString(),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          metadata: boostData.metadata || {},
        };

        // Save to boost_payment collection
        const boostResult = await boostPaymentCollection.insertOne(
          completeBoostData
        );

        // console.log(
        //   ` Boost payment recorded successfully for ${boostData.userEmail}`
        // );
        // console.log(` Amount: ₹${completeBoostData.amount}`);
        // console.log(
        //   ` Priority: ${completeBoostData.oldPriority} → ${completeBoostData.newPriority}`
        // );

        res.send({
          success: true,
          message: "Boost payment recorded successfully",
          boostId: boostResult.insertedId,
          transactionId: transactionId,
          boost: completeBoostData,
        });
      } catch (error) {
        console.error(" Error creating boost payment:", error);
        res.status(500).send({
          success: false,
          message: "Failed to record boost payment",
          error: error.message,
        });
      }
    });

    // Get boost payments by user email
    app.get("/boost-payments/user/:email", async (req, res) => {
      try {
        const { email } = req.params;

        const cursor = boostPaymentCollection
          .find({ userEmail: email })
          .sort({ paymentDate: -1 });
        const payments = await cursor.toArray();

        res.send({
          success: true,
          count: payments.length,
          payments: payments,
        });
      } catch (error) {
        console.error("Error fetching boost payments:", error);
        res.status(500).send({
          success: false,
          message: "Failed to fetch boost payments",
        });
      }
    });

    // Get boost payments by issue ID
    app.get("/boost-payments/issue/:issueId", async (req, res) => {
      try {
        const { issueId } = req.params;

        const payments = await boostPaymentCollection
          .find({ issueId: issueId })
          .toArray();

        res.send({
          success: true,
          count: payments.length,
          payments: payments,
        });
      } catch (error) {
        console.error("Error fetching issue boost payments:", error);
        res.status(500).send({
          success: false,
          message: "Failed to fetch issue boost payments",
        });
      }
    });

    // Get all boost payments (for admin)
    app.get("/boost-payments", async (req, res) => {
      try {
        const cursor = boostPaymentCollection.find().sort({ paymentDate: -1 });
        const payments = await cursor.toArray();

        res.send({
          success: true,
          count: payments.length,
          payments: payments,
        });
      } catch (error) {
        console.error("Error fetching boost payments:", error);
        res.status(500).send({
          success: false,
          message: "Failed to fetch boost payments",
        });
      }
    });

    // ========== SEARCH & FILTER ENDPOINTS ==========

    // Get unique categories for filter dropdown
    app.get("/issues/categories", async (req, res) => {
      try {
        const categories = await issuesCollection.distinct("category");
        res.send({
          success: true,
          categories: categories.filter(Boolean).sort(), // Remove null/undefined and sort
        });
      } catch (error) {
        console.error("Error fetching categories:", error);
        res.status(500).send({
          success: false,
          message: "Failed to fetch categories",
        });
      }
    });

    // Get unique locations for filter dropdown
    app.get("/issues/locations", async (req, res) => {
      try {
        const locations = await issuesCollection.distinct("location");
        res.send({
          success: true,
          locations: locations.filter(Boolean).sort(), // Remove null/undefined and sort
        });
      } catch (error) {
        console.error("Error fetching locations:", error);
        res.status(500).send({
          success: false,
          message: "Failed to fetch locations",
        });
      }
    });

    // Search issues with pagination
    app.get("/issues/search", async (req, res) => {
      try {
        const {
          search = "",
          category = "all",
          status = "all",
          priority = "all",
          location = "all",
          sortBy = "recent",
          sortOrder = "desc",
          page = 1,
          limit = 6,
        } = req.query;

        // Build query object
        let query = {};

        // Search in multiple fields
        if (search && search.trim() !== "") {
          query.$or = [
            { title: { $regex: search.trim(), $options: "i" } },
            { description: { $regex: search.trim(), $options: "i" } },
            { location: { $regex: search.trim(), $options: "i" } },
            { reportedBy: { $regex: search.trim(), $options: "i" } },
          ];
        }

        // Filter by category
        if (category && category !== "all") {
          query.category = { $regex: new RegExp(category, "i") };
        }

        // Filter by status
        if (status && status !== "all") {
          query.status = { $regex: new RegExp(`^${status}$`, "i") };
        }

        // Filter by priority
        if (priority && priority !== "all") {
          query.priority = { $regex: new RegExp(`^${priority}$`, "i") };
        }

        // Filter by location
        if (location && location !== "all") {
          query.location = { $regex: new RegExp(location, "i") };
        }

        // Sort options
        let sortOptions = {};
        switch (sortBy) {
          case "recent":
            sortOptions = { reportedAt: sortOrder === "asc" ? 1 : -1 };
            break;
          case "upvotes":
            sortOptions = { upvotes: sortOrder === "asc" ? 1 : -1 };
            break;
          case "title":
            sortOptions = { title: sortOrder === "asc" ? 1 : -1 };
            break;
          case "status":
            sortOptions = { status: sortOrder === "asc" ? 1 : -1 };
            break;
          case "priority":
            sortOptions = {
              priority: sortOrder === "asc" ? 1 : -1,
              reportedAt: -1,
            };
            break;
          default:
            sortOptions = { reportedAt: -1 };
        }

        // Calculate pagination
        const currentPage = parseInt(page);
        const itemsPerPage = parseInt(limit);
        const skip = (currentPage - 1) * itemsPerPage;

        // Get total count for pagination info
        const totalItems = await issuesCollection.countDocuments(query);
        const totalPages = Math.ceil(totalItems / itemsPerPage);

        // Get filtered, sorted, and paginated data
        const cursor = issuesCollection
          .find(query)
          .sort(sortOptions)
          .skip(skip)
          .limit(itemsPerPage);

        const issues = await cursor.toArray();

        // Get available filter options for current results
        const availableCategories = await issuesCollection.distinct(
          "category",
          query
        );
        const availableStatuses = await issuesCollection.distinct(
          "status",
          query
        );
        const availablePriorities = await issuesCollection.distinct(
          "priority",
          query
        );
        const availableLocations = await issuesCollection.distinct(
          "location",
          query
        );

        res.send({
          success: true,
          data: {
            issues: issues,
            pagination: {
              currentPage: currentPage,
              totalPages: totalPages,
              totalItems: totalItems,
              itemsPerPage: itemsPerPage,
              hasNextPage: currentPage < totalPages,
              hasPrevPage: currentPage > 1,
            },
            filters: {
              availableCategories: availableCategories.filter(Boolean),
              availableStatuses: availableStatuses.filter(Boolean),
              availablePriorities: availablePriorities.filter(Boolean),
              availableLocations: availableLocations.filter(Boolean),
              appliedFilters: {
                search: search,
                category: category,
                status: status,
                priority: priority,
                location: location,
                sortBy: sortBy,
                sortOrder: sortOrder,
              },
            },
          },
        });
      } catch (error) {
        console.error("Error in search endpoint:", error);
        res.status(500).send({
          success: false,
          message: "Failed to search issues",
          error: error.message,
        });
      }
    });

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
    console.log("Pinged MongoDB deployment. Connection successful!");
  } catch (error) {
    console.error("Failed to connect to MongoDB:", error);
  }
}

run().catch(console.dir);

app.get("/", (req, res) => {
  res.send({
    message: "Public Infrastructure Report Server is running 🚀",
    endpoints: {
      users: "POST /users, GET /users, GET /users/:email",
      staff: "GET /staff, GET /staff/issues, GET /staff/dashboard-stats",
      userAuth:
        "POST /validate-user, GET /user-dashboard-info/:email, GET /check-role/:email",
      payments:
        "POST /create-payment, GET /payments, GET /payments/user/:email, GET /payments/stats",
      issues:
        "GET /issues, POST /issues, GET /issues/:id, DELETE /issues/:id, PATCH /issues/:id",
      issueActions:
        "POST /issues/:id/assign, POST /issues/:id/update-status, POST /issues/:id/upvote",
      myIssues: "GET /my-issues?email=user@example.com",
      stats: "GET /issues-stats",
      updateRole: "POST /update-role",
    },
  });
});

app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});