import { describe, expect, it } from "vitest";
import {
  activitySchema,
  displayNameSchema,
  durationSchema,
  intensitySchema
} from "../src/domain/validation.js";

function firstError(result: { success: boolean; error?: { issues: Array<{ message: string }> } }) {
  return result.error?.issues[0]?.message;
}

describe("display name validation", () => {
  it("trims a valid display name", () => {
    expect(displayNameSchema.parse({ displayName: "  Élodie 2  " })).toEqual({
      displayName: "Élodie 2"
    });
  });

  it.each([
    ["", "Display name must be at least 2 characters"],
    ["A", "Display name must be at least 2 characters"],
    ["x".repeat(41), "Display name must be 40 characters or fewer"],
    ["--", "Display name must include a letter or number"]
  ])("rejects %j", (displayName, message) => {
    expect(firstError(displayNameSchema.safeParse({ displayName }))).toBe(message);
  });
});

describe("journey selection validation", () => {
  it("accepts configured values", () => {
    expect(activitySchema.parse({ activity: "football" })).toEqual({ activity: "football" });
    expect(intensitySchema.parse({ intensity: "moderate" })).toEqual({ intensity: "moderate" });
  });

  it("rejects missing and unknown values", () => {
    expect(firstError(activitySchema.safeParse({}))).toBe("Select an activity");
    expect(firstError(activitySchema.safeParse({ activity: "quidditch" }))).toBe("Select an activity");
    expect(firstError(intensitySchema.safeParse({}))).toBe("Select an intensity");
    expect(firstError(intensitySchema.safeParse({ intensity: "extreme" }))).toBe("Select an intensity");
  });
});

describe("duration validation", () => {
  it.each([
    ["1", 1],
    ["60", 60],
    ["1440", 1440]
  ])("coerces %s minutes to a number", (durationMinutes, expected) => {
    expect(durationSchema.parse({ durationMinutes })).toEqual({ durationMinutes: expected });
  });

  it.each([
    ["", "Enter the duration in minutes"],
    ["abc", "Enter the duration in minutes"],
    ["12.5", "Duration must be a whole number"],
    ["0", "Duration must be at least 1 minute"],
    ["-1", "Duration must be at least 1 minute"],
    ["1441", "Duration must be 1,440 minutes or less"]
  ])("rejects %j", (durationMinutes, message) => {
    expect(firstError(durationSchema.safeParse({ durationMinutes }))).toBe(message);
  });
});
