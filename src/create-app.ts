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
  sampleScoreboardEntries,
  type ConversionRepository
} from "./persistence/conversion-repository.js";

interface JourneySession {
  displayName?: string;
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

  return response.status(400).render(view, {
    ...additionalContext,
    values,
    errorMessage: message,
    errors: [{ text: message, href: `#${field}` }]
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

  if (user.mustChangePassword) {
    response.redirect(303, "/account/change-password");
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
    response.render("index", {
      values: { displayName: journey(request).displayName }
    });
  });

  app.post("/convert/name", (request, response) => {
    if (!requireAuthenticatedUser(request, response)) return;
    const parsed = displayNameSchema.safeParse(request.body);

    if (!parsed.success) {
      return renderFieldError(response, "index", parsed.error, "displayName", request.body);
    }

    journey(request).displayName = parsed.data.displayName;
    journey(request).user!.displayName = parsed.data.displayName;
    return response.redirect(303, "/convert/activity");
  });

  app.get("/convert/activity", (request, response) => {
    if (!requireAuthenticatedUser(request, response)) return;
    if (!requireJourneyValue(request, response, "displayName", "/convert")) return;

    response.render("journey/activity", {
      activities,
      values: { activity: journey(request).activity }
    });
  });

  app.post("/convert/activity", (request, response) => {
    if (!requireAuthenticatedUser(request, response)) return;
    if (!requireJourneyValue(request, response, "displayName", "/convert")) return;
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
      displayName: session.displayName!,
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
      journey(request).user = user;
      return response.redirect(303, user.mustChangePassword ? "/account/change-password" : "/convert");
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

  app.get("/account/change-password", (request, response) => {
    if (!journey(request).user) return response.redirect(303, "/login");
    response.render("account/change-password");
  });

  app.post("/account/change-password", async (request, response, next) => {
    const user = journey(request).user;
    if (!user) return response.redirect(303, "/login");
    const parsed = passwordSchema.safeParse(request.body);
    if (!parsed.success) return renderFieldError(response, "account/change-password", parsed.error, "password", request.body);
    try {
      await authentication.changePassword(user.id, parsed.data.password);
      user.mustChangePassword = false;
      return response.redirect(303, "/convert");
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

  app.post("/admin/invitations", async (request, response, next) => {
    if (!requireAdmin(request, response)) return;
    const parsed = emailSchema.and(displayNameSchema).safeParse(request.body);
    if (!parsed.success) return renderFieldError(response, "account/admin", parsed.error, "email", request.body, { users: await authentication.listUsers() });
    const email = normaliseEmail(parsed.data.email);
    if (!isAllowedEmail(email, allowedEmailDomain)) {
      return response.status(400).render("account/admin", { users: await authentication.listUsers(), values: request.body, errorMessage: `Enter an email address ending in @${allowedEmailDomain}`, errors: [{ text: `Enter an email address ending in @${allowedEmailDomain}`, href: "#email" }] });
    }
    try {
      const invitation = await authentication.inviteUser(email, parsed.data.displayName);
      return response.render("account/invitation-created", { invitation });
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

  app.get("/scoreboard", async (_request, response, next) => {
    const now = new Date();
    const monthStart = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-01`;
    const monthLabel = new Intl.DateTimeFormat("en-GB", {
      month: "long",
      year: "numeric",
      timeZone: "UTC"
    }).format(now);

    try {
      const storedEntries = await repository.listMonthly(monthStart);
      const isDemoData = storedEntries.length === 0;
      const entries = isDemoData ? sampleScoreboardEntries : storedEntries;
      return response.render("scoreboard", { entries, isDemoData, monthLabel });
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
