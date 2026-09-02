import { z } from "zod";
import { isActivityId, isIntensity } from "./activities.js";

export const displayNameSchema = z.object({
  displayName: z
    .string({ error: "Enter a display name" })
    .trim()
    .min(2, "Display name must be at least 2 characters")
    .max(40, "Display name must be 40 characters or fewer")
    .refine(
      (value) => /[\p{L}\p{N}]/u.test(value),
      "Display name must include a letter or number"
    )
});

export const emailSchema = z.object({
  email: z
    .string({ error: "Enter your email address" })
    .trim()
    .email("Enter an email address")
});

export const passwordSchema = z.object({
  password: z
    .string({ error: "Enter a password" })
    .min(12, "Password must be at least 12 characters")
    .max(128, "Password must be 128 characters or fewer")
});

export const activitySchema = z.object({
  activity: z.preprocess(
    (value) => value ?? "",
    z.string().refine(isActivityId, "Select an activity")
  )
});

export const intensitySchema = z.object({
  intensity: z.preprocess(
    (value) => value ?? "",
    z.string().refine(isIntensity, "Select an intensity")
  )
});

export const durationSchema = z.object({
  durationMinutes: z.preprocess(
    (value) => typeof value === "string" && value.trim() === "" ? undefined : value,
    z.coerce
      .number({ error: "Enter the duration in minutes" })
      .finite("Enter a valid duration in minutes")
      .int("Duration must be a whole number")
      .min(1, "Duration must be at least 1 minute")
      .max(1440, "Duration must be 1,440 minutes or less")
  )
});
