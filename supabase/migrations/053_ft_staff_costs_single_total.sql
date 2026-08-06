-- If 052 already created academic_cost/admin_cost columns, migrate to a single total.

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'programme_ft_staff_costs'
      and column_name = 'academic_cost'
  ) and exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'programme_ft_staff_costs'
      and column_name = 'admin_cost'
  ) then
    if not exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'programme_ft_staff_costs'
        and column_name = 'total_cost'
    ) then
      alter table public.programme_ft_staff_costs
        add column total_cost numeric(12, 2) not null default 0 check (total_cost >= 0);
    end if;

    update public.programme_ft_staff_costs
    set total_cost = coalesce(academic_cost, 0) + coalesce(admin_cost, 0)
    where total_cost = 0
      and (coalesce(academic_cost, 0) <> 0 or coalesce(admin_cost, 0) <> 0);

    alter table public.programme_ft_staff_costs
      drop column if exists academic_cost,
      drop column if exists admin_cost;
  end if;
end $$;
