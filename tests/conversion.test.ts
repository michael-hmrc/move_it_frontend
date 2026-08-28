import { describe, expect, it } from "vitest";
import { convertActivityToSteps } from "../src/domain/conversion.js";

describe("convertActivityToSteps", () => {
  it("calculates the estimated steps from duration and intensity", () => {
    expect(
      convertActivityToSteps({
        displayName: "Alex",
        activity: "cycling",
        intensity: "moderate",
        durationMinutes: 30
      })
    ).toEqual({
      displayName: "Alex",
      activity: "cycling",
      activityName: "Cycling",
      intensity: "moderate",
      durationMinutes: 30,
      estimatedSteps: 4500
    });
  });
});
