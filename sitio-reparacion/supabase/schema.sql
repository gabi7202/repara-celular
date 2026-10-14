-- ═══════════════════════════════════════════════════════════════════════
-- TapaTech · Base de datos de leads (Supabase / Postgres)
-- Ejecuta este script en Supabase → SQL Editor. Crea tablas, índices y RLS.
-- La web inserta con la ANON KEY (solo INSERT); el panel y las funciones
-- de Vercel leen y actualizan con la SERVICE KEY (bypass de RLS).
-- ═══════════════════════════════════════════════════════════════════════

create table if not exists public.leads (
  id            uuid primary key default gen_random_uuid(),
  folio         text not null,
  tipo          text not null default 'otro'
                check (tipo in ('diagnostico','cotizacion','callback','cita','oferta','boleto','otro')),
  estado        text not null default 'nuevo'
                check (estado in ('nuevo','contactado','cotizado','autorizado','en_reparacion','entregado','perdido')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz,
  -- cliente
  nombre        text,
  telefono      text,
  telefono_texto text,
  email         text,
  consentimiento boolean default false,
  -- equipo y falla
  equipo        text,
  marca         text,
  modelo        text,
  falla         text,
  detalle       text,
  -- servicio
  servicio      text,
  calidad       text,
  rango_precio  text,
  tiempo        text,
  extras        text,
  oferta        text,
  -- logística
  domicilio     boolean default false,
  colonia       text,
  contacto      text,
  cita_fecha    text,
  cita_hora     text,
  -- seguimiento
  notas         text,
  -- trazabilidad
  origen        text,
  referrer      text,
  pagina        text,
  utm           text,
  idioma        text,
  pantalla      text,
  online        boolean,
  ua            text,
  ip            text
);

create index if not exists leads_created_idx on public.leads (created_at desc);
create index if not exists leads_estado_idx  on public.leads (estado);
create index if not exists leads_tipo_idx    on public.leads (tipo);
create index if not exists leads_tel_idx     on public.leads (telefono);
create index if not exists leads_folio_idx   on public.leads (folio);

create table if not exists public.eventos (
  id         bigint generated always as identity primary key,
  ev         text not null,
  data       jsonb default '{}'::jsonb,
  pagina     text,
  ip         text,
  created_at timestamptz not null default now()
);
create index if not exists eventos_created_idx on public.eventos (created_at desc);
create index if not exists eventos_ev_idx on public.eventos (ev);

-- ══ Row Level Security ════════════════════════════════════════════════
alter table public.leads   enable row level security;
alter table public.eventos enable row level security;

-- La web (anon) SOLO puede insertar solicitudes; nunca leer ni borrar.
drop policy if exists "insert publico de leads" on public.leads;
create policy "insert publico de leads" on public.leads
  for insert to anon, authenticated with check (true);

drop policy if exists "insert publico de eventos" on public.eventos;
create policy "insert publico de eventos" on public.eventos
  for insert to anon, authenticated with check (true);

-- SELECT/UPDATE/DELETE quedan reservados a la service_role (panel y API).
-- Si prefieres leer directo desde admin.html con la anon key, crea un rol
-- "staff" y añade políticas de select con auth.uid() — no lo actives sin
-- autenticación real, porque expondrías los datos de tus clientes.

-- ══ Vista rápida para el día a día (opcional) ═════════════════════════
create or replace view public.leads_hoy as
  select folio, tipo, estado, nombre, telefono, equipo, marca, modelo, falla,
         domicilio, cita_fecha, cita_hora, created_at
  from public.leads
  where created_at >= current_date
  order by created_at desc;

-- ══ Función de conteo para el dashboard (opcional) ════════════════════
create or replace function public.resumen_leads(dias integer default 7)
returns table (dia date, total bigint, diagnosticos bigint, citas bigint, domicilio bigint)
language sql stable as $$
  select created_at::date as dia,
         count(*) as total,
         count(*) filter (where tipo = 'diagnostico') as diagnosticos,
         count(*) filter (where tipo = 'cita') as citas,
         count(*) filter (where domicilio) as domicilio
  from public.leads
  where created_at >= current_date - (dias || ' days')::interval
  group by 1 order by 1 desc;
$$;
