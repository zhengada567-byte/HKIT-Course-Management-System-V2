export type UserRole = "programme_leader" | "admin" | "president";

export interface AppUser {
  id: string;
  username: string;
  password_hash?: string | null;
  role: UserRole;
  created_at: string;
  updated_at: string;
}

export interface AuthSession {
  user: AppUser;
  loginAt: string;
}
