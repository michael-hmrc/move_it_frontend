import cookieSession from "cookie-session";
import express, {
  type ErrorRequestHandler,
  type Request,
  type Response
} from "express";
import nunjucks from "nunjucks";
import path from "node:path";
import type { ZodError } from "zod";
import { timingSafeEqual } from "node:crypto";
import {
  activities,
  getActivity,
  intensities,
  isActivityId,
  isIntensity,
  type ActivityId,
  type Intensity
} from "./domain/activities.js";
import {
  convertActivityToSteps,
  type ConversionResult
} from "./domain/conversion.js";
import {
  activitySchema,
  displayNameSchema,
  durationSchema,
  emailSchema,
  intensitySchema,
  passwordSchema
} from "./domain/validation.js";
import {
  createAuthenticationService,
  type AuthenticationService
} from "./persistence/authentication.js";
import {
  createConversionRepository,
  type ConversionRepository
} from "./persistence/conversion-repository.js";

interface JourneySession {
  activity?: ActivityId;
  intensity?: Intensity;
  durationMinutes?: number;
  result?: ConversionResult;
  user?: {
    id: string;
    displayName: string;
    email: string;
    mustChangePassword: boolean;
  };
  isAdmin?: boolean;
}

function journey(request: Request): JourneySession {
  request.session ??= {};
  return request.session as JourneySession;
}

function renderFieldError(
  response: Response,
  view: string,
  error: ZodError,
  field: string,
  values: Record<string, unknown> = {},
  additionalContext: Record<string, unknown> = {}
) {
  const message = error.issues[0]?.message ?? "Enter a valid value";
  const issueField = error.issues[0]?.path[0];
  const errorField = typeof issueField === "string" ? issueField : field;

  return response.status(400).render(view, {
    ...additionalContext,
    values,
    errorMessage: message,
    errorField,
    errors: [{ text: message, href: `#${errorField}` }]
  });
}

function requireJourneyValue(
  request: Request,
  response: Response,
  value: keyof JourneySession,
  redirectTo: string
) {
  if (journey(request)[value] === undefined) {
    response.redirect(303, redirectTo);
    return false;
  }

  return true;
}

function normaliseEmail(value: string) {
  return value.trim().toLowerCase();
}

function isAllowedEmail(email: string, allowedDomain: string) {
  return normaliseEmail(email).endsWith(`@${allowedDomain}`);
}

function requireAuthenticatedUser(request: Request, response: Response) {
  const user = journey(request).user;

  if (!user) {
    response.redirect(303, "/login");
    return undefined;
  }

  return user;
}

function secretsMatch(value: string, expected: string) {
  const supplied = Buffer.from(value);
  const configured = Buffer.from(expected);
  return supplied.length === configured.length && timingSafeEqual(supplied, configured);
}

function requireAdmin(request: Request, response: Response) {
  if (!journey(request).isAdmin) {
    response.redirect(303, "/admin/login");
    return false;
  }
  return true;
}

