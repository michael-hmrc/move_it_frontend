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

const passwordValueSchema = z
  .string({ error: "Enter a password" })
  .min(12, "Password must be at least 12 characters")
  .max(128, "Password must be 128 characters or fewer")
  .regex(/[A-Z]/, "Password must include an uppercase letter")
  .regex(/[0-9]/, "Password must include a number")
  .regex(/[^A-Za-z0-9]/, "Password must include a symbol");

export const passwordSchema = z.object({
  password: passwordValueSchema
});

export const signInPasswordSchema = z.object({
  password: z.string({ error: "Enter your password" }).min(1, "Enter your password")
});

export const teamNameSchema = z.object({
  teamName: z
    .string({ error: "Enter a team name" })
    .trim()
    .min(2, "Team name must be at least 2 characters")
    .max(40, "Team name must be 40 characters or fewer")
});

export const teamInvitationSchema = z.object({
  displayName: z
    .string({ error: "Enter a display name" })
    .trim()
    .min(2, "Enter a display name")
    .max(40, "Display name must be 40 characters or fewer")
});

export const changePasswordSchema = z
  .object({
    currentPassword: z.string({ error: "Enter your current password" }).min(1, "Enter your current password"),
    newPassword: passwordValueSchema,
    confirmPassword: z.string({ error: "Confirm your new password" }).min(1, "Confirm your new password")
  })
  .refine((values) => values.newPassword === values.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"]
  });

export const activitySchema = z
  .object({
    activity: z.preprocess(
      (value) => value ?? "",
      z.string().refine(isActivityId, "Select an activity")
    ),
    otherActivity: z.preprocess(
      (value) => typeof value === "string" ? value.trim() : "",
      z.string().max(50, "Other activity must be 50 characters or fewer")
    )
  })
  .superRefine((values, context) => {
    if (values.activity === "other" && values.otherActivity.length < 2) {
      context.addIssue({
        code: "custom",
        message: "Enter the other activity",
        path: ["otherActivity"]
      });
    }
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
