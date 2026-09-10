import { createClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ConversionResult } from "../src/domain/conversion.js";
import { createConversionRepository } from "../src/persistence/conversion-repository.js";

const supabase = vi.hoisted(() => {
  const insert = vi.fn();
  const limit = vi.fn();
  const order = vi.fn(() => ({ limit }));
  const eq = vi.fn(() => ({ order }));
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ insert, select }));
  const rpc = vi.fn();
  return { from, insert, select, eq, order, limit, rpc };
});

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({ from: supabase.from, rpc: supabase.rpc }))
}));

const result: ConversionResult = {
  displayName: "Alex",
  activity: "football",
  activityName: "Football",
  intensity: "moderate",
  durationMinutes: 30,
  estimatedSteps: 4500
};

function configuredRepository() {
  return createConversionRepository({
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_SECRET_KEY: "server-secret"
  } as NodeJS.ProcessEnv);
}

describe("conversion repository", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    supabase.insert.mockResolvedValue({ error: null });
    supabase.limit.mockResolvedValue({ data: [], error: null });
    supabase.rpc.mockResolvedValue({ data: [], error: null });
  });

  it("uses an inert repository when Supabase is not configured", async () => {
    const repository = createConversionRepository({} as NodeJS.ProcessEnv);

    await expect(repository.save(result, "user-id")).resolves.toBeUndefined();
    await expect(repository.listMonthly("2026-08-01")).resolves.toEqual([]);
    await expect(repository.listForUser("user-id")).resolves.toEqual([]);
    await expect(repository.listForDisplayName("Alex")).resolves.toEqual([]);
    await expect(repository.findUserProfile("Alex")).resolves.toBeUndefined();
    expect(createClient).not.toHaveBeenCalled();
  });

  it("stores the server-side fields expected by Supabase", async () => {
    const repository = configuredRepository();

    await repository.save(result, "user-id");

    expect(createClient).toHaveBeenCalledWith(
      "https://example.supabase.co",
      "server-secret",
      { auth: { persistSession: false, autoRefreshToken: false } }
    );
    expect(supabase.from).toHaveBeenCalledWith("conversion_records");
    expect(supabase.insert).toHaveBeenCalledWith({
      user_id: "user-id",
      display_name: "Alex",
      activity: "football",
      other_activity: null,
      intensity: "moderate",
      duration_minutes: 30,
      estimated_steps: 4500
    });
  });

  it("stores the user-entered name for an Other activity", async () => {
    const repository = configuredRepository();

    await repository.save({
      ...result,
      activity: "other",
      activityName: "Pilates",
      otherActivity: "Pilates"
    }, "user-id");

    expect(supabase.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        activity: "other",
        other_activity: "Pilates"
      })
    );
  });

  it("falls back to the existing activity column before the Other migration is applied", async () => {
    supabase.insert
      .mockResolvedValueOnce({
        error: { message: "Could not find the 'other_activity' column of 'conversion_records' in the schema cache" }
      })
      .mockResolvedValueOnce({ error: null });
    const repository = configuredRepository();

    await repository.save({
      ...result,
      activity: "other",
      activityName: "Pilates",
      otherActivity: "Pilates"
    }, "user-id");

    expect(supabase.insert).toHaveBeenNthCalledWith(2, {
      user_id: "user-id",
      display_name: "Alex",
      activity: "Pilates",
      intensity: "moderate",
      duration_minutes: 30,
      estimated_steps: 4500
    });
  });

  it("maps monthly scoreboard rows from the database", async () => {
    supabase.rpc.mockResolvedValue({
      data: [
        {
          rank: "1",
          display_name: "Sam",
          total_steps: "12345",
          activity_count: "4"
        }
      ],
      error: null
    });

    const entries = await configuredRepository().listMonthly("2026-08-01");

    expect(supabase.rpc).toHaveBeenCalledWith("monthly_scoreboard", {
      requested_month: "2026-08-01"
    });
    expect(entries).toEqual([
      { rank: 1, displayName: "Sam", totalSteps: 12345, activityCount: 4 }
    ]);
  });

  it("maps another user's all-time profile without exposing their email", async () => {
    supabase.rpc.mockResolvedValue({
      data: [{
        display_name: "Morgan",
        total_duration_minutes: "150",
        total_steps: "123456",
        most_frequent_activity: "running",
        team_id: "team-id",
        team_name: "Movers"
      }],
      error: null
    });

    const profile = await configuredRepository().findUserProfile("Morgan");

    expect(supabase.rpc).toHaveBeenCalledWith("move_it_user_profile", {
      requested_display_name: "Morgan"
    });
    expect(profile).toEqual({
      displayName: "Morgan",
      totalDurationMinutes: 150,
      totalSteps: 123456,
      mostFrequentActivity: "Running",
      team: { id: "team-id", name: "Movers" }
    });
    expect(profile).not.toHaveProperty("email");
  });

  it("lists only the requested user's latest submitted activities", async () => {
    supabase.limit.mockResolvedValueOnce({
      data: [{
        id: "record-id",
        activity: "other",
        other_activity: "Pilates",
        intensity: "moderate",
        duration_minutes: 30,
        estimated_steps: 3900,
        created_at: "2026-09-09T10:30:00.000Z"
      }],
      error: null
    });

    const activities = await configuredRepository().listForUser("user-id");

    expect(supabase.eq).toHaveBeenCalledWith("user_id", "user-id");
    expect(supabase.order).toHaveBeenCalledWith("created_at", { ascending: false });
    expect(supabase.limit).toHaveBeenCalledWith(50);
    expect(activities).toEqual([{
      id: "record-id",
      activityName: "Pilates",
      intensity: "moderate",
      durationMinutes: 30,
      estimatedSteps: 3900,
      createdAt: "2026-09-09T10:30:00.000Z"
    }]);
  });

  it("filters another user's activity history by display name", async () => {
    await configuredRepository().listForDisplayName("Morgan");

    expect(supabase.eq).toHaveBeenCalledWith("display_name", "Morgan");
    expect(supabase.order).toHaveBeenCalledWith("created_at", { ascending: false });
    expect(supabase.limit).toHaveBeenCalledWith(50);
  });

  it("surfaces Supabase write and read errors", async () => {
    supabase.insert.mockResolvedValueOnce({ error: { message: "write failed" } });
    await expect(configuredRepository().save(result, "user-id")).rejects.toThrow(
      "Could not save conversion: write failed"
    );

    supabase.rpc.mockResolvedValueOnce({ data: null, error: { message: "read failed" } });
    await expect(configuredRepository().listMonthly("2026-08-01")).rejects.toThrow(
      "Could not load scoreboard: read failed"
    );
  });
});
