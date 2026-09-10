import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/create-app.js";
import {
  DisplayNameTakenError,
  IncorrectPasswordError,
  type AuthenticationService
} from "../src/persistence/authentication.js";
import type { ConversionRepository } from "../src/persistence/conversion-repository.js";
import type { TeamRepository } from "../src/persistence/team-repository.js";

function repositoryWith(overrides: Partial<ConversionRepository> = {}): ConversionRepository {
  return {
    save: vi.fn().mockResolvedValue(undefined),
    listMonthly: vi.fn().mockResolvedValue([]),
    listForUser: vi.fn().mockResolvedValue([]),
    listForDisplayName: vi.fn().mockResolvedValue([]),
    ...overrides
  };
}

function teamsWith(overrides: Partial<TeamRepository> = {}): TeamRepository {
  return {
    getOverview: vi.fn().mockResolvedValue({ invitations: [] }),
    listAll: vi.fn().mockResolvedValue([]),
    listMonthlyScores: vi.fn().mockResolvedValue([]),
    findById: vi.fn().mockResolvedValue(undefined),
    create: vi.fn().mockResolvedValue(undefined),
    join: vi.fn().mockResolvedValue(undefined),
    invite: vi.fn().mockResolvedValue(undefined),
    respondToInvitation: vi.fn().mockResolvedValue(undefined),
    leave: vi.fn().mockResolvedValue(undefined),
    disband: vi.fn().mockResolvedValue(undefined),
    ...overrides
  };
}

const authentication: AuthenticationService = {
  signIn: vi.fn().mockResolvedValue({
    id: "9c81e9d8-6dce-4cb1-9a07-71c1e884c1b7",
    email: "alex@opencastsoftware.com",
    displayName: "Alex",
    mustChangePassword: false,
    status: "approved"
  }),
  changePassword: vi.fn().mockResolvedValue(undefined),
  requestAccess: vi.fn().mockResolvedValue(undefined),
  approveUser: vi.fn().mockResolvedValue(undefined),
  deactivateUser: vi.fn().mockResolvedValue(undefined),
  reactivateUser: vi.fn().mockResolvedValue(undefined),
  deleteUser: vi.fn().mockResolvedValue(undefined),
  listUsers: vi.fn().mockResolvedValue([])
};

function testApp(
  repository: ConversionRepository = repositoryWith(),
  teams: TeamRepository = teamsWith()
) {
  return createApp(repository, authentication, teams);
}

async function signIn(agent: ReturnType<typeof request.agent>) {
  await agent.post("/login").type("form").send({
    email: "alex@opencastsoftware.com",
    password: "A-safe-test-password1!"
  });
}

