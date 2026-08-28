import { describe, expect, it } from "vitest";
import { activities, intensities } from "../src/domain/activities.js";
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

  const cases = activities.flatMap((activity) =>
    intensities.map((intensity) => ({ activity, intensity }))
  );

  it.each(cases)(
    "uses the $intensity rate for $activity.name",
    ({ activity, intensity }) => {
      const durationMinutes = 17;
      const result = convertActivityToSteps({
        displayName: "Sam",
        activity: activity.id,
        intensity,
        durationMinutes
      });

      expect(result.activityName).toBe(activity.name);
      expect(result.estimatedSteps).toBe(
        activity.stepsPerMinute[intensity] * durationMinutes
      );
    }
  );
});
