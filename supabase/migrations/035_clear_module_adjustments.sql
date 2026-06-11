-- Course search and module management now both use modules table only.
-- Remove stale per-year overrides that caused term/year mismatches.
delete from public.module_adjustments;
