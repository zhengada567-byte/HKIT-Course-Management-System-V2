import { supabase } from "../lib/supabase";

export async function changeAppUserPassword(params: {
  actorUserId: string;
  targetUsername: string;
  newPassword: string;
}) {
  const { error } = await supabase.rpc("change_app_user_password", {
    actor_user_id: params.actorUserId,
    target_username: params.targetUsername,
    new_password: params.newPassword,
  });

  if (error) {
    throw error;
  }
}