describe("Move It application", () => {
  beforeEach(() => {
    vi.mocked(authentication.signIn).mockResolvedValue({
      id: "9c81e9d8-6dce-4cb1-9a07-71c1e884c1b7",
      email: "alex@opencastsoftware.com",
      displayName: "Alex",
      mustChangePassword: false,
      status: "approved"
    });
  });

  it("renders a homepage with the main service links", async () => {
    const response = await request(createApp()).get("/");

    expect(response.status).toBe(200);
    expect(response.text).toContain("Submit an activity");
    expect(response.text).toContain("View the monthly scoreboard");
    expect(response.text).toContain("View conversions");
    expect(response.text).toContain("Learn more about Move It");
    expect(response.text).toContain("Submit activity");
    expect(response.text).toContain('href="/login"');
    expect(response.text).toContain(">Account</a>");
    expect(response.text).toContain('href="/admin/login">Administrator sign in</a>');
    expect(response.text).toContain('aria-current="page"');
  });

  it("adds Vercel Analytics to pages deployed on Vercel", async () => {
    const priorVercel = process.env.VERCEL;
    process.env.VERCEL = "1";

    try {
      const response = await request(createApp()).get("/");
      expect(response.text).toContain('src="/_vercel/insights/script.js"');
    } finally {
      if (priorVercel === undefined) delete process.env.VERCEL;
      else process.env.VERCEL = priorVercel;
    }
  });

  it("renders an accessible mobile bottom navigation", async () => {
    const response = await request(createApp()).get("/");

    expect(response.status).toBe(200);
    expect(response.text).toContain('class="app-mobile-navigation"');
    expect(response.text).toContain('aria-label="Primary navigation"');
    expect(response.text).toContain("app-mobile-navigation__link--current");
    expect(response.text).toContain('href="/teams"');
    expect(response.text).toContain(">Teams</span>");
    expect(response.text).toContain('href="/about">How it works</a>');
  });

  it("starts the conversion with the activity question and uses the account display name", async () => {
    const agent = request.agent(testApp());
    await signIn(agent);
    const response = await agent.get("/submit");

    expect(response.status).toBe(200);
    expect(response.text).toContain("What activity did you do?");
    expect(response.text).toContain('src="/images/opencast-logo.png"');
    expect(response.text).toContain('alt="Opencast"');
    expect(response.text).toContain('class="app-header__brand-stripe"');
    expect(response.text).toContain('/styles/application.css?v=');
    expect(response.text).toContain("Move It by");
    expect(response.text).toContain('class="app-footer__logo-link" href="/"');
    expect(response.text).toContain('class="app-footer__logo"');
    expect(response.text).toContain("How it works");
    expect(response.text).not.toContain("What is your display name?");
    expect(response.text).not.toContain("Crown copyright");
  });

  it("redirects old conversion URLs to the submission journey", async () => {
    const page = await request(testApp()).get("/convert/activity?from=check");
    const form = await request(testApp()).post("/convert/activity").type("form").send({
      activity: "walking"
    });

    expect(page.status).toBe(308);
    expect(page.headers.location).toBe("/submit/activity?from=check");
    expect(form.status).toBe(308);
    expect(form.headers.location).toBe("/submit/activity");
  });

  it("does not cache generated styles during development", async () => {
    const response = await request(createApp()).get("/styles/application.css");

    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toContain("max-age=0");
    expect(response.text).toContain(".app-header__brand-stripe");
    expect(response.text).toContain("background:#6e4ba2");
    expect(response.text).toContain("height:8px");
  });

  it("serves the GOV.UK JavaScript used by interactive components", async () => {
    const response = await request(createApp()).get("/assets/javascripts/govuk-frontend.min.js");

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toContain("javascript");
    expect(response.text).toContain("PasswordInput");
  });

  it("validates activity, intensity and duration values", async () => {
    const agent = request.agent(testApp());
    await signIn(agent);

    const invalidActivity = await agent
      .post("/submit/activity")
      .type("form")
      .send({ activity: "not-an-activity" });
    expect(invalidActivity.status).toBe(400);
    expect(invalidActivity.text).toContain("Select an activity");

    const missingOtherActivity = await agent
      .post("/submit/activity")
      .type("form")
      .send({ activity: "other", otherActivity: "" });
    expect(missingOtherActivity.status).toBe(400);
    expect(missingOtherActivity.text).toContain("Enter the other activity");
    expect(missingOtherActivity.text).toContain('href="#otherActivity"');
    expect(missingOtherActivity.text).toContain('id="otherActivity-error"');
    expect(missingOtherActivity.text).toContain(
      'id="other-activity-container" class="app-select-conditional"'
    );

    await agent.post("/submit/activity").type("form").send({ activity: "football" });

    const invalidIntensity = await agent
      .post("/submit/intensity")
      .type("form")
      .send({ intensity: "extreme" });
    expect(invalidIntensity.status).toBe(400);
    expect(invalidIntensity.text).toContain("Select an intensity");

    await agent.post("/submit/intensity").type("form").send({ intensity: "moderate" });

    const blankDuration = await agent
      .post("/submit/duration")
      .type("form")
      .send({ durationMinutes: "" });
    expect(blankDuration.status).toBe(400);
    expect(blankDuration.text).toContain("Enter the duration in minutes");

    const decimalDuration = await agent
      .post("/submit/duration")
      .type("form")
      .send({ durationMinutes: "12.5" });
    expect(decimalDuration.status).toBe(400);
    expect(decimalDuration.text).toContain("Duration must be a whole number");

    const excessiveDuration = await agent
      .post("/submit/duration")
      .type("form")
      .send({ durationMinutes: "1441" });
    expect(excessiveDuration.status).toBe(400);
    expect(excessiveDuration.text).toContain("Duration must be 1,440 minutes or less");
  });

  it("retains the name of an Other activity", async () => {
    const agent = request.agent(testApp());
    await signIn(agent);

    const activityPage = await agent.get("/submit/activity");
    expect(activityPage.text).toContain('<option value="other">Other</option>');
    expect(activityPage.text).toContain('data-module="app-conditional-select"');
    expect(activityPage.text).toContain('aria-controls="other-activity-container"');
    expect(activityPage.text).toContain(
      'id="other-activity-container" class="app-select-conditional app-select-conditional--hidden"'
    );
    expect(activityPage.text).toContain('for="otherActivity"');
    expect(activityPage.text).toContain("Other");

    const activityResponse = await agent
      .post("/submit/activity")
      .type("form")
      .send({ activity: "other", otherActivity: "Pilates" });
    expect(activityResponse.status).toBe(303);
    expect(activityResponse.headers.location).toBe("/submit/intensity");

    const intensityPage = await agent.get("/submit/intensity");
    expect(intensityPage.text).toContain("How intense was your pilates session?");
  });

  it("completes the multi-page journey and persists the result", async () => {
    const repository = repositoryWith();
    const agent = request.agent(testApp(repository));
    await signIn(agent);

    const activityPage = await agent.get("/submit/activity");
    expect(activityPage.text).toContain("What activity did you do?");

    const activityResponse = await agent
      .post("/submit/activity")
      .type("form")
      .send({ activity: "swimming" });
    expect(activityResponse.headers.location).toBe("/submit/intensity");

    const intensityPage = await agent.get("/submit/intensity");
    expect(intensityPage.text).toContain("How intense was your swimming session?");
    const intensityHeadingPosition = intensityPage.text.indexOf("How intense was your swimming session?");
    const intensityInsetPosition = intensityPage.text.indexOf("Intensity varies and is different for everyone");
    const intensityOptionPosition = intensityPage.text.indexOf('class="govuk-radios__item"');
    expect(intensityInsetPosition).toBeGreaterThan(intensityHeadingPosition);
    expect(intensityOptionPosition).toBeGreaterThan(intensityInsetPosition);

    const intensityResponse = await agent
      .post("/submit/intensity")
      .type("form")
      .send({ intensity: "vigorous" });
    expect(intensityResponse.headers.location).toBe("/submit/duration");

    const durationPage = await agent.get("/submit/duration");
    expect(durationPage.text).toContain("How long did the activity last?");
    expect(durationPage.text).toContain('inputmode="numeric"');
    expect(durationPage.text).toContain('maxlength="4"');
    expect(durationPage.text).toContain('pattern="[0-9]*"');

    const durationResponse = await agent
      .post("/submit/duration")
      .type("form")
      .send({ durationMinutes: "20" });
    expect(durationResponse.status).toBe(303);
    expect(durationResponse.headers.location).toBe("/submit/check");

    const checkPage = await agent.get("/submit/check");
    expect(checkPage.status).toBe(200);
    expect(checkPage.text).toContain("Check your answers before submitting");
    expect(checkPage.text).toContain("4200 steps");
    expect(repository.save).not.toHaveBeenCalled();

    const changeDurationPage = await agent.get("/submit/duration?from=check");
    expect(changeDurationPage.status).toBe(200);
    expect(changeDurationPage.text).toContain('href="/submit/check"');
    expect(changeDurationPage.text).toContain('action="/submit/duration?from=check"');

    const submission = await agent.post("/submit/check");
    expect(submission.status).toBe(303);
    expect(submission.headers.location).toBe("/submit/result");

    const resultPage = await agent.get("/submit/result");
    expect(resultPage.status).toBe(200);
    expect(resultPage.text).toContain("4200 steps");
    expect(repository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        displayName: "Alex",
        activity: "swimming",
        intensity: "vigorous",
        durationMinutes: 20,
        estimatedSteps: 4200
      }),
      "9c81e9d8-6dce-4cb1-9a07-71c1e884c1b7"
    );
  });

  it("redirects unauthenticated users to sign in", async () => {
    const response = await request(testApp()).get("/submit/duration");

    expect(response.status).toBe(303);
    expect(response.headers.location).toBe("/login");
  });

  it("requires sign-in to view the monthly scoreboard", async () => {
    const response = await request(testApp()).get("/scoreboard");

    expect(response.status).toBe(303);
    expect(response.headers.location).toBe("/login");
  });

  it("shows individual and team scoreboard cards on the monthly scoreboard landing page", async () => {
    const agent = request.agent(testApp());
    await signIn(agent);

    const response = await agent.get("/scoreboard");
    expect(response.status).toBe(200);
    expect(response.text).toContain("Monthly scoreboard");
    expect(response.text).toContain('href="/scoreboard/individual"');
    expect(response.text).toContain("Individual scoreboard");
    expect(response.text).toContain('href="/scoreboard/teams"');
    expect(response.text).toContain("Team scoreboard");
    expect(response.text).toContain('href="/" class="govuk-back-link"');
    expect(response.text).toContain('href="/scoreboard" aria-current="page"');
  });

  it("renders the monthly scoreboard", async () => {
    const repository = repositoryWith({
      listMonthly: vi.fn().mockResolvedValue([
        { rank: 1, displayName: "Morgan", totalSteps: 8400, activityCount: 2 }
      ])
    });

    const agent = request.agent(testApp(repository));
    await signIn(agent);
    const response = await agent.get("/scoreboard/individual");

    expect(response.status).toBe(200);
    expect(response.text).toContain("Individual monthly scoreboard");
    expect(response.text).toContain("Morgan");
    expect(response.text).toContain("8400");
    expect(response.text).toContain('href="/users/Morgan/activities"');
    expect(response.text).toContain("View<span class=\"govuk-visually-hidden\"> activities submitted by Morgan</span>");
    expect(response.text).not.toContain("There are no recorded activities this month yet.");
  });

  it("shows another user's activities from the monthly scoreboard", async () => {
    const repository = repositoryWith({
      listForDisplayName: vi.fn().mockResolvedValue([{
        id: "record-id",
        activityName: "Running",
        intensity: "vigorous",
        durationMinutes: 20,
        estimatedSteps: 4600,
        createdAt: "2026-09-08T09:00:00.000Z"
      }])
    });
    const agent = request.agent(testApp(repository));
    await signIn(agent);

    const response = await agent.get("/users/Morgan/activities");

    expect(response.status).toBe(200);
    expect(repository.listForDisplayName).toHaveBeenCalledWith("Morgan");
    expect(response.text).toContain("Activities submitted by Morgan");
    expect(response.text).toContain("8 September 2026");
    expect(response.text).toContain("Running");
    expect(response.text).toContain("Vigorous");
    expect(response.text).toContain("20 minutes");
    expect(response.text).toContain("4600");
    expect(response.text).toContain('href="/scoreboard/individual"');
  });

  it("requires sign-in to view another user's activities", async () => {
    const response = await request(testApp()).get("/users/Morgan/activities");

    expect(response.status).toBe(303);
    expect(response.headers.location).toBe("/login");
  });

  it("renders an empty scoreboard when there are no saved entries", async () => {
    const agent = request.agent(testApp());
    await signIn(agent);
    const response = await agent.get("/scoreboard/individual");

    expect(response.status).toBe(200);
    expect(response.text).toContain("There are no recorded activities this month yet.");
    expect(response.text).not.toContain("This is sample data");
    expect(response.text).not.toContain("48250");
  });

  it("renders an explanation page from the service navigation", async () => {
    const response = await request(createApp()).get("/about");

    expect(response.status).toBe(200);
    expect(response.text).toContain("How Move It works");
    expect(response.text).toContain("illustrative estimates");
    expect(response.text).toContain("Getting access");
    expect(response.text).toContain("Submitting an activity");
    expect(response.text).toContain("Monthly scoreboards");
    expect(response.text).toContain("A team can have up to 5 members");
    expect(response.text).toContain("join an existing team directly");
    expect(response.text).toContain('href="/scoreboard"');
    expect(response.text).toContain('href="/teams"');
    expect(response.text).toContain('href="/about">How it works</a>');
  });

  it("renders the one-hour conversion guide from the shared rates", async () => {
    const response = await request(createApp()).get("/conversions");

    expect(response.status).toBe(200);
    expect(response.text).toContain("Activity conversion guide");
    expect(response.text).toContain("Cycling");
    expect(response.text).toContain("Football");
    expect(response.text).toContain("Running");
    expect(response.text).toContain("Strength training");
    expect(response.text).toContain("Walking");
    expect(response.text).toContain("9000");
    expect(response.text).toContain("12000");
    expect(response.text).toContain('href="/" class="govuk-back-link"');
    expect(response.text).toContain('aria-current="page"');
  });

  it("renders the approved-members account page", async () => {
    const login = await request(testApp()).get("/login");
    const signup = await request(testApp()).get("/signup");

    expect(login.status).toBe(200);
    expect(login.text).toContain("Sign in");
    expect(login.text).toContain("Do you need access?");
    expect(login.text).toContain('href="/request-access">request access</a>');
    expect(login.text).toContain("An administrator will review your request.");
    expect(login.text).toContain('data-module="govuk-password-input"');
    expect(login.text).toContain('aria-controls="password"');
    expect(login.text).toContain('aria-label="Show password"');
    expect(login.text).toContain("app-password-toggle");
    expect(login.text).toContain("app-login-email-input");
    expect(signup.status).toBe(303);
    expect(signup.headers.location).toBe("/login");
  });

  it("signs in an invited user and signs out", async () => {
    const agent = request.agent(testApp());

    const login = await agent.post("/login").type("form").send({
      email: "alex@opencastsoftware.com",
      password: "A-safe-test-password1!"
    });
    expect(login.status).toBe(303);
    expect(login.headers.location).toBe("/");
    expect(authentication.signIn).toHaveBeenCalled();

    const signedIn = await agent.get("/");
    expect(signedIn.text).toContain("Alex");
    expect(signedIn.text).toContain('href="/account"');
    expect(signedIn.text).toContain("Sign out");
    expect(signedIn.text).toContain('class="app-service-account__sign-out" action="/logout"');

    const logout = await agent.post("/logout").type("form").send({});
    expect(logout.status).toBe(303);

    const signedOut = await agent.get("/");
    expect(signedOut.text).toContain(">Account</a>");
    expect(signedOut.text).not.toContain("Sign out");
  });

  it("lets a signed-in user view their account details", async () => {
    const agent = request.agent(testApp());
    await signIn(agent);

    const response = await agent.get("/account");

    expect(response.status).toBe(200);
    expect(response.text).toContain("Your account");
    expect(response.text).toContain("Display name");
    expect(response.text).toContain("Alex");
    expect(response.text).toContain("Email address");
    expect(response.text).toContain("alex@opencastsoftware.com");
    expect(response.text).toContain('href="/account/activities"');
    expect(response.text).toContain('href="/account/change-password"');
    expect(response.text).toContain('href="/account" aria-current="page"');
  });

  it("lets a user create a team when they are not already in one", async () => {
    const teamRepository = teamsWith();
    const agent = request.agent(testApp(repositoryWith(), teamRepository));
    await signIn(agent);

    const page = await agent.get("/teams");
    expect(page.status).toBe(200);
    expect(page.text).toContain("<h1 class=\"govuk-heading-xl\">Teams</h1>");
    expect(page.text).toContain("Create a team");
    expect(page.text).toContain('href="/teams/create"');
    expect(page.text).not.toContain('action="/teams/create"');
    expect(page.text).toContain('href="/" class="govuk-back-link"');
    expect(page.text).toContain('href="/teams" aria-current="page"');

    const createPage = await agent.get("/teams/create");
    expect(createPage.status).toBe(200);
    expect(createPage.text).toContain("Creating a team makes you its first member");
    expect(createPage.text).toContain('action="/teams/create"');
    expect(createPage.text).toContain('id="teamName"');

    const response = await agent.post("/teams/create").type("form").send({ teamName: "Movers" });
    expect(response.status).toBe(303);
    expect(response.headers.location).toBe("/teams/manage");
    expect(teamRepository.create).toHaveBeenCalledWith(
      "9c81e9d8-6dce-4cb1-9a07-71c1e884c1b7",
      "Movers"
    );
  });

  it("shows a team and lets any member invite someone or disband it", async () => {
    const teamId = "13845b5d-e982-4c7d-906c-9c32ed90d810";
    const teamRepository = teamsWith({
      getOverview: vi.fn().mockResolvedValue({
        team: {
          id: teamId,
          name: "Movers",
          members: [
            { id: "9c81e9d8-6dce-4cb1-9a07-71c1e884c1b7", displayName: "Alex" },
            { id: "member-id", displayName: "Sam" }
          ],
          pendingInvitations: []
        },
        invitations: []
      }),
      findById: vi.fn().mockResolvedValue({
        id: teamId,
        name: "Movers",
        members: [
          { id: "9c81e9d8-6dce-4cb1-9a07-71c1e884c1b7", displayName: "Alex" },
          { id: "member-id", displayName: "Sam" }
        ]
      })
    });
    const agent = request.agent(testApp(repositoryWith(), teamRepository));
    await signIn(agent);

    const directory = await agent.get("/teams");
    expect(directory.text).toContain('href="/teams/manage"');

    const page = await agent.get("/teams/manage");
    expect(page.text).toContain("Manage your team");
    expect(page.text).toContain("Movers");
    expect(page.text).toContain("Alex");
    expect(page.text).toContain("Sam");
    expect(page.text).toContain("Send invitation");
    expect(page.text).toContain('href="/teams/leave"');
    expect(page.text).toContain('href="/teams/disband"');

    const teamPage = await agent.get(`/teams/${teamId}`);
    expect(teamPage.text).toContain('href="/teams/manage"');
    expect(teamPage.text).not.toContain(`action="/teams/${teamId}/join"`);

    const createPage = await agent.get("/teams/create");
    expect(createPage.status).toBe(303);
    expect(createPage.headers.location).toBe("/teams/manage");

    const invitation = await agent.post("/teams/invite").type("form").send({ displayName: "Morgan" });
    expect(invitation.status).toBe(303);
    expect(teamRepository.invite).toHaveBeenCalledWith(
      "9c81e9d8-6dce-4cb1-9a07-71c1e884c1b7",
      "Morgan"
    );

    const leaveConfirmation = await agent.get("/teams/leave");
    expect(leaveConfirmation.status).toBe(200);
    expect(leaveConfirmation.text).toContain("Leave Movers?");
    expect(leaveConfirmation.text).toContain("submitted activities will not be deleted");
    const leave = await agent.post("/teams/leave");
    expect(leave.status).toBe(303);
    expect(leave.headers.location).toBe("/teams");
    expect(teamRepository.leave).toHaveBeenCalledWith(
      "9c81e9d8-6dce-4cb1-9a07-71c1e884c1b7"
    );

    const confirmation = await agent.get("/teams/disband");
    expect(confirmation.text).toContain("Disband Movers?");
    expect(confirmation.text).toContain("submitted activities will not be deleted");
    const disband = await agent.post("/teams/disband");
    expect(disband.status).toBe(303);
    expect(teamRepository.disband).toHaveBeenCalledWith(
      "9c81e9d8-6dce-4cb1-9a07-71c1e884c1b7"
    );
  });

  it("lets a user accept or decline a team invitation", async () => {
    const teamRepository = teamsWith({
      getOverview: vi.fn().mockResolvedValue({
        invitations: [{ id: "invitation-id", teamName: "Movers" }]
      })
    });
    const agent = request.agent(testApp(repositoryWith(), teamRepository));
    await signIn(agent);

    const directory = await agent.get("/teams");
    expect(directory.text).toContain("View team invitations");

    const page = await agent.get("/teams/manage");
    expect(page.text).toContain("Movers</strong> has invited you to join");

    await agent.post("/teams/invitations/invitation-id/accept");
    expect(teamRepository.respondToInvitation).toHaveBeenCalledWith(
      "9c81e9d8-6dce-4cb1-9a07-71c1e884c1b7",
      "invitation-id",
      true
    );

    await agent.post("/teams/invitations/invitation-id/decline");
    expect(teamRepository.respondToInvitation).toHaveBeenCalledWith(
      "9c81e9d8-6dce-4cb1-9a07-71c1e884c1b7",
      "invitation-id",
      false
    );
  });

  it("shows all teams without exposing member email addresses", async () => {
    const teamId = "13845b5d-e982-4c7d-906c-9c32ed90d810";
    const teamRepository = teamsWith({
      listAll: vi.fn().mockResolvedValue([
        { id: teamId, name: "Movers", memberCount: 3 },
        { id: "01e770a7-74c9-4bb9-b63c-bd6c4e00de88", name: "Steppers", memberCount: 5 }
      ]),
      findById: vi.fn().mockResolvedValue({
        id: teamId,
        name: "Movers",
        members: [
          { id: "member-1", displayName: "Alex" },
          { id: "member-2", displayName: "Sam" }
        ]
      })
    });
    const agent = request.agent(testApp(repositoryWith(), teamRepository));
    await signIn(agent);

    const response = await agent.get("/teams");
    expect(response.status).toBe(200);
    expect(response.text).toContain("Teams");
    expect(response.text).toContain("Movers");
    expect(response.text).toContain("3 of 5");
    expect(response.text).toContain("Steppers");
    expect(response.text).toContain("5 of 5");
    expect(response.text).toContain('href="/scoreboard/teams"');
    expect(response.text).toContain('class="app-table-scroll" role="region" aria-label="Teams" tabindex="0"');
    expect(response.text).toContain(`href="/teams/${teamId}"`);
    expect(response.text).toContain("View<span class=\"govuk-visually-hidden\"> Movers team members</span>");
    expect(response.text).not.toContain("@opencastsoftware.com");

    const teamPage = await agent.get(`/teams/${teamId}`);
    expect(teamPage.status).toBe(200);
    expect(teamPage.text).toContain("<h1 class=\"govuk-heading-xl\">Movers</h1>");
    expect(teamPage.text).toContain("Alex");
    expect(teamPage.text).toContain("Sam");
    expect(teamPage.text).toContain(`action="/teams/${teamId}/join"`);
    expect(teamPage.text).toContain("Join team");
    expect(teamPage.text).not.toContain("@opencastsoftware.com");
    expect(teamRepository.findById).toHaveBeenCalledWith(teamId);

    const join = await agent.post(`/teams/${teamId}/join`);
    expect(join.status).toBe(303);
    expect(join.headers.location).toBe("/teams/manage");
    expect(teamRepository.join).toHaveBeenCalledWith(
      "9c81e9d8-6dce-4cb1-9a07-71c1e884c1b7",
      teamId
    );

    const removedRoute = await agent.get("/teams/all");
    expect(removedRoute.status).toBe(404);
  });

  it("shows the monthly team scoreboard to signed-in users", async () => {
    const teamId = "13845b5d-e982-4c7d-906c-9c32ed90d810";
    const teamRepository = teamsWith({
      listMonthlyScores: vi.fn().mockResolvedValue([
        {
          rank: 1,
          teamId,
          teamName: "Movers",
          memberCount: 3,
          totalSteps: 42000,
          totalDurationMinutes: 150,
          activityCount: 8
        }
      ])
    });
    const agent = request.agent(testApp(repositoryWith(), teamRepository));
    await signIn(agent);

    const response = await agent.get("/scoreboard/teams");
    expect(response.status).toBe(200);
    expect(response.text).toContain("Monthly team scoreboard");
    expect(response.text).toContain("Movers");
    expect(response.text).toContain("42000");
    expect(response.text).toContain("Total hours");
    expect(response.text).toContain("2.5 hours");
    expect(response.text).toContain(`href="/teams/${teamId}"`);
    expect(teamRepository.listMonthlyScores).toHaveBeenCalledWith(
      expect.stringMatching(/^\d{4}-\d{2}-01$/)
    );
  });

  it("requires sign-in to view teams", async () => {
    const response = await request(testApp()).get("/teams");

    expect(response.status).toBe(303);
    expect(response.headers.location).toBe("/login");

    const teamResponse = await request(testApp()).get("/teams/13845b5d-e982-4c7d-906c-9c32ed90d810");
    expect(teamResponse.status).toBe(303);
    expect(teamResponse.headers.location).toBe("/login");

    const scoreboardResponse = await request(testApp()).get("/scoreboard/teams");
    expect(scoreboardResponse.status).toBe(303);
    expect(scoreboardResponse.headers.location).toBe("/login");
  });

  it("shows a signed-in user their submitted activities", async () => {
    const repository = repositoryWith({
      listForUser: vi.fn().mockResolvedValue([{
        id: "record-id",
        activityName: "Pilates",
        intensity: "moderate",
        durationMinutes: 30,
        estimatedSteps: 3900,
        createdAt: "2026-09-09T10:30:00.000Z"
      }])
    });
    const agent = request.agent(testApp(repository));
    await signIn(agent);

    const response = await agent.get("/account/activities");

    expect(response.status).toBe(200);
    expect(repository.listForUser).toHaveBeenCalledWith(
      "9c81e9d8-6dce-4cb1-9a07-71c1e884c1b7"
    );
    expect(response.text).toContain("Your submitted activities");
    expect(response.text).toContain("Showing the latest 50 submissions.");
    expect(response.text).toContain("9 September 2026");
    expect(response.text).toContain("Pilates");
    expect(response.text).toContain("Moderate");
    expect(response.text).toContain("30 minutes");
    expect(response.text).toContain("3900");
  });

  it("shows an empty activity history and protects it from anonymous users", async () => {
    const agent = request.agent(testApp());
    await signIn(agent);

    const emptyHistory = await agent.get("/account/activities");
    expect(emptyHistory.status).toBe(200);
    expect(emptyHistory.text).toContain("You have not submitted any activities yet.");

    const anonymousHistory = await request(testApp()).get("/account/activities");
    expect(anonymousHistory.status).toBe(303);
    expect(anonymousHistory.headers.location).toBe("/login");
  });

  it("requires sign-in to view account details", async () => {
    const response = await request(testApp()).get("/account");

    expect(response.status).toBe(303);
    expect(response.headers.location).toBe("/login");
  });

  it("lets a signed-in user change their password", async () => {
    const agent = request.agent(testApp());
    await signIn(agent);

    const page = await agent.get("/account/change-password");
    expect(page.status).toBe(200);
    expect(page.text).toContain("Current password");
    expect(page.text).toContain("New password");
    expect(page.text).toContain("Confirm new password");

    const response = await agent.post("/account/change-password").type("form").send({
      currentPassword: "A-safe-test-password1!",
      newPassword: "A-new-safe-password2!",
      confirmPassword: "A-new-safe-password2!"
    });

    expect(response.status).toBe(303);
    expect(response.headers.location).toBe("/account/password-changed");
    expect(authentication.changePassword).toHaveBeenCalledWith(
      "9c81e9d8-6dce-4cb1-9a07-71c1e884c1b7",
      "alex@opencastsoftware.com",
      "A-safe-test-password1!",
      "A-new-safe-password2!"
    );

    const confirmation = await agent.get(response.headers.location);
    expect(confirmation.text).toContain("Password changed");
  });

  it("validates that the new passwords match", async () => {
    const agent = request.agent(testApp());
    await signIn(agent);

    const response = await agent.post("/account/change-password").type("form").send({
      currentPassword: "A-safe-test-password1!",
      newPassword: "A-new-safe-password2!",
      confirmPassword: "A-different-password3!"
    });

    expect(response.status).toBe(400);
    expect(response.text).toContain("Passwords do not match");
    expect(response.text).toContain('href="#confirmPassword"');
    expect(authentication.changePassword).not.toHaveBeenCalled();
  });

  it("shows an error when the current password is incorrect", async () => {
    vi.mocked(authentication.changePassword).mockRejectedValueOnce(new IncorrectPasswordError());
    const agent = request.agent(testApp());
    await signIn(agent);

    const response = await agent.post("/account/change-password").type("form").send({
      currentPassword: "An-incorrect-password1!",
      newPassword: "A-new-safe-password2!",
      confirmPassword: "A-new-safe-password2!"
    });

    expect(response.status).toBe(400);
    expect(response.text).toContain("Enter your current password correctly");
    expect(response.text).toContain('href="#currentPassword"');
  });

  it("requires sign-in to change a password", async () => {
    const response = await request(testApp()).get("/account/change-password");

    expect(response.status).toBe(303);
    expect(response.headers.location).toBe("/login");
  });

  it("silently rejects a non-allowed email address at sign-in", async () => {
    const response = await request(testApp())
      .post("/login")
      .type("form")
      .send({ email: "alex@example.com", password: "A-safe-test-password1!" });

    expect(response.status).toBe(401);
    expect(response.text).toContain("Enter a valid email address and password");
    expect(response.text).toContain('href="#email"');
    expect(response.text).toContain('id="email-error"');
    expect(response.text).not.toContain('href="#password"');
    expect(response.text).not.toContain('id="password-error"');
    expect(response.text).not.toContain("opencastsoftware.com");
    expect(authentication.signIn).not.toHaveBeenCalled();
  });

  it("does not reveal password strength rules when sign-in fails", async () => {
    vi.mocked(authentication.signIn).mockRejectedValueOnce(
      new Error("Password must be at least 12 characters")
    );

    const response = await request(testApp()).post("/login").type("form").send({
      email: "alex@opencastsoftware.com",
      password: "wrong"
    });

    expect(response.status).toBe(401);
    expect(authentication.signIn).toHaveBeenCalledWith("alex@opencastsoftware.com", "wrong");
    expect(response.text).toContain("Enter a valid email address and password");
    expect(response.text).toContain('href="#email"');
    expect(response.text).not.toContain('href="#password"');
    expect(response.text).not.toContain("Password must be at least");
    expect(response.text).not.toContain("Password must include");
  });

  it("shows all sign-in validation errors at once", async () => {
    const response = await request(testApp()).post("/login").type("form").send({
      email: "",
      password: ""
    });

    expect(response.status).toBe(400);
    expect(response.text).toContain('href="#email"');
    expect(response.text).toContain('href="#password"');
    expect(response.text).toContain('id="email-error"');
    expect(response.text).toContain('id="password-error"');
    expect(response.text).toContain("Enter an email address");
    expect(response.text).toContain("Enter your password");
    expect(authentication.signIn).not.toHaveBeenCalled();
  });

  it("shows all access-request validation errors at once", async () => {
    const response = await request(testApp()).post("/request-access").type("form").send({
      displayName: "",
      email: "",
      password: ""
    });

    expect(response.status).toBe(400);
    expect(response.text).toContain('href="#displayName"');
    expect(response.text).toContain('href="#email"');
    expect(response.text).toContain('href="#password"');
    expect(response.text).toContain('id="displayName-error"');
    expect(response.text).toContain('id="email-error"');
    expect(response.text).toContain('id="password-error"');
    expect(authentication.requestAccess).not.toHaveBeenCalled();
  });

  it("anchors a short access-request password error to the password input", async () => {
    const response = await request(testApp())
      .post("/request-access")
      .type("form")
      .send({
        displayName: "Alex",
        email: "alex@opencastsoftware.com",
        password: "too-short"
      });

    expect(response.status).toBe(400);
    expect(response.text).toContain('href="#password"');
    expect(response.text).toContain("Password must be at least 12 characters");
    expect(response.text).toContain('data-module="govuk-password-input"');
    expect(response.text).toContain('aria-controls="password"');
  });

  it("attaches a display-name error to the problematic field", async () => {
    const response = await request(testApp())
      .post("/request-access")
      .type("form")
      .send({
        displayName: "A",
        email: "alex@opencastsoftware.com",
        password: "A-safe-test-password1!"
      });

    expect(response.status).toBe(400);
    expect(response.text).toContain('href="#displayName"');
    expect(response.text).toContain('id="displayName-error"');
    expect(response.text).toContain('aria-describedby="displayName-error"');
    expect(response.text).toContain("govuk-input--error");
    expect(response.text).toContain("Display name must be at least 2 characters");
  });

  it("attaches a duplicate display-name error to the problematic field", async () => {
    vi.mocked(authentication.requestAccess).mockRejectedValueOnce(new DisplayNameTakenError());

    const response = await request(testApp())
      .post("/request-access")
      .type("form")
      .send({
        displayName: "Alex",
        email: "another.user@opencastsoftware.com",
        password: "A-safe-test-password1!"
      });

    expect(response.status).toBe(400);
    expect(response.text).toContain('href="#displayName"');
    expect(response.text).toContain('id="displayName-error"');
    expect(response.text).toContain("govuk-input--error");
    expect(response.text).toContain("Choose a different display name");
  });

  it("silently discards an access request from a non-allowed domain", async () => {
    const response = await request(testApp()).post("/request-access").type("form").send({
      displayName: "Alex",
      email: "alex@example.com",
      password: "A-safe-test-password1!"
    });

    expect(response.status).toBe(200);
    expect(response.text).toContain("Access request sent");
    expect(response.text).not.toContain("opencastsoftware.com");
    expect(authentication.requestAccess).not.toHaveBeenCalled();
  });

  it("does not permit administrator access without the configured token", async () => {
    const agent = request.agent(testApp());
    const adminLogin = await agent.post("/admin/login").type("form").send({
      adminAccessToken: ""
    });
    expect(adminLogin.status).toBe(401);
  });

  it("lets an administrator approve a pending request", async () => {
    const priorToken = process.env.ADMIN_ACCESS_TOKEN;
    process.env.ADMIN_ACCESS_TOKEN = "test-admin-token";
    vi.mocked(authentication.listUsers).mockResolvedValueOnce([{
      id: "2e1e9d8-6dce-4cb1-9a07-71c1e884c1b7",
      email: "sam@opencastsoftware.com",
      displayName: "Sam",
      mustChangePassword: false,
      status: "pending"
    }]);
    const agent = request.agent(testApp());

    try {
      const login = await agent.post("/admin/login").type("form").send({
        adminAccessToken: "test-admin-token"
      });
      expect(login.headers.location).toBe("/admin");
      const page = await agent.get("/admin");
      expect(page.text).toContain("Approve");
      const approval = await agent.post("/admin/users/2e1e9d8-6dce-4cb1-9a07-71c1e884c1b7/approve");
      expect(approval.headers.location).toBe("/admin");
      expect(authentication.approveUser).toHaveBeenCalledWith("2e1e9d8-6dce-4cb1-9a07-71c1e884c1b7");
    } finally {
      if (priorToken === undefined) delete process.env.ADMIN_ACCESS_TOKEN;
      else process.env.ADMIN_ACCESS_TOKEN = priorToken;
    }
  });

  it("lets an administrator deactivate an approved user", async () => {
    const priorToken = process.env.ADMIN_ACCESS_TOKEN;
    process.env.ADMIN_ACCESS_TOKEN = "test-admin-token";
    vi.mocked(authentication.listUsers).mockResolvedValueOnce([{
      id: "2e1e9d8-6dce-4cb1-9a07-71c1e884c1b7",
      email: "sam@opencastsoftware.com",
      displayName: "Sam",
      mustChangePassword: false,
      status: "approved"
    }]);
    const agent = request.agent(testApp());

    try {
      await agent.post("/admin/login").type("form").send({ adminAccessToken: "test-admin-token" });
      const page = await agent.get("/admin");
      expect(page.text).toContain("Deactivate");
      const deactivation = await agent.post("/admin/users/2e1e9d8-6dce-4cb1-9a07-71c1e884c1b7/deactivate");
      expect(deactivation.headers.location).toBe("/admin");
      expect(authentication.deactivateUser).toHaveBeenCalledWith("2e1e9d8-6dce-4cb1-9a07-71c1e884c1b7");
    } finally {
      if (priorToken === undefined) delete process.env.ADMIN_ACCESS_TOKEN;
      else process.env.ADMIN_ACCESS_TOKEN = priorToken;
    }
  });

  it("lets an administrator permanently delete a user after confirmation", async () => {
    const priorToken = process.env.ADMIN_ACCESS_TOKEN;
    process.env.ADMIN_ACCESS_TOKEN = "test-admin-token";
    const user = {
      id: "2e1e9d8-6dce-4cb1-9a07-71c1e884c1b7",
      email: "sam@opencastsoftware.com",
      displayName: "Sam",
      mustChangePassword: false,
      status: "deactivated" as const
    };
    vi.mocked(authentication.listUsers).mockResolvedValue([user]);
    const agent = request.agent(testApp());

    try {
      await agent.post("/admin/login").type("form").send({ adminAccessToken: "test-admin-token" });

      const page = await agent.get("/admin");
      expect(page.status).toBe(200);
      expect(page.text).toContain("Manage access");
      expect(page.text).toContain("Delete account");
      expect(page.text).toContain(`/admin/users/${user.id}/delete`);
      expect(page.text).toContain("Delete");

      const confirmation = await agent.get(`/admin/users/${user.id}/delete`);
      expect(confirmation.status).toBe(200);
      expect(confirmation.text).toContain("Delete this account?");
      expect(confirmation.text).toContain("sam@opencastsoftware.com");
      expect(confirmation.text).toContain("all activities they have submitted");
      expect(confirmation.text).toContain("This cannot be undone");

      const deletion = await agent.post(`/admin/users/${user.id}/delete`);
      expect(deletion.status).toBe(303);
      expect(deletion.headers.location).toBe("/admin");
      expect(authentication.deleteUser).toHaveBeenCalledWith(user.id);
    } finally {
      if (priorToken === undefined) delete process.env.ADMIN_ACCESS_TOKEN;
      else process.env.ADMIN_ACCESS_TOKEN = priorToken;
    }
  });

  it("does not expose account deletion to non-administrators", async () => {
    const response = await request(testApp()).get(
      "/admin/users/2e1e9d8-6dce-4cb1-9a07-71c1e884c1b7/delete"
    );

    expect(response.status).toBe(303);
    expect(response.headers.location).toBe("/admin/login");
    expect(authentication.deleteUser).not.toHaveBeenCalled();
  });

  it("does not sign in a deactivated user", async () => {
    vi.mocked(authentication.signIn).mockResolvedValueOnce({
      id: "9c81e9d8-6dce-4cb1-9a07-71c1e884c1b7",
      email: "alex@opencastsoftware.com",
      displayName: "Alex",
      mustChangePassword: false,
      status: "deactivated"
    });

    const response = await request(testApp()).post("/login").type("form").send({
      email: "alex@opencastsoftware.com",
      password: "A-safe-test-password1!"
    });

    expect(response.status).toBe(403);
    expect(response.text).toContain("Your access is not available");
  });
});
