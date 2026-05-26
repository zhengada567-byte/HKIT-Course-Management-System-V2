-- Programme quota: FT / PT headcount caps (no per-stream quota).

alter table public.programme_quota_confirmations
  add column if not exists ft_quota integer not null default 0
    check (ft_quota >= 0),
  add column if not exists pt_quota integer not null default 0
    check (pt_quota >= 0);

-- Legacy single programme_quota -> FT (keep programme_quota column for old rows).
update public.programme_quota_confirmations
set
  ft_quota = programme_quota,
  updated_at = now()
where ft_quota = 0
  and pt_quota = 0
  and programme_quota > 0;
