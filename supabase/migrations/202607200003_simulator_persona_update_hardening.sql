-- Supabase hosted projects may inherit broader default table privileges than
-- the local stack. Persona definitions are append-only, so authenticated
-- clients must never receive a direct UPDATE path even when RLS would filter
-- the operation to zero rows.

begin;

revoke update on table public.simulation_personas
  from public, anon, authenticated;

commit;
