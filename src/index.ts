import { drizzle, type DrizzleD1Database } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { createFiberplane } from "@fiberplane/hono";
import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import * as schema from "./db/schema";
import twilio from "twilio";

const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_PHONE_NUMBER = process.env.TWILIO_PHONE_NUMBER;
const TEST_PHONE_NUMBER = process.env.TEST_PHONE_NUMBER;

const twilioClient = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);

// Types for environment variables and context
type Bindings = {
  DB: D1Database; // Cloudflare D1 database binding
};

type Variables = {
  db: DrizzleD1Database;
};

// Create the app with type-safe bindings and variables
// For more information on OpenAPIHono, see: https://hono.dev/examples/zod-openapi
const app = new OpenAPIHono<{ Bindings: Bindings; Variables: Variables }>();

// Middleware: Set up D1 database connection for all routes
app.use(async (c, next) => {
  const db = drizzle(c.env.DB);
  c.set("db", db);
  await next();
});

// Route Definitions
// Each route is defined separately with its request/response schema
// This enables automatic OpenAPI documentation and type safety

const root = createRoute({
  method: "get",
  path: "/",
  responses: {
    200: {
      content: { "text/plain": { schema: z.string() } },
      description: "Root fetched successfully",
    },
  },
});

// Define the expected response shape using Zod
//
// We can add openapi documentation, as well as name the Schema in the OpenAPI document,
// by chaining `openapi` on the zod schema definitions
const UserSchema = z.object({
  id: z.number().openapi({
    example: 1,
  }),
  name: z.string().openapi({
    example: "Matthew",
  }),
  email: z.string().email().openapi({
    example: "matthew@cloudflare.com",
  }),
}).openapi("User");

const getUsers = createRoute({
  method: "get",
  path: "/api/users",
  responses: {
    200: {
      content: { "application/json": { schema: z.array(UserSchema) } },
      description: "Users fetched successfully",
    },
  },
});

const getUser = createRoute({
  method: "get",
  path: "/api/users/{id}",
  request: {
    // Validate and parse URL parameters
    params: z.object({
      id: z.coerce.number().openapi({
        example: 1,
      }),
    }),
  },
  responses: {
    200: {
      content: { "application/json": { schema: UserSchema } },
      description: "User fetched successfully",
    },
  },
});

// ElevenLabs webhook schema and route definition
const ElevenLabsWebhookSchema = z.object({
  caller_id: z.string(),
  agent_id: z.string(),
  called_number: z.string(),
  call_sid: z.string(),
}).openapi("ElevenLabsWebhook");

const elevenLabsWebhookRoute = createRoute({
  method: "post",
  path: "/elevenlabs-webhook",
  request: {
    body: {
      required: true,
      content: {
        "application/json": {
          schema: ElevenLabsWebhookSchema,
        },
      },
    },
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({
            dynamic_variables: z.object({
              callerId: z.string(),
              agentId: z.string(),
              calledNumber: z.string(),
              callSid: z.string(),
            }),
          }),
        },
      },
      description: "Dynamic variables returned successfully",
    },
    500: {
      content: {
        "application/json": {
          schema: z.object({
            error: z.string(),
          }),
        },
      },
      description: "Internal server error",
    },
  },
});

const NewUserSchema = z.object({
  name: z.string().openapi({
    example: "Matthew",
  }),
  email: z.string().email().openapi({
    example: "matthew@cloudflare.com",
  }),
}).openapi("NewUser");

const createUser = createRoute({
  method: "post",
  path: "/api/user",
  request: {
    // Validate request body using Zod schemas
    body: {
      required: true, // NOTE: this is important to set to true, otherwise the route will accept empty body
      content: {
        "application/json": {
          schema: NewUserSchema,
        },
      },
    },
  },
  responses: {
    201: {
      content: {
        "application/json": {
          schema: UserSchema,
        },
      },
      description: "User created successfully",
    },
  },
});

// Route Implementations
// Connect the route definitions to their handlers using .openapi()
app.openapi(root, (c) => {
  return c.text("Honc from above! ☁️🪿");
})
  .openapi(getUsers, async (c) => {
    const db = c.get("db");
    const users = await db.select().from(schema.users);
    return c.json(users);
  })
  .openapi(getUser, async (c) => {
    const db = c.get("db");
    const { id } = c.req.valid("param");
    const [user] = await db.select().from(schema.users).where(eq(schema.users.id, id));
    return c.json(user);
  })
  .openapi(createUser, async (c) => {
    const db = c.get("db");
    const { name, email } = c.req.valid("json");

    const [newUser] = await db
      .insert(schema.users)
      .values({
        name,
        email,
      })
      .returning();

    return c.json(newUser, 201);
  })
  .openapi(elevenLabsWebhookRoute, async (c) => {
    try {
      const webhookPayload = c.req.valid("json");
      return c.json({
        dynamic_variables: {
          callerId: webhookPayload.caller_id.slice(-10),
          agentId: webhookPayload.agent_id,
          calledNumber: webhookPayload.called_number,
          callSid: webhookPayload.call_sid,
        },
      });
    } catch (error: any) {
      return c.json({ error: "Internal server error" }, 500);
    }
  })
  // Generate OpenAPI spec at /openapi.json
  .doc("/openapi.json", {
    openapi: "3.0.0",
    info: {
      title: "D1 Honc! 🪿☁️",
      version: "1.0.0",
      description: "D1 Honc! 🪿☁️",
    },
  })
  .use("/fp/*", createFiberplane({
    app,
    openapi: { url: "/openapi.json" },
  }));

export default app;
