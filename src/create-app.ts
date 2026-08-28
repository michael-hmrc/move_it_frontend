import cookieSession from "cookie-session";
import express, {
  type ErrorRequestHandler,
  type Request,
  type Response
} from "express";
import nunjucks from "nunjucks";
import path from "node:path";
import type { ZodError } from "zod";
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
  intensitySchema
} from "./domain/validation.js";
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
  mockUser?: {
    displayName: string;
  };
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

export function createApp(
  repository: ConversionRepository = createConversionRepository()
) {
  const app = express();
  const projectRoot = process.cwd();
  const sessionSecret = process.env.SESSION_SECRET;
  const isProduction = process.env.NODE_ENV === "production";

  if (!sessionSecret && isProduction) {
    throw new Error("SESSION_SECRET must be configured in production");
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
    response.locals.currentUser = journey(request).mockUser;
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
    response.render("index", {
      values: { displayName: journey(request).displayName }
    });
  });

  app.post("/convert/name", (request, response) => {
    const parsed = displayNameSchema.safeParse(request.body);

    if (!parsed.success) {
      return renderFieldError(response, "index", parsed.error, "displayName", request.body);
    }

    journey(request).displayName = parsed.data.displayName;
    return response.redirect(303, "/convert/activity");
  });

  app.get("/convert/activity", (request, response) => {
    if (!requireJourneyValue(request, response, "displayName", "/convert")) return;

    response.render("journey/activity", {
      activities,
      values: { activity: journey(request).activity }
    });
  });

  app.post("/convert/activity", (request, response) => {
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
    if (!requireJourneyValue(request, response, "activity", "/convert/activity")) return;

    response.render("journey/intensity", {
      intensities,
      activityName: getActivity(journey(request).activity!).name,
      values: { intensity: journey(request).intensity }
    });
  });

  app.post("/convert/intensity", (request, response) => {
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
    if (!requireJourneyValue(request, response, "intensity", "/convert/intensity")) return;

    response.render("journey/duration", {
      values: { durationMinutes: journey(request).durationMinutes }
    });
  });

  app.post("/convert/duration", async (request, response, next) => {
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
      await repository.save(result);
      session.result = result;
      return response.redirect(303, "/convert/result");
    } catch (error) {
      return next(error);
    }
  });

  app.get("/convert/result", (request, response) => {
    if (!requireJourneyValue(request, response, "result", "/convert")) return;
    response.render("result", { result: journey(request).result });
  });

  app.get("/convert/reset", (request, response) => {
    const currentUser = journey(request).mockUser;
    request.session = currentUser ? { mockUser: currentUser } : {};
    response.redirect(303, "/convert");
  });

  app.get("/about", (_request, response) => {
    response.render("about");
  });

  app.get("/login", (_request, response) => {
    response.render("account/login");
  });

  app.post("/login", (request, response) => {
    journey(request).mockUser = { displayName: "Demo user" };
    response.redirect(303, "/");
  });

  app.post("/logout", (request, response) => {
    delete journey(request).mockUser;
    response.redirect(303, "/");
  });

  app.get("/signup", (_request, response) => {
    response.render("account/signup");
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
