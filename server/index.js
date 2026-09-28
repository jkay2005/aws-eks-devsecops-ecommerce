import dotenv from "dotenv";
import express from "express";
import cors from "cors";
// import bodyParser from "body-parser";
import passport from "passport";
import { Strategy as GitHubStrategy } from "passport-github2";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import { pool } from "./models/index.js";
import stripeLib from "stripe";
// import path from "path";
// import { fileURLToPath } from "url";

// Controllers
import { isAuthenticated } from "./controllers/auth.js";
import { findUserByEmail, insertUser } from "./controllers/user.js";

// Routes
import { authRouter } from "./routes/auth.route.js";
import { userRouter } from "./routes/user.route.js";
import { productRouter } from "./routes/product.route.js";
import { cartRouter } from "./routes/cart.route.js";
import { orderRouter } from "./routes/order.route.js";

// Express Config
dotenv.config();

for (const name of ["DB_URL", "SESSION_SECRET", "FRONT_DOMAIN"]) {
  if (!process.env[name]?.trim()) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
}

const app = express();

const PORT = Number(process.env.PORT || 3000);

if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
  throw new Error("PORT must be an integer between 1 and 65535");
}

const cookieSecureValue =
  process.env.COOKIE_SECURE ??
  (process.env.NODE_ENV === "production" ? "true" : "false");

if (!["true", "false"].includes(cookieSecureValue)) {
  throw new Error("COOKIE_SECURE must be true or false");
}

const COOKIE_SECURE = cookieSecureValue === "true";

let shuttingDown = false;

const STRIPE_SECRET = process.env.STRIPE_SECRET?.trim();

const stripe = STRIPE_SECRET
  ? stripeLib(STRIPE_SECRET)
  : null;

if (!stripe) {
  console.warn(
    "[WARN] STRIPE_SECRET is not configured. Payment functionality is disabled."
  );
}

const FRONT_DOMAIN = process.env.FRONT_DOMAIN.trim();

const GITHUB_CLIENT = process.env.GITHUB_CLIENT?.trim();
const GITHUB_SECRET = process.env.GITHUB_SECRET?.trim();

const isGitHubOAuthConfigured = Boolean(
  GITHUB_CLIENT && GITHUB_SECRET
);

// Dynamically set the origin based on the environment
const corsOptions = {
  origin: FRONT_DOMAIN,
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
};

app.set("trust proxy", 1); // Trust first proxy

// Apply CORS configuration
app.use(cors(corsOptions));

// For preflight requests
app.options("*", cors(corsOptions));

app.get("/health/live", (_req, res) => {
  res.status(200).json({
    status: "alive",
  });
});

app.get("/health/ready", async (_req, res) => {
  if (shuttingDown) {
    return res.status(503).json({
      status: "not_ready",
    });
  }

  try {
    await pool.query({
      text: "SELECT 1",
      query_timeout: 2000,
    });

    return res.status(200).json({
      status: "ready",
    });
  } catch {
    return res.status(503).json({
      status: "not_ready",
    });
  }
});

// Store sessions in PostgreSQL
const pgSession = connectPgSimple(session);

// Session configuration
app.use(
  session({
    store: new pgSession({
      pool, // Connect to PostgreSQL
      createTableIfMissing: true, // Automatically create the session table
    }),
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: COOKIE_SECURE, // Use HTTPS in production
      maxAge: 1000 * 60 * 60 * 24 * 7, // 1 week
      sameSite: "lax",
    },
  })
);

app.use(passport.initialize());
app.use(passport.session());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// GitHub Authentication 2.0 Strategy
// Config GitHubStrategy
if (isGitHubOAuthConfigured) {
  passport.use(
    new GitHubStrategy(
      {
        clientID: GITHUB_CLIENT,
        clientSecret: GITHUB_SECRET,
        callbackURL:
          process.env.NODE_ENV === "production"
            ? "https://studio-chairs.vercel.app/auth/github/callback"
            : "http://localhost:3000/auth/github/callback",
      },
      async (accessToken, refreshToken, profile, done) => {
        try {
          const email = profile.emails[0].value;
          let user = await findUserByEmail(email);

          if (!user) {
            user = await insertUser(profile.displayName, email);
          }

          done(null, user);
        } catch (error) {
          done(error);
        }
      }
    )
  );
} else {
  console.warn(
    "[WARN] GitHub OAuth credentials are not configured. GitHub login is disabled."
  );
}

