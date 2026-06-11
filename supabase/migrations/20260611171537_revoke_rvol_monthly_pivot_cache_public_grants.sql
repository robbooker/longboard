-- Keep the scanner pivot cache server-only. RLS has no anon/authenticated
-- policies, and these revokes remove inherited/default table privileges too.

revoke all on rvol_monthly_pivot_cache from anon;
revoke all on rvol_monthly_pivot_cache from authenticated;
grant select, insert, update, delete on rvol_monthly_pivot_cache to service_role;
