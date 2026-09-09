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
  changePasswordSchema,
  displayNameSchema,
  durationSchema,
  emailSchema,
  intensitySchema,
  passwordSchema,
  signInPasswordSchema,
  teamInvitationSchema,
  teamNameSchema
} from "./domain/validation.js";
import {
  createAuthenticationService,
  DisplayNameTakenError,
  IncorrectPasswordError,
  type AuthenticationService
} from "./persistence/authentication.js";
import {
  createConversionRepository,
  type ConversionRepository
} from "./persistence/conversion-repository.js";
import {
  createTeamRepository,
  TeamOperationError,
  type TeamRepository
} from "./persistence/team-repository.js";

interface JourneySession {
  activity?: ActivityId;
  otherActivity?: string;
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

function renderFieldErrors(
  response: Response,
  view: string,
  error: ZodError,
  fields: string[],
  values: Record<string, unknown> = {}
) {
  const fieldErrors: Record<string, string> = {};

  for (const issue of error.issues) {
    const field = issue.path[0];
    if (typeof field === "string" && fields.includes(field) && !fieldErrors[field]) {
      fieldErrors[field] = issue.message;
    }
  }

  const errors = fields
    .filter((field) => fieldErrors[field])
    .map((field) => ({ text: fieldErrors[field], href: `#${field}` }));

  return response.status(400).render(view, { values, fieldErrors, errors });
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

function selectedActivityName(session: JourneySession) {
  if (session.activity === "other" && session.otherActivity) return session.otherActivity;
  return getActivity(session.activity!).name;
}

function normaliseEmail(value: string) {
  return value.trim().toLowerCase();
}

function isAllowedEmail(email: string, allowedDomain: string) {
  return normaliseEmail(email).endsWith(`@${allowedDomain}`);
}

function renderInvalidCredentials(response: Response, email: string) {
  const message = "Enter a valid email address and password";
  return response.status(401).render("account/login", {
    values: { email },
    errorMessage: message,
    errorField: "email",
    errors: [{ text: message, href: "#email" }]
  });
}

function isChangingAnswer(request: Request) {
  return request.query.from === "check";
}

function journeyUrl(path: string, request: Request) {
  return isChangingAnswer(request) ? `${path}?from=check` : path;
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
  authentication: AuthenticationService = createAuthenticationService(),
  teams: TeamRepository = createTeamRepository()
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
      : request.path.startsWith("/account")
        || request.path.startsWith("/login")
        || request.path.startsWith("/signup")
        || request.path.startsWith("/request-access")
        ? "account"
        : request.path.startsWith("/teams")
          ? "teams"
          : request.path.startsWith("/users/")
          ? "scoreboard"
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

  app.use("/convert", (request, response) => {
    const suffix = request.originalUrl.slice("/convert".length);
    response.redirect(308, `/submit${suffix}`);
  });

  app.get("/submit", (request, response) => {
    if (!requireAuthenticatedUser(request, response)) return;
    response.render("journey/activity", {
      activities,
      values: {
        activity: journey(request).activity,
        otherActivity: journey(request).otherActivity
      },
      backHref: "/",
      formAction: "/submit/activity"
    });
  });

  app.get("/submit/activity", (request, response) => {
    if (!requireAuthenticatedUser(request, response)) return;

    response.render("journey/activity", {
      activities,
      values: {
        activity: journey(request).activity,
        otherActivity: journey(request).otherActivity
      },
      backHref: isChangingAnswer(request) ? "/submit/check" : "/submit",
      formAction: journeyUrl("/submit/activity", request)
    });
  });

  app.post("/submit/activity", (request, response) => {
    if (!requireAuthenticatedUser(request, response)) return;
    const parsed = activitySchema.safeParse(request.body);

    if (!parsed.success) {
      return renderFieldError(
        response,
        "journey/activity",
        parsed.error,
        "activity",
        request.body,
        {
          activities,
          backHref: isChangingAnswer(request) ? "/submit/check" : "/submit",
          formAction: journeyUrl("/submit/activity", request)
        }
      );
    }

    journey(request).activity = parsed.data.activity;
    journey(request).otherActivity = parsed.data.activity === "other"
      ? parsed.data.otherActivity
      : undefined;
    return response.redirect(303, isChangingAnswer(request) ? "/submit/check" : "/submit/intensity");
  });

  app.get("/submit/intensity", (request, response) => {
    if (!requireAuthenticatedUser(request, response)) return;
    if (!requireJourneyValue(request, response, "activity", "/submit/activity")) return;

    response.render("journey/intensity", {
      intensities,
      activityName: selectedActivityName(journey(request)),
      values: { intensity: journey(request).intensity },
      backHref: isChangingAnswer(request) ? "/submit/check" : "/submit/activity",
      formAction: journeyUrl("/submit/intensity", request)
    });
  });

  app.post("/submit/intensity", (request, response) => {
    if (!requireAuthenticatedUser(request, response)) return;
    if (!requireJourneyValue(request, response, "activity", "/submit/activity")) return;
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
          activityName: selectedActivityName(journey(request)),
          backHref: isChangingAnswer(request) ? "/submit/check" : "/submit/activity",
          formAction: journeyUrl("/submit/intensity", request)
        }
      );
    }

    journey(request).intensity = parsed.data.intensity;
    return response.redirect(303, isChangingAnswer(request) ? "/submit/check" : "/submit/duration");
  });

  app.get("/submit/duration", (request, response) => {
    if (!requireAuthenticatedUser(request, response)) return;
    if (!requireJourneyValue(request, response, "intensity", "/submit/intensity")) return;

    response.render("journey/duration", {
      values: { durationMinutes: journey(request).durationMinutes },
      backHref: isChangingAnswer(request) ? "/submit/check" : "/submit/intensity",
      formAction: journeyUrl("/submit/duration", request)
    });
  });

  app.post("/submit/duration", async (request, response, next) => {
    const user = requireAuthenticatedUser(request, response);
    if (!user) return;
    if (!requireJourneyValue(request, response, "intensity", "/submit/intensity")) return;
    const parsed = durationSchema.safeParse(request.body);

    if (!parsed.success) {
      return renderFieldError(
        response,
        "journey/duration",
        parsed.error,
        "durationMinutes",
        request.body,
        {
          backHref: isChangingAnswer(request) ? "/submit/check" : "/submit/intensity",
          formAction: journeyUrl("/submit/duration", request)
        }
      );
    }

    const session = journey(request);
    session.durationMinutes = parsed.data.durationMinutes;
    return response.redirect(303, "/submit/check");
  });

  app.get("/submit/check", (request, response) => {
    const user = requireAuthenticatedUser(request, response);
    if (!user) return;
    if (!requireJourneyValue(request, response, "activity", "/submit")) return;
    if (!requireJourneyValue(request, response, "intensity", "/submit/activity")) return;
    if (!requireJourneyValue(request, response, "durationMinutes", "/submit/duration")) return;

    const session = journey(request);
    const result = convertActivityToSteps({
      displayName: user.displayName,
      activity: session.activity!,
      otherActivity: session.otherActivity,
      intensity: session.intensity!,
      durationMinutes: session.durationMinutes!
    });
    response.render("journey/check", { result });
  });

  app.post("/submit/check", async (request, response, next) => {
    const user = requireAuthenticatedUser(request, response);
    if (!user) return;
    if (!requireJourneyValue(request, response, "activity", "/submit")) return;
    if (!requireJourneyValue(request, response, "intensity", "/submit/activity")) return;
    if (!requireJourneyValue(request, response, "durationMinutes", "/submit/duration")) return;

    const session = journey(request);
    const result = convertActivityToSteps({
      displayName: user.displayName,
      activity: session.activity!,
      otherActivity: session.otherActivity,
      intensity: session.intensity!,
      durationMinutes: session.durationMinutes!
    });

    try {
      await repository.save(result, user.id);
      session.result = result;
      return response.redirect(303, "/submit/result");
    } catch (error) {
      return next(error);
    }
  });

  app.get("/submit/result", (request, response) => {
    if (!requireAuthenticatedUser(request, response)) return;
    if (!requireJourneyValue(request, response, "result", "/submit")) return;
    response.render("result", { result: journey(request).result });
  });

  app.get("/submit/reset", (request, response) => {
    const currentUser = journey(request).user;
    request.session = currentUser ? { user: currentUser } : {};
    response.redirect(303, "/submit");
  });

  app.get("/about", (_request, response) => {
    response.render("about");
  });

  app.get("/login", (_request, response) => {
    response.render("account/login");
  });

  app.get("/account", (request, response) => {
    const user = requireAuthenticatedUser(request, response);
    if (!user) return;

    response.render("account/details", { user });
  });

  app.get("/account/activities", async (request, response, next) => {
    const user = requireAuthenticatedUser(request, response);
    if (!user) return;

    try {
      const submittedActivities = (await repository.listForUser(user.id)).map((activity) => ({
        ...activity,
        submittedOn: new Intl.DateTimeFormat("en-GB", {
          day: "numeric",
          month: "long",
          year: "numeric",
          timeZone: "UTC"
        }).format(new Date(activity.createdAt))
      }));
      return response.render("account/activities", {
        submittedActivities,
        pageHeading: "Your submitted activities",
        backHref: "/account",
        emptyMessage: "You have not submitted any activities yet.",
        showSubmitLink: true
      });
    } catch (error) {
      return next(error);
    }
  });

  app.get("/account/change-password", (request, response) => {
    if (!requireAuthenticatedUser(request, response)) return;
    response.render("account/change-password");
  });

  app.post("/account/change-password", async (request, response, next) => {
    const user = requireAuthenticatedUser(request, response);
    if (!user) return;
    const parsed = changePasswordSchema.safeParse(request.body);

    if (!parsed.success) {
      return renderFieldError(
        response,
        "account/change-password",
        parsed.error,
        "currentPassword"
      );
    }

    try {
      await authentication.changePassword(
        user.id,
        user.email,
        parsed.data.currentPassword,
        parsed.data.newPassword
      );
      user.mustChangePassword = false;
      return response.redirect(303, "/account/password-changed");
    } catch (error) {
      if (error instanceof IncorrectPasswordError) {
        return response.status(400).render("account/change-password", {
          errorMessage: error.message,
          errorField: "currentPassword",
          errors: [{ text: error.message, href: "#currentPassword" }]
        });
      }
      return next(error);
    }
  });

  app.get("/account/password-changed", (request, response) => {
    if (!requireAuthenticatedUser(request, response)) return;
    response.render("account/password-changed");
  });

  const renderTeams = async (
    response: Response,
    userId: string,
    status = 200,
    context: Record<string, unknown> = {}
  ) => response.status(status).render("teams/index", {
    overview: await teams.getOverview(userId),
    ...context
  });

  app.get("/teams", async (request, response, next) => {
    const user = requireAuthenticatedUser(request, response);
    if (!user) return;
    try {
      const [allTeams, overview] = await Promise.all([
        teams.listAll(),
        teams.getOverview(user.id)
      ]);
      return response.render("teams/all", { teams: allTeams, overview });
    }
    catch (error) { return next(error); }
  });

  app.get("/teams/scoreboard", async (request, response, next) => {
    if (!requireAuthenticatedUser(request, response)) return;
    const now = new Date();
    const monthStart = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-01`;
    const monthLabel = new Intl.DateTimeFormat("en-GB", {
      month: "long",
      year: "numeric",
      timeZone: "UTC"
    }).format(now);

    try {
      return response.render("teams/scoreboard", {
        entries: await teams.listMonthlyScores(monthStart),
        monthLabel
      });
    } catch (error) { return next(error); }
  });

  app.get("/teams/manage", async (request, response, next) => {
    const user = requireAuthenticatedUser(request, response);
    if (!user) return;
    try { return await renderTeams(response, user.id); }
    catch (error) { return next(error); }
  });

  app.get("/teams/create", async (request, response, next) => {
    const user = requireAuthenticatedUser(request, response);
    if (!user) return;
    try {
      const overview = await teams.getOverview(user.id);
      if (overview.team) return response.redirect(303, "/teams/manage");
      return response.render("teams/create");
    } catch (error) { return next(error); }
  });

  app.post("/teams/create", async (request, response, next) => {
    const user = requireAuthenticatedUser(request, response);
    if (!user) return;
    const parsed = teamNameSchema.safeParse(request.body);
    if (!parsed.success) {
      const message = parsed.error.issues[0]?.message ?? "Enter a team name";
      return response.status(400).render("teams/create", {
        values: request.body,
        fieldErrors: { teamName: message },
        errors: [{ text: message, href: "#teamName" }]
      });
    }
    try {
      await teams.create(user.id, parsed.data.teamName);
      return response.redirect(303, "/teams/manage");
    } catch (error) {
      if (!(error instanceof TeamOperationError)) return next(error);
      return response.status(400).render("teams/create", {
        values: request.body,
        fieldErrors: { teamName: error.message },
        errors: [{ text: error.message, href: "#teamName" }]
      });
    }
  });

  app.post("/teams/invite", async (request, response, next) => {
    const user = requireAuthenticatedUser(request, response);
    if (!user) return;
    const parsed = teamInvitationSchema.safeParse(request.body);
    if (!parsed.success) {
      const message = parsed.error.issues[0]?.message ?? "Enter a display name";
      try {
        return await renderTeams(response, user.id, 400, {
          values: request.body,
          fieldErrors: { displayName: message },
          errors: [{ text: message, href: "#displayName" }]
        });
      } catch (error) { return next(error); }
    }
    try {
      await teams.invite(user.id, parsed.data.displayName);
      return response.redirect(303, "/teams/manage");
    } catch (error) {
      if (!(error instanceof TeamOperationError)) return next(error);
      return await renderTeams(response, user.id, 400, {
        values: request.body,
        fieldErrors: { displayName: error.message },
        errors: [{ text: error.message, href: "#displayName" }]
      });
    }
  });

  app.post("/teams/invitations/:id/accept", async (request, response, next) => {
    const user = requireAuthenticatedUser(request, response);
    if (!user) return;
    try {
      await teams.respondToInvitation(user.id, request.params.id, true);
      return response.redirect(303, "/teams/manage");
    } catch (error) {
      if (!(error instanceof TeamOperationError)) return next(error);
      return await renderTeams(response, user.id, 400, {
        errors: [{ text: error.message, href: "#team-invitations" }]
      });
    }
  });

  app.post("/teams/invitations/:id/decline", async (request, response, next) => {
    const user = requireAuthenticatedUser(request, response);
    if (!user) return;
    try {
      await teams.respondToInvitation(user.id, request.params.id, false);
      return response.redirect(303, "/teams/manage");
    } catch (error) { return next(error); }
  });

  app.get("/teams/disband", async (request, response, next) => {
    const user = requireAuthenticatedUser(request, response);
    if (!user) return;
    try {
      const overview = await teams.getOverview(user.id);
      if (!overview.team) return response.status(404).render("404");
      return response.render("teams/disband", { team: overview.team });
    } catch (error) { return next(error); }
  });

  app.post("/teams/disband", async (request, response, next) => {
    const user = requireAuthenticatedUser(request, response);
    if (!user) return;
    try {
      await teams.disband(user.id);
      return response.redirect(303, "/teams");
    } catch (error) { return next(error); }
  });

  app.get("/teams/leave", async (request, response, next) => {
    const user = requireAuthenticatedUser(request, response);
    if (!user) return;
    try {
      const overview = await teams.getOverview(user.id);
      if (!overview.team) return response.status(404).render("404");
      return response.render("teams/leave", { team: overview.team });
    } catch (error) { return next(error); }
  });

  app.post("/teams/leave", async (request, response, next) => {
    const user = requireAuthenticatedUser(request, response);
    if (!user) return;
    try {
      await teams.leave(user.id);
      return response.redirect(303, "/teams");
    } catch (error) { return next(error); }
  });

  app.get("/teams/:id", async (request, response, next) => {
    const user = requireAuthenticatedUser(request, response);
    if (!user) return;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(request.params.id)) {
      return response.status(404).render("404");
    }

    try {
      const [team, overview] = await Promise.all([
        teams.findById(request.params.id),
        teams.getOverview(user.id)
      ]);
      if (!team) return response.status(404).render("404");
      return response.render("teams/show", {
        team,
        canJoin: !overview.team && team.members.length < 5,
        isCurrentTeam: overview.team?.id === team.id
      });
    } catch (error) { return next(error); }
  });

  app.post("/teams/:id/join", async (request, response, next) => {
    const user = requireAuthenticatedUser(request, response);
    if (!user) return;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(request.params.id)) {
      return response.status(404).render("404");
    }

    try {
      await teams.join(user.id, request.params.id);
      return response.redirect(303, "/teams/manage");
    } catch (error) {
      if (!(error instanceof TeamOperationError)) return next(error);
      const team = await teams.findById(request.params.id);
      if (!team) return response.status(404).render("404");
      return response.status(400).render("teams/show", {
        team,
        canJoin: true,
        isCurrentTeam: false,
        errors: [{ text: error.message, href: "#join-team" }]
      });
    }
  });

  app.post("/login", async (request, response, next) => {
    const parsed = emailSchema.and(signInPasswordSchema).safeParse(request.body);

    if (!parsed.success) {
      return renderFieldErrors(
        response,
        "account/login",
        parsed.error,
        ["email", "password"],
        request.body
      );
    }

    const email = normaliseEmail(parsed.data.email);
    if (!isAllowedEmail(email, allowedEmailDomain)) {
      return renderInvalidCredentials(response, email);
    }

    try {
      const user = await authentication.signIn(email, parsed.data.password);
      if (user.status === "pending") {
        return response.status(403).render("account/access-pending");
      }
      if (user.status !== "approved") return response.status(403).render("account/access-unavailable");
      journey(request).user = user;
      return response.redirect(303, "/");
    } catch (_error) {
      return renderInvalidCredentials(response, email);
    }
  });

  app.post("/logout", (request, response) => {
    request.session = null;
    response.redirect(303, "/");
  });

  app.get("/request-access", (_request, response) => response.render("account/request-access"));
  app.post("/request-access", async (request, response, next) => {
    const parsed = emailSchema.and(displayNameSchema).and(passwordSchema).safeParse(request.body);
    if (!parsed.success) {
      return renderFieldErrors(
        response,
        "account/request-access",
        parsed.error,
        ["displayName", "email", "password"],
        request.body
      );
    }
    const email = normaliseEmail(parsed.data.email);
    if (!isAllowedEmail(email, allowedEmailDomain)) {
      return response.render("account/access-requested");
    }
    try {
      await authentication.requestAccess(email, parsed.data.displayName, parsed.data.password);
      return response.render("account/access-requested");
    } catch (error) {
      if (error instanceof DisplayNameTakenError) {
        return response.status(400).render("account/request-access", {
          values: { displayName: parsed.data.displayName, email },
          fieldErrors: { displayName: error.message },
          errors: [{ text: error.message, href: "#displayName" }]
        });
      }
      return next(error);
    }
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

  app.get("/admin/users/:id/delete", async (request, response, next) => {
    if (!requireAdmin(request, response)) return;
    try {
      const user = (await authentication.listUsers()).find(({ id }) => id === request.params.id);
      if (!user) return response.status(404).render("404");
      return response.render("account/delete-user", { user });
    } catch (error) { return next(error); }
  });

  app.post("/admin/users/:id/delete", async (request, response, next) => {
    if (!requireAdmin(request, response)) return;
    try {
      await authentication.deleteUser(request.params.id);
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
      const entries = (await repository.listMonthly(monthStart)).map((entry) => ({
        ...entry,
        activitiesHref: `/users/${encodeURIComponent(entry.displayName)}/activities`
      }));
      return response.render("scoreboard", { entries, monthLabel });
    } catch (error) {
      return next(error);
    }
  });

  app.get("/users/:displayName/activities", async (request, response, next) => {
    if (!requireAuthenticatedUser(request, response)) return;
    const parsed = displayNameSchema.safeParse({ displayName: request.params.displayName });
    if (!parsed.success) return response.status(404).render("404");

    try {
      const submittedActivities = (await repository.listForDisplayName(parsed.data.displayName))
        .map((activity) => ({
          ...activity,
          submittedOn: new Intl.DateTimeFormat("en-GB", {
            day: "numeric",
            month: "long",
            year: "numeric",
            timeZone: "UTC"
          }).format(new Date(activity.createdAt))
        }));
      return response.render("account/activities", {
        submittedActivities,
        pageHeading: `Activities submitted by ${parsed.data.displayName}`,
        backHref: "/scoreboard",
        emptyMessage: "This user has not submitted any activities yet.",
        showSubmitLink: false
      });
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