export function createApp(
  repository: ConversionRepository = createConversionRepository(),
  authentication: AuthenticationService = createAuthenticationService()
) {
  const app = express();
  const projectRoot = process.cwd();
  const sessionSecret = process.env.SESSION_SECRET;
  const isProduction = process.env.NODE_ENV === "production";
  const allowedEmailDomain = (process.env.AUTH_ALLOWED_EMAIL_DOMAIN ?? "opencastsoftware.com")
    .trim()
    .toLowerCase();
  const adminAccessToken = process.env.ADMIN_ACCESS_TOKEN;

  if (!sessionSecret && isProduction) {
    throw new Error("SESSION_SECRET must be configured in production");
  }

  if (!allowedEmailDomain || allowedEmailDomain.includes("@")) {
    throw new Error("AUTH_ALLOWED_EMAIL_DOMAIN must be a domain, without @");
  }

  if (isProduction && !adminAccessToken) {
    throw new Error("ADMIN_ACCESS_TOKEN must be configured in production");
  }

  nunjucks.configure(
    [
      path.join(projectRoot, "views"),
      path.join(projectRoot, "node_modules", "govuk-frontend", "dist")
    ],
    { autoescape: true, express: app, noCache: !isProduction }
  );

  app.disable("x-powered-by");
  app.set("trust proxy", 1);
  app.set("view engine", "njk");
  app.set("views", path.join(projectRoot, "views"));
  app.locals.assetVersion = process.env.VERCEL_DEPLOYMENT_ID
    ?? process.env.VERCEL_GIT_COMMIT_SHA
    ?? Date.now().toString(36);
  app.locals.vercelAnalytics = Boolean(process.env.VERCEL);
  app.use(express.urlencoded({ extended: false }));
  app.use(
    cookieSession({
      name: "move-it-journey",
      keys: [sessionSecret ?? "local-development-only-secret"],
      maxAge: 30 * 60 * 1000,
      httpOnly: true,
      sameSite: "lax",
      secure: isProduction
    })
  );
  app.use(
    express.static(path.join(projectRoot, "public"), {
      maxAge: isProduction ? "1h" : 0
    })
  );

  app.use((request, response, next) => {
    response.locals.currentUser = journey(request).user;
    response.locals.currentSection = request.path === "/"
      ? "home"
      : request.path.startsWith("/login") || request.path.startsWith("/signup")
        ? "account"
        : request.path.startsWith("/conversions")
          ? "conversions"
          : request.path.startsWith("/scoreboard")
            ? "scoreboard"
            : request.path.startsWith("/about")
              ? "about"
              : "convert";
    next();
  });

  app.get("/health", (_request, response) => {
    response.json({ status: "ok" });
  });

  app.get("/", (_request, response) => {
    response.render("home");
  });

  app.get("/convert", (request, response) => {
    if (!requireAuthenticatedUser(request, response)) return;
    response.render("journey/activity", {
      activities,
      values: { activity: journey(request).activity }
    });
  });

  app.get("/convert/activity", (request, response) => {
    if (!requireAuthenticatedUser(request, response)) return;

    response.render("journey/activity", {
      activities,
      values: { activity: journey(request).activity }
    });
  });

  app.post("/convert/activity", (request, response) => {
    if (!requireAuthenticatedUser(request, response)) return;
    const parsed = activitySchema.safeParse(request.body);

    if (!parsed.success) {
      return renderFieldError(
        response,
        "journey/activity",
        parsed.error,
        "activity",
        request.body,
        { activities }
      );
    }

    journey(request).activity = parsed.data.activity;
    return response.redirect(303, "/convert/intensity");
  });

  app.get("/convert/intensity", (request, response) => {
    if (!requireAuthenticatedUser(request, response)) return;
    if (!requireJourneyValue(request, response, "activity", "/convert/activity")) return;

    response.render("journey/intensity", {
      intensities,
      activityName: getActivity(journey(request).activity!).name,
      values: { intensity: journey(request).intensity }
    });
  });

  app.post("/convert/intensity", (request, response) => {
    if (!requireAuthenticatedUser(request, response)) return;
    if (!requireJourneyValue(request, response, "activity", "/convert/activity")) return;
    const parsed = intensitySchema.safeParse(request.body);

    if (!parsed.success) {
      return renderFieldError(
        response,
        "journey/intensity",
        parsed.error,
        "intensity",
        request.body,
        {
          intensities,
          activityName: getActivity(journey(request).activity!).name
        }
      );
    }

    journey(request).intensity = parsed.data.intensity;
    return response.redirect(303, "/convert/duration");
  });

  app.get("/convert/duration", (request, response) => {
    if (!requireAuthenticatedUser(request, response)) return;
    if (!requireJourneyValue(request, response, "intensity", "/convert/intensity")) return;

    response.render("journey/duration", {
      values: { durationMinutes: journey(request).durationMinutes }
    });
  });

  app.post("/convert/duration", async (request, response, next) => {
    const user = requireAuthenticatedUser(request, response);
    if (!user) return;
    if (!requireJourneyValue(request, response, "intensity", "/convert/intensity")) return;
    const parsed = durationSchema.safeParse(request.body);

    if (!parsed.success) {
      return renderFieldError(
        response,
        "journey/duration",
        parsed.error,
        "durationMinutes",
        request.body
      );
    }

    const session = journey(request);
    session.durationMinutes = parsed.data.durationMinutes;
    const result = convertActivityToSteps({
      displayName: user.displayName,
      activity: session.activity!,
      intensity: session.intensity!,
      durationMinutes: session.durationMinutes
    });

    try {
      await repository.save(result, user.id);
      session.result = result;
      return response.redirect(303, "/convert/result");
    } catch (error) {
      return next(error);
    }
  });

  app.get("/convert/result", (request, response) => {
    if (!requireAuthenticatedUser(request, response)) return;
    if (!requireJourneyValue(request, response, "result", "/convert")) return;
    response.render("result", { result: journey(request).result });
  });

  app.get("/convert/reset", (request, response) => {
    const currentUser = journey(request).user;
    request.session = currentUser ? { user: currentUser } : {};
    response.redirect(303, "/convert");
  });

  app.get("/about", (_request, response) => {
    response.render("about");
  });

  app.get("/login", (_request, response) => {
    response.render("account/login");
  });

  app.post("/login", async (request, response, next) => {
    const parsed = emailSchema.and(passwordSchema).safeParse(request.body);

    if (!parsed.success) {
      return renderFieldError(response, "account/login", parsed.error, "email", request.body);
    }

    const email = normaliseEmail(parsed.data.email);
    if (!isAllowedEmail(email, allowedEmailDomain)) {
      return response.status(400).render("account/login", {
        values: request.body,
        errorMessage: `Enter an email address ending in @${allowedEmailDomain}`,
        errors: [{ text: `Enter an email address ending in @${allowedEmailDomain}`, href: "#email" }]
      });
    }

    try {
      const user = await authentication.signIn(email, parsed.data.password);
      if (user.status === "pending") {
        return response.status(403).render("account/access-pending");
      }
      if (user.status !== "approved") return response.status(403).render("account/access-unavailable");
      journey(request).user = user;
      return response.redirect(303, "/");
    } catch (error) {
      return response.status(401).render("account/login", {
        values: { email },
        errorMessage: error instanceof Error ? error.message : "Could not sign in",
        errors: [{ text: error instanceof Error ? error.message : "Could not sign in", href: "#email" }]
      });
    }
  });

  app.post("/logout", (request, response) => {
    request.session = null;
    response.redirect(303, "/");
  });

  app.get("/request-access", (_request, response) => response.render("account/request-access"));
  app.post("/request-access", async (request, response, next) => {
    const parsed = emailSchema.and(displayNameSchema).and(passwordSchema).safeParse(request.body);
    if (!parsed.success) return renderFieldError(response, "account/request-access", parsed.error, "email", request.body);
    const email = normaliseEmail(parsed.data.email);
    if (!isAllowedEmail(email, allowedEmailDomain)) {
      return response.status(400).render("account/request-access", { values: request.body, errorMessage: `Enter an email address ending in @${allowedEmailDomain}`, errors: [{ text: `Enter an email address ending in @${allowedEmailDomain}`, href: "#email" }] });
    }
    try {
      await authentication.requestAccess(email, parsed.data.displayName, parsed.data.password);
      return response.render("account/access-requested");
    } catch (error) { return next(error); }
  });

  app.get("/admin/login", (_request, response) => response.render("account/admin-login"));
  app.post("/admin/login", (request, response) => {
    const token = typeof request.body.adminAccessToken === "string" ? request.body.adminAccessToken : "";
    if (!adminAccessToken || !secretsMatch(token, adminAccessToken)) {
      return response.status(401).render("account/admin-login", {
        errorMessage: "Enter a valid admin access token",
        errors: [{ text: "Enter a valid admin access token", href: "#adminAccessToken" }]
      });
    }
    journey(request).isAdmin = true;
    return response.redirect(303, "/admin");
  });

  app.get("/admin", async (request, response, next) => {
    if (!requireAdmin(request, response)) return;
    try { return response.render("account/admin", { users: await authentication.listUsers() }); }
    catch (error) { return next(error); }
  });

  app.post("/admin/users/:id/approve", async (request, response, next) => {
    if (!requireAdmin(request, response)) return;
    try {
      await authentication.approveUser(request.params.id);
      return response.redirect(303, "/admin");
    } catch (error) { return next(error); }
  });

  app.post("/admin/users/:id/deactivate", async (request, response, next) => {
    if (!requireAdmin(request, response)) return;
    try {
      await authentication.deactivateUser(request.params.id);
      return response.redirect(303, "/admin");
    } catch (error) { return next(error); }
  });

  app.post("/admin/users/:id/reactivate", async (request, response, next) => {
    if (!requireAdmin(request, response)) return;
    try {
      await authentication.reactivateUser(request.params.id);
      return response.redirect(303, "/admin");
    } catch (error) { return next(error); }
  });

  app.get("/signup", (_request, response) => {
    response.redirect(303, "/login");
  });

  app.get("/conversions", (_request, response) => {
    const conversionRows = activities.map((activity) => ({
      activityName: activity.name,
      light: activity.stepsPerMinute.light * 60,
      moderate: activity.stepsPerMinute.moderate * 60,
      vigorous: activity.stepsPerMinute.vigorous * 60
    }));

    response.render("conversions", { conversionRows });
  });

  app.get("/scoreboard", async (request, response, next) => {
    if (!requireAuthenticatedUser(request, response)) return;
    const now = new Date();
    const monthStart = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-01`;
    const monthLabel = new Intl.DateTimeFormat("en-GB", {
      month: "long",
      year: "numeric",
      timeZone: "UTC"
    }).format(now);

    try {
      const entries = await repository.listMonthly(monthStart);
      return response.render("scoreboard", { entries, monthLabel });
    } catch (error) {
      return next(error);
    }
  });

  app.use((_request, response) => {
    response.status(404).render("404");
  });

  const errorHandler: ErrorRequestHandler = (error, _request, response, _next) => {
    console.error(error);
    response.status(500).render("500");
  };
  app.use(errorHandler);

  return app;
}
