-- ============================================================================
-- PUSH NOTIFICATION SUBSCRIPTIONS — run once in Supabase SQL Editor (New
-- query → Run)
--
-- Stores one row per device that has granted notification permission on the
-- public order form (order.html). The Edge Function (set up separately)
-- reads every row here and sends a push to each one.
-- ============================================================================

create table if not exists push_subscriptions (
  id bigserial primary key,
  endpoint text not null unique,
  p256dh_key text not null,
  auth_key text not null,
  created_at timestamptz not null default now()
);
alter table push_subscriptions enable row level security;
do $$ begin
  create policy "logged in staff can read" on push_subscriptions for select using (auth.uid() is not null);
exception when duplicate_object then null; end $$;

create or replace function save_push_subscription(p_endpoint text, p_p256dh_key text, p_auth_key text)
returns void as $$
begin
  insert into push_subscriptions (endpoint, p256dh_key, auth_key) values (p_endpoint, p_p256dh_key, p_auth_key)
  on conflict (endpoint) do update set p256dh_key = excluded.p256dh_key, auth_key = excluded.auth_key;
end;
$$ language plpgsql security definer;
grant execute on function save_push_subscription(text, text, text) to anon;

create or replace function get_push_subscriber_count()
returns integer as $$
  select count(*)::integer from push_subscriptions;
$$ language sql stable security definer;
