import { describe, expect, it } from "vitest";
import {
  activities,
  getActivity,
  intensities,
  isActivityId,
  isIntensity
} from "../src/domain/activities.js";

describe("activity catalogue", () => {
  it("uses unique identifiers and alphabetic display order", () => {
    const ids = activities.map(({ id }) => id);
    const names = activities.map(({ name }) => name);

    expect(new Set(ids).size).toBe(ids.length);
    expect(names).toEqual([...names].sort((left, right) => left.localeCompare(right)));
  });

  it.each(activities)("has increasing positive whole-number rates for $name", (activity) => {
    const { light, moderate, vigorous } = activity.stepsPerMinute;

    expect(light).toBeGreaterThan(0);
    expect(Number.isInteger(light)).toBe(true);
    expect(moderate).toBeGreaterThanOrEqual(light);
    expect(Number.isInteger(moderate)).toBe(true);
    expect(vigorous).toBeGreaterThanOrEqual(moderate);
    expect(Number.isInteger(vigorous)).toBe(true);
  });

  it("recognises only configured activities and intensities", () => {
    for (const activity of activities) expect(isActivityId(activity.id)).toBe(true);
    for (const intensity of intensities) expect(isIntensity(intensity)).toBe(true);

    expect(isActivityId("quidditch")).toBe(false);
    expect(isIntensity("extreme")).toBe(false);
  });

  it("returns the matching activity", () => {
    expect(getActivity("football")).toEqual(
      expect.objectContaining({ id: "football", name: "Football" })
    );
  });
});
