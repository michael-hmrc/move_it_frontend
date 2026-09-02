import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/create-app.js";
import type { AuthenticationService } from "../src/persistence/authentication.js";
import type { ConversionRepository } from "../src/persistence/conversion-repository.js";

function repositoryWith(overrides: Partial<ConversionRepository> = {}): ConversionRepository {
  return {
    save: vi.fn().mockResolvedValue(undefined),
    listMonthly: vi.fn().mockResolvedValue([]),
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
  requestAccess: vi.fn().mockResolvedValue(undefined),
  approveUser: vi.fn().mockResolvedValue(undefined),
  listUsers: vi.fn().mockResolvedValue([])
};

function testApp(repository: ConversionRepository = repositoryWith()) {
  return createApp(repository, authentication);
}

async function signIn(agent: ReturnType<typeof request.agent>) {
  await agent.post("/login").type("form").send({
    email: "alex@opencastsoftware.com",
    password: "a-safe-test-password"
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
    expect(response.text).toContain("View one-hour conversions");
    expect(response.text).toContain("Learn how Move It works");
    expect(response.text).toContain("Submit activity");
    expect(response.text).toContain('href="/login"');
    expect(response.text).toContain(">Account</a>");
    expect(response.text).toContain('aria-current="page"');
  });

  it("starts the conversion with one question about the display name", async () => {
    const agent = request.agent(testApp());
    await signIn(agent);
    const response = await agent.get("/convert");

    expect(response.status).toBe(200);
    expect(response.text).toContain("What is your display name?");
    expect(response.text).toContain('src="/images/opencast-logo.png"');
    expect(response.text).toContain('alt="Opencast"');
    expect(response.text).toContain('class="app-header__brand-stripe"');
    expect(response.text).toContain('/styles/application.css?v=');
    expect(response.text).toContain("Move It by");
    expect(response.text).toContain('class="app-footer__logo-link" href="/"');
    expect(response.text).toContain('class="app-footer__logo"');
    expect(response.text).toContain("How it works");
    expect(response.text).toContain('autocomplete="nickname"');
    expect(response.text).toContain('maxlength="40"');
    expect(response.text).not.toContain("What activity did you do?");
    expect(response.text).not.toContain("Crown copyright");
  });

  it("does not cache generated styles during development", async () => {
    const response = await request(createApp()).get("/styles/application.css");

    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toContain("max-age=0");
    expect(response.text).toContain(".app-header__brand-stripe");
    expect(response.text).toContain("background:#6e4ba2");
    expect(response.text).toContain("height:8px");
  });

  it("validates the display name before continuing", async () => {
    const agent = request.agent(testApp());
    await signIn(agent);
    const response = await agent
      .post("/convert/name")
      .type("form")
      .send({ displayName: "" });

    expect(response.status).toBe(400);
    expect(response.text).toContain("There is a problem");
    expect(response.text).toContain("Display name must be at least 2 characters");
  });

  it("requires a meaningful display name", async () => {
    const agent = request.agent(testApp());
    await signIn(agent);
    const response = await agent
      .post("/convert/name")
      .type("form")
      .send({ displayName: "--" });

    expect(response.status).toBe(400);
    expect(response.text).toContain("Display name must include a letter or number");
  });

  it("validates activity, intensity and duration values", async () => {
    const agent = request.agent(testApp());
    await signIn(agent);

    await agent.post("/convert/name").type("form").send({ displayName: "Alex" });

    const invalidActivity = await agent
      .post("/convert/activity")
      .type("form")
      .send({ activity: "not-an-activity" });
    expect(invalidActivity.status).toBe(400);
    expect(invalidActivity.text).toContain("Select an activity");

    await agent.post("/convert/activity").type("form").send({ activity: "football" });

    const invalidIntensity = await agent
      .post("/convert/intensity")
      .type("form")
      .send({ intensity: "extreme" });
    expect(invalidIntensity.status).toBe(400);
    expect(invalidIntensity.text).toContain("Select an intensity");

    await agent.post("/convert/intensity").type("form").send({ intensity: "moderate" });

    const blankDuration = await agent
      .post("/convert/duration")
      .type("form")
      .send({ durationMinutes: "" });
    expect(blankDuration.status).toBe(400);
    expect(blankDuration.text).toContain("Enter the duration in minutes");

    const decimalDuration = await agent
      .post("/convert/duration")
      .type("form")
      .send({ durationMinutes: "12.5" });
    expect(decimalDuration.status).toBe(400);
    expect(decimalDuration.text).toContain("Duration must be a whole number");

    const excessiveDuration = await agent
      .post("/convert/duration")
      .type("form")
      .send({ durationMinutes: "1441" });
    expect(excessiveDuration.status).toBe(400);
    expect(excessiveDuration.text).toContain("Duration must be 1,440 minutes or less");
  });

  it("completes the multi-page journey and persists the result", async () => {
    const repository = repositoryWith();
    const agent = request.agent(testApp(repository));
    await signIn(agent);

    const nameResponse = await agent
      .post("/convert/name")
      .type("form")
      .send({ displayName: "Morgan" });
    expect(nameResponse.status).toBe(303);
    expect(nameResponse.headers.location).toBe("/convert/activity");

    const activityPage = await agent.get("/convert/activity");
    expect(activityPage.text).toContain("What activity did you do?");

    const activityResponse = await agent
      .post("/convert/activity")
      .type("form")
      .send({ activity: "swimming" });
    expect(activityResponse.headers.location).toBe("/convert/intensity");

    const intensityPage = await agent.get("/convert/intensity");
    expect(intensityPage.text).toContain("How intense was your swimming?");

    const intensityResponse = await agent
      .post("/convert/intensity")
      .type("form")
      .send({ intensity: "vigorous" });
    expect(intensityResponse.headers.location).toBe("/convert/duration");

    const durationPage = await agent.get("/convert/duration");
    expect(durationPage.text).toContain("How long did the activity last?");
    expect(durationPage.text).toContain('inputmode="numeric"');
    expect(durationPage.text).toContain('maxlength="4"');
    expect(durationPage.text).toContain('pattern="[0-9]*"');

    const durationResponse = await agent
      .post("/convert/duration")
      .type("form")
      .send({ durationMinutes: "20" });
    expect(durationResponse.status).toBe(303);
    expect(durationResponse.headers.location).toBe("/convert/result");

    const resultPage = await agent.get("/convert/result");
    expect(resultPage.status).toBe(200);
    expect(resultPage.text).toContain("4200 steps");
    expect(repository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        displayName: "Morgan",
        activity: "swimming",
        intensity: "vigorous",
        durationMinutes: 20,
        estimatedSteps: 4200
      }),
      "9c81e9d8-6dce-4cb1-9a07-71c1e884c1b7"
    );
  });

  it("redirects unauthenticated users to sign in", async () => {
    const response = await request(testApp()).get("/convert/duration");

    expect(response.status).toBe(303);
    expect(response.headers.location).toBe("/login");
  });

  it("renders the monthly scoreboard", async () => {
    const repository = repositoryWith({
      listMonthly: vi.fn().mockResolvedValue([
        { rank: 1, displayName: "Morgan", totalSteps: 8400, activityCount: 2 }
      ])
    });

    const response = await request(createApp(repository)).get("/scoreboard");

    expect(response.status).toBe(200);
    expect(response.text).toContain("Monthly scoreboard");
    expect(response.text).toContain("Morgan");
    expect(response.text).toContain("8400");
    expect(response.text).not.toContain("This is sample data");
  });

  it("renders labelled sample scoreboard data when there are no saved entries", async () => {
    const response = await request(createApp()).get("/scoreboard");

    expect(response.status).toBe(200);
    expect(response.text).toContain("This is sample data");
    expect(response.text).toContain("Alex");
    expect(response.text).toContain("48250");
  });

  it("renders an explanation page from the service navigation", async () => {
    const response = await request(createApp()).get("/about");

    expect(response.status).toBe(200);
    expect(response.text).toContain("How Move It works");
    expect(response.text).toContain("illustrative estimates");
    expect(response.text).toContain('aria-current="page"');
  });

  it("renders the one-hour conversion guide from the shared rates", async () => {
    const response = await request(createApp()).get("/conversions");

    expect(response.status).toBe(200);
    expect(response.text).toContain("One-hour activity conversion guide");
    expect(response.text).toContain("Cycling");
    expect(response.text).toContain("Football");
    expect(response.text).toContain("Running");
    expect(response.text).toContain("Strength training");
    expect(response.text).toContain("Walking");
    expect(response.text).toContain("9000");
    expect(response.text).toContain("12000");
    expect(response.text).toContain('aria-current="page"');
  });

  it("renders the approved-members account page", async () => {
    const login = await request(testApp()).get("/login");
    const signup = await request(testApp()).get("/signup");

    expect(login.status).toBe(200);
    expect(login.text).toContain("Move It is for approved members");
    expect(login.text).toContain("Sign in");
    expect(signup.status).toBe(303);
    expect(signup.headers.location).toBe("/login");
  });

  it("signs in an invited user and signs out", async () => {
    const agent = request.agent(testApp());

    const login = await agent.post("/login").type("form").send({
      email: "alex@opencastsoftware.com",
      password: "a-safe-test-password"
    });
    expect(login.status).toBe(303);
    expect(login.headers.location).toBe("/convert");
    expect(authentication.signIn).toHaveBeenCalled();

    const signedIn = await agent.get("/");
    expect(signedIn.text).toContain("Alex");
    expect(signedIn.text).toContain("Sign out");

    const logout = await agent.post("/logout").type("form").send({});
    expect(logout.status).toBe(303);

    const signedOut = await agent.get("/");
    expect(signedOut.text).toContain(">Account</a>");
    expect(signedOut.text).not.toContain("Sign out");
  });

  it("rejects a non-Opencast email address", async () => {
    const response = await request(testApp())
      .post("/login")
      .type("form")
      .send({ email: "alex@example.com", password: "a-safe-test-password" });

    expect(response.status).toBe(400);
    expect(response.text).toContain("@opencastsoftware.com");
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
});
