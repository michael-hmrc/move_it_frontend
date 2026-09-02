import { createClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";

export interface AuthenticatedUser {
  id: string;
  email: string;
  displayName: string;
  mustChangePassword: boolean;
}

export interface InvitedUser extends AuthenticatedUser {
  temporaryPassword: string;
}

export interface AuthenticationService {
  signIn(email: string, password: string): Promise<AuthenticatedUser>;
  inviteUser(email: string, displayName: string): Promise<InvitedUser>;
  changePassword(userId: string, password: string): Promise<void>;
  listUsers(): Promise<AuthenticatedUser[]>;
}

class UnavailableAuthenticationService implements AuthenticationService {
  private unavailable(): never { throw new Error("Authentication is not configured"); }
  async signIn(): Promise<AuthenticatedUser> { return this.unavailable(); }
  async inviteUser(): Promise<InvitedUser> { return this.unavailable(); }
  async changePassword(): Promise<void> { return this.unavailable(); }
  async listUsers(): Promise<AuthenticatedUser[]> { return this.unavailable(); }
}

class SupabaseAuthenticationService implements AuthenticationService {
  private readonly client;

  constructor(url: string, secretKey: string) {
    this.client = createClient(url, secretKey, {
      auth: { persistSession: false, autoRefreshToken: false }
    });
  }

  async signIn(email: string, password: string): Promise<AuthenticatedUser> {
    const { data, error } = await this.client.auth.signInWithPassword({ email, password });
    if (error || !data.user?.email) {
      throw new Error("Enter a valid email address and password");
    }
    const { data: profile, error: profileError } = await this.client
      .from("app_users")
      .select("display_name, must_change_password")
      .eq("id", data.user.id)
      .single();
    if (profileError || !profile) {
      throw new Error("This account has not been invited to Move It");
    }
    return {
      id: data.user.id,
      email: data.user.email,
      displayName: String(profile.display_name),
      mustChangePassword: Boolean(profile.must_change_password)
    };
  }

  async inviteUser(email: string, displayName: string): Promise<InvitedUser> {
    const temporaryPassword = randomBytes(18).toString("base64url");
    const { data, error } = await this.client.auth.admin.createUser({
      email,
      password: temporaryPassword,
      email_confirm: true
    });
    if (error || !data.user) {
      throw new Error(`Could not create account: ${error?.message ?? "No user returned"}`);
    }
    const { error: profileError } = await this.client.from("app_users").insert({
      id: data.user.id,
      email,
      display_name: displayName,
      must_change_password: true
    });
    if (profileError) {
      await this.client.auth.admin.deleteUser(data.user.id);
      throw new Error(`Could not create account: ${profileError.message}`);
    }
    return { id: data.user.id, email, displayName, mustChangePassword: true, temporaryPassword };
  }

  async changePassword(userId: string, password: string): Promise<void> {
    const { error } = await this.client.auth.admin.updateUserById(userId, { password });
    if (error) throw new Error(`Could not change password: ${error.message}`);
    const { error: profileError } = await this.client
      .from("app_users")
      .update({ must_change_password: false })
      .eq("id", userId);
    if (profileError) throw new Error(`Could not change password: ${profileError.message}`);
  }

  async listUsers(): Promise<AuthenticatedUser[]> {
    const { data, error } = await this.client
      .from("app_users")
      .select("id, email, display_name, must_change_password")
      .order("created_at", { ascending: false });
    if (error) throw new Error(`Could not list users: ${error.message}`);
    return (data ?? []).map((user) => ({
      id: String(user.id),
      email: String(user.email),
      displayName: String(user.display_name),
      mustChangePassword: Boolean(user.must_change_password)
    }));
  }
}

export function createAuthenticationService(
  environment: NodeJS.ProcessEnv = process.env
): AuthenticationService {
  const url = environment.SUPABASE_URL;
  const secretKey = environment.SUPABASE_SECRET_KEY;

  if (!url || !secretKey) {
    return new UnavailableAuthenticationService();
  }

  return new SupabaseAuthenticationService(url, secretKey);
}
