import { createClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ConversionResult } from "../src/domain/conversion.js";
import {
  createConversionRepository,
  sampleScoreboardEntries
} from "../src/persistence/conversion-repository.js";

const supabase = vi.hoisted(() => {
  const insert = vi.fn();
  const from = vi.fn(() => ({ insert }));
  const rpc = vi.fn();
  return { from, insert, rpc };
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
    supabase.rpc.mockResolvedValue({ data: [], error: null });
  });

  it("uses an inert repository when Supabase is not configured", async () => {
    const repository = createConversionRepository({} as NodeJS.ProcessEnv);

    await expect(repository.save(result)).resolves.toBeUndefined();
    await expect(repository.listMonthly("2026-08-01")).resolves.toEqual([]);
    expect(createClient).not.toHaveBeenCalled();
  });

  it("stores the server-side fields expected by Supabase", async () => {
    const repository = configuredRepository();

    await repository.save(result);

    expect(createClient).toHaveBeenCalledWith(
      "https://example.supabase.co",
      "server-secret",
      { auth: { persistSession: false, autoRefreshToken: false } }
    );
    expect(supabase.from).toHaveBeenCalledWith("conversion_records");
    expect(supabase.insert).toHaveBeenCalledWith({
      display_name: "Alex",
      activity: "football",
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

  it("surfaces Supabase write and read errors", async () => {
    supabase.insert.mockResolvedValueOnce({ error: { message: "write failed" } });
    await expect(configuredRepository().save(result)).rejects.toThrow(
      "Could not save conversion: write failed"
    );

    supabase.rpc.mockResolvedValueOnce({ data: null, error: { message: "read failed" } });
    await expect(configuredRepository().listMonthly("2026-08-01")).rejects.toThrow(
      "Could not load scoreboard: read failed"
    );
  });
});

describe("sample scoreboard data", () => {
  it("is ranked in descending step order with unique display names", () => {
    expect(sampleScoreboardEntries.map(({ rank }) => rank)).toEqual([1, 2, 3, 4, 5]);
    expect(new Set(sampleScoreboardEntries.map(({ displayName }) => displayName)).size)
      .toBe(sampleScoreboardEntries.length);

    for (let index = 1; index < sampleScoreboardEntries.length; index += 1) {
      expect(sampleScoreboardEntries[index - 1].totalSteps)
        .toBeGreaterThan(sampleScoreboardEntries[index].totalSteps);
    }
  });
});
