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


-- ============================================================
--  Imágenes de las notas (Supabase Storage)
-- ============================================================
--
-- Bucket público, pero con nombres de archivo aleatorios de 128 bits: la URL
-- es imposible de adivinar. Los archivos se guardan bajo un prefijo derivado
-- del código de sincronización (su hash), así cada espacio tiene su carpeta.
--
-- OJO — esto es distinto de la tabla de arriba: acá la clave publicable SÍ
-- alcanza para subir y borrar. Si tu clave es pública (por ejemplo, está
-- commiteada en un repo público), cualquiera que la lea puede llenar o vaciar
-- el bucket. El límite de 5 MB por archivo y la lista de tipos permitidos
-- acotan el daño, pero no lo eliminan.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
     values ('notas', 'notas', true, 5242880,
             array['image/jpeg','image/png','image/webp','image/gif'])
on conflict (id) do update
   set public             = true,
       file_size_limit    = 5242880,
       allowed_mime_types  = array['image/jpeg','image/png','image/webp','image/gif'];

-- Las políticas se recrean para poder correr este archivo más de una vez.
drop policy if exists "notas: leer"  on storage.objects;
drop policy if exists "notas: subir" on storage.objects;
drop policy if exists "notas: borrar" on storage.objects;

create policy "notas: leer" on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'notas');

create policy "notas: subir" on storage.objects
  for insert to anon, authenticated
  with check (bucket_id = 'notas');

-- Borrar es lo que permite recuperar espacio al eliminar una nota.
create policy "notas: borrar" on storage.objects
  for delete to anon, authenticated
  using (bucket_id = 'notas');