// Allow referrer info for HTTPS→HTTPS requests
app.use((req, res, next) => {
  res.setHeader("Referrer-Policy", "no-referrer-when-downgrade");
  next();
});

// testing user api + user authentication
app.get("/", (req, res) => {
  const authorization = req.isAuthenticated()
    ? "Authenticated"
    : "Not Authenticated";
  res.status(200).json({ authentication: `Hello, you are ${authorization}` });
});

// GitHub endpoints
if (isGitHubOAuthConfigured) {
  app.get(
    "/auth/github",
    passport.authenticate("github", { scope: ["user:email"] })
  );

  app.get(
    "/auth/github/callback",
    passport.authenticate("github", {
      failureRedirect: `${FRONT_DOMAIN}/login`,
    }),
    (req, res) => {
      res.redirect(`${FRONT_DOMAIN}/?status=success`);
    }
  );
} else {
  app.get("/auth/github", (req, res) => {
    res.status(503).json({
      error: "GitHub OAuth is not configured",
    });
  });

  app.get("/auth/github/callback", (req, res) => {
    res.status(503).json({
      error: "GitHub OAuth is not configured",
    });
  });
}

// Stripe endpoint
app.post("/create-checkout-session", async (req, res) => {
   if (!stripe) {
    return res.status(503).json({
      error: "Payment service is not configured",
    });
  }

  try {
    const { cartItems } = req.body;

    // Fetch product details, including stripe_price_id, from the database
    const productsQuery = `
            SELECT id, stripe_price_id 
            FROM products 
            WHERE id = ANY($1)
        `;
    const { rows: products } = await pool.query(productsQuery, [
      cartItems.map((item) => item.id),
    ]);

    // Create line items for Stripe Checkout
    const lineItems = cartItems.map((item) => {
      const product = products.find((p) => p.id === item.id);
      return {
        price: product.stripe_price_id, // Use the price_id from the database
        quantity: item.quantity,
      };
    });

    const session = await stripe.checkout.sessions.create({
      line_items: lineItems,
      mode: "payment",
      success_url: `${FRONT_DOMAIN}/order-success?success=true`,
      cancel_url: `${FRONT_DOMAIN}?canceled=true`,
    });

    // Respond with the session URL for the client to redirect
    res.json({ url: session.url });
  } catch (error) {
    console.error("Error creating checkout session:", error);
    res.status(500).json({ error: "Failed to create checkout session" });
  }
});

// APIs endpoint
app.use("/api/auth", authRouter);
app.use("/api/users", isAuthenticated, userRouter);
app.use("/api/products", productRouter);
app.use("/api/cart", isAuthenticated, cartRouter);
app.use("/api/orders", isAuthenticated, orderRouter);

// const isProduction = process.env.NODE_ENV === "production";

// if (isProduction) {
//   const __filename = fileURLToPath(import.meta.url);
//   const __dirname = path.dirname(__filename);

//   // Serve static files from React app
//   app.use(express.static(path.join(__dirname, "../client/build")));

//   // Handle React routing, return all requests to React app
//   app.get("/*", (req, res) => {
//     res.sendFile(path.join(__dirname, "../client/build", "index.html"));
//   });
// }

//Error handling
app.use((err, req, res, next) => {
  if (res.headersSent) {
    return next(err);
  }
  console.error(err.stack);
  res.status(500).send("Something went wrong. We're working on fixing it.");
});

// Listening to app
// app.listen(PORT, () => {
//   console.log(`Server is running: http://localhost:${PORT}`);
// });

// app.get("/debug/session", (req, res) => {
//   req.session.debug = "session-test";

//   res.status(200).json({
//     sessionId: req.sessionID,
//     message: "Session created",
//   });
// });

const httpServer = app.listen(PORT, "0.0.0.0", () => {
  console.log(`[http] listening on port ${PORT}`);
});

function shutdown(signal) {
  if (shuttingDown) return;

  shuttingDown = true;

  console.log(`[shutdown] received ${signal}`);

  const deadline = setTimeout(() => {
    console.error("[shutdown] timeout");
    process.exit(1);
  }, 25000);

  deadline.unref();

  httpServer.close(async (error) => {
    try {
      if (error) throw error;

      await pool.end();

      clearTimeout(deadline);

      console.log("[shutdown] completed");
      process.exit(0);
    } catch {
      console.error("[shutdown] failed");
      process.exit(1);
    }
  });
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));