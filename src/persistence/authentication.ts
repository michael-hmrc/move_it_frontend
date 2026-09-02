import { createClient } from "@supabase/supabase-js";

export interface AuthenticatedUser {
  id: string;
  email: string;
  displayName: string;
  mustChangePassword: boolean;
  status: "pending" | "approved" | "rejected";
}

export interface AuthenticationService {
  signIn(email: string, password: string): Promise<AuthenticatedUser>;
  requestAccess(email: string, displayName: string, password: string): Promise<void>;
  approveUser(userId: string): Promise<void>;
  listUsers(): Promise<AuthenticatedUser[]>;
}

class UnavailableAuthenticationService implements AuthenticationService {
  private unavailable(): never { throw new Error("Authentication is not configured"); }
  async signIn(): Promise<AuthenticatedUser> { return this.unavailable(); }
  async requestAccess(): Promise<void> { return this.unavailable(); }
  async approveUser(): Promise<void> { return this.unavailable(); }
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
      .select("display_name, must_change_password, status")
      .eq("id", data.user.id)
      .single();
    if (profileError || !profile) {
      throw new Error("This account has not been invited to Move It");
    }
    return {
      id: data.user.id,
      email: data.user.email,
      displayName: String(profile.display_name),
      mustChangePassword: Boolean(profile.must_change_password),
      status: profile.status as AuthenticatedUser["status"]
    };
  }

  async requestAccess(email: string, displayName: string, password: string): Promise<void> {
    const { data, error } = await this.client.auth.admin.createUser({
      email,
      password,
      email_confirm: true
    });
    if (error || !data.user) {
      throw new Error(`Could not create account: ${error?.message ?? "No user returned"}`);
    }
    const { error: profileError } = await this.client.from("app_users").insert({
      id: data.user.id,
      email,
      display_name: displayName,
      must_change_password: false,
      status: "pending"
    });
    if (profileError) {
      await this.client.auth.admin.deleteUser(data.user.id);
      throw new Error(`Could not create account: ${profileError.message}`);
    }
  }

  async approveUser(userId: string): Promise<void> {
    const { error } = await this.client.from("app_users").update({ status: "approved" }).eq("id", userId);
    if (error) throw new Error(`Could not approve account: ${error.message}`);
  }

  async listUsers(): Promise<AuthenticatedUser[]> {
    const { data, error } = await this.client
      .from("app_users")
      .select("id, email, display_name, must_change_password, status")
      .order("created_at", { ascending: false });
    if (error) throw new Error(`Could not list users: ${error.message}`);
    return (data ?? []).map((user) => ({
      id: String(user.id),
      email: String(user.email),
      displayName: String(user.display_name),
      mustChangePassword: Boolean(user.must_change_password),
      status: user.status as AuthenticatedUser["status"]
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
