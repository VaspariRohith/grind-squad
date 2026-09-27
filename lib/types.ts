export type Profile = {
  id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  bio: string | null;
  is_admin: boolean;
  created_at: string;
};

export type Category = {
  id: string;
  name: string;
  icon: string;
  color_from: string;
  color_to: string;
  daily_cap: number;
  is_negative: boolean;
  sort: number;
};

export type ChoiceOption = { label: string; points: number };

export type Activity = {
  id: string;
  category_id: string;
  name: string;
  hint: string | null;
  icon: string;
  kind: "check" | "count" | "choice";
  points: number;
  unit: string | null;
  step: number;
  max_value: number | null;
  options: ChoiceOption[] | null;
  sort: number;
  active: boolean;
};

export type Log = {
  id: string;
  user_id: string;
  day: string;
  activity_id: string;
  category_id: string;
  value: number;
  points: number;
  is_negative: boolean;
  voided: boolean;
  created_at: string;
  updated_at: string;
};

export type Freeze = {
  id: string;
  user_id: string;
  start_day: string;
  end_day: string;
  reason: string | null;
  status: "pending" | "approved" | "denied";
  created_at: string;
};

export type Adjustment = {
  id: string;
  user_id: string;
  day: string;
  points: number;
  reason: string;
  created_at: string;
};

export type Report = {
  id: string;
  log_id: string;
  reporter_id: string;
  reported_user_id: string;
  note: string;
  round: number;
  remove_votes: number;
  keep_votes: number;
  status: "open" | "removed" | "kept" | "dismissed" | "admin_review";
  outcome_note: string | null;
  closes_at: string;
  resolved_at: string | null;
  created_at: string;
};

export type Award = {
  id: string;
  user_id: string;
  kind: "month_champion" | "month_last" | "year_champion" | "year_last";
  period: string;
  title: string;
  points: number;
  created_at: string;
};

export type BoardRow = {
  user_id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  points: number;
  days_logged: number;
  frozen_days: number;
  current_streak: number;
  best_streak: number;
  rank: number;
};

export type InviteCode = {
  code: string;
  note: string | null;
  created_at: string;
  used_by: string | null;
  used_at: string | null;
  revoked: boolean;
};
