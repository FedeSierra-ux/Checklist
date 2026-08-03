-- Tudu — esquema de sincronización por código (sin cuentas).
--
-- Pegá TODO este archivo en Supabase → SQL Editor → Run.
--
-- Cómo funciona la seguridad: la tabla queda con RLS activo y SIN políticas,
-- así que la clave pública (anon) NO puede leer ni escribir nada directamente.
-- El único acceso son las dos funciones de abajo, que son SECURITY DEFINER y
-- exigen el código de sincronización. Sin el código no se puede leer ni pisar
-- los datos de nadie, aunque la clave anon sea pública.

create table if not exists public.sync_rooms (
  code       text primary key,
  data       jsonb       not null,
  updated_at timestamptz not null default now()
);

alter table public.sync_rooms enable row level security;

-- Traer los datos de un código.
create or replace function public.sync_pull(p_code text)
returns table (data jsonb, updated_at timestamptz)
language sql
security definer
set search_path = public
as $$
  select r.data, r.updated_at
    from public.sync_rooms r
   where r.code = p_code;
$$;

-- Guardar (crear o pisar) los datos de un código.
create or replace function public.sync_push(p_code text, p_data jsonb)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  ts timestamptz := now();
begin
  -- Códigos válidos: 16 a 64 caracteres, minúsculas/números/guiones.
  -- Corta de raíz los códigos triviales tipo "casa" o "1234".
  if p_code is null or p_code !~ '^[a-z0-9-]{16,64}$' then
    raise exception 'codigo invalido';
  end if;
  if pg_column_size(p_data) > 2000000 then
    raise exception 'datos demasiado grandes';
  end if;

  insert into public.sync_rooms as r (code, data, updated_at)
       values (p_code, p_data, ts)
  on conflict (code)
    do update set data = excluded.data, updated_at = excluded.updated_at;

  return ts;
end;
$$;

revoke all on function public.sync_pull(text)         from public;
revoke all on function public.sync_push(text, jsonb)  from public;
grant execute on function public.sync_pull(text)        to anon, authenticated;
grant execute on function public.sync_push(text, jsonb) to anon, authenticated;

-- Opcional: limpiar códigos que nadie usó en un año.
-- delete from public.sync_rooms where updated_at < now() - interval '365 days';
