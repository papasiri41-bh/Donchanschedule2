-- ============================================================
-- เว็บบอร์ดตารางนัดหมายสำนักงานปศุสัตว์อำเภอดอนจาน
-- รันใน Supabase > SQL Editor > New query
-- สคริปต์นี้ออกแบบให้รันซ้ำได้
-- ============================================================

create extension if not exists "pgcrypto";

-- -------------------- ตารางนัดหมาย --------------------
create table if not exists public.appointments (
  id uuid primary key default gen_random_uuid(),
  appointment_date date not null,
  end_date date,
  start_time time,
  end_time time,
  is_all_day boolean not null default false,
  title text not null,
  activity_type text not null default 'อื่นๆ',
  location text not null,
  activity_detail text,
  dress_code text,
  participants text not null,
  status text not null default 'กำหนดการ',
  note text,
  created_by text not null default 'ไม่ระบุชื่อ',
  created_at timestamptz not null default now(),
  updated_by text,
  updated_at timestamptz not null default now()
);

-- รองรับกรณีมีตารางเดิมอยู่แล้ว แต่บางคอลัมน์ยังไม่มี
alter table public.appointments add column if not exists end_date date;
alter table public.appointments add column if not exists start_time time;
alter table public.appointments add column if not exists end_time time;
alter table public.appointments add column if not exists is_all_day boolean not null default false;
alter table public.appointments add column if not exists activity_type text not null default 'อื่นๆ';
alter table public.appointments add column if not exists activity_detail text;
alter table public.appointments add column if not exists dress_code text;
alter table public.appointments add column if not exists status text not null default 'กำหนดการ';
alter table public.appointments add column if not exists note text;
alter table public.appointments add column if not exists created_by text not null default 'ไม่ระบุชื่อ';
alter table public.appointments add column if not exists created_at timestamptz not null default now();
alter table public.appointments add column if not exists updated_by text;
alter table public.appointments add column if not exists updated_at timestamptz not null default now();

create index if not exists appointments_date_idx on public.appointments (appointment_date);
create index if not exists appointments_date_time_idx on public.appointments (appointment_date, start_time);

create or replace function public.set_appointments_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_appointments_updated_at on public.appointments;
create trigger trg_appointments_updated_at
before update on public.appointments
for each row execute function public.set_appointments_updated_at();

-- -------------------- ตารางวันหยุด --------------------
create table if not exists public.holidays (
  id uuid primary key default gen_random_uuid(),
  holiday_date date not null unique,
  name text not null,
  is_official boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists holidays_date_idx on public.holidays (holiday_date);

-- วันหยุดหลักเบื้องต้นสำหรับปี 2569
-- วันหยุดทางจันทรคติหรือวันหยุดพิเศษอื่นสามารถเพิ่มภายหลังได้ใน Table Editor
insert into public.holidays (holiday_date, name, is_official) values
  ('2026-01-01', 'วันขึ้นปีใหม่', true),
  ('2026-01-02', 'วันหยุดพิเศษ', true),
  ('2026-04-06', 'วันจักรี', true),
  ('2026-04-13', 'วันสงกรานต์', true),
  ('2026-04-14', 'วันสงกรานต์', true),
  ('2026-04-15', 'วันสงกรานต์', true),
  ('2026-05-04', 'วันฉัตรมงคล', true),
  ('2026-06-03', 'วันเฉลิมพระชนมพรรษาสมเด็จพระนางเจ้าฯ พระบรมราชินี', true),
  ('2026-07-28', 'วันเฉลิมพระชนมพรรษาพระบาทสมเด็จพระเจ้าอยู่หัว', true),
  ('2026-08-12', 'วันแม่แห่งชาติ', true),
  ('2026-10-13', 'วันนวมินทรมหาราช', true),
  ('2026-10-23', 'วันปิยมหาราช', true),
  ('2026-12-05', 'วันพ่อแห่งชาติ', true),
  ('2026-12-10', 'วันรัฐธรรมนูญ', true),
  ('2026-12-31', 'วันสิ้นปี', true)
on conflict (holiday_date) do update set
  name = excluded.name,
  is_official = excluded.is_official;

-- -------------------- สิทธิ์ Data API --------------------
grant usage on schema public to anon, authenticated;
grant select, insert, update on table public.appointments to anon, authenticated;
grant select on table public.holidays to anon, authenticated;

alter table public.appointments enable row level security;
alter table public.holidays enable row level security;

-- ลบนโยบายชื่อเดิม/ชื่อใหม่ก่อน เพื่อไม่เกิด ERROR 42710 เมื่อรันซ้ำ
drop policy if exists "อ่านตารางนัดหมายได้ทุกคน" on public.appointments;
drop policy if exists "เพิ่มตารางนัดหมายได้ทุกคน" on public.appointments;
drop policy if exists "แก้ไขตารางนัดหมายได้ทุกคน" on public.appointments;
drop policy if exists "public_read_appointments" on public.appointments;
drop policy if exists "public_insert_appointments" on public.appointments;
drop policy if exists "public_update_appointments" on public.appointments;

create policy "public_read_appointments"
on public.appointments
for select
to anon, authenticated
using (true);

create policy "public_insert_appointments"
on public.appointments
for insert
to anon, authenticated
with check (true);

create policy "public_update_appointments"
on public.appointments
for update
to anon, authenticated
using (true)
with check (true);

-- วันหยุดเปิดให้อ่านอย่างเดียวจากหน้าเว็บ
drop policy if exists "public_read_holidays" on public.holidays;
create policy "public_read_holidays"
on public.holidays
for select
to anon, authenticated
using (true);

-- -------------------- Realtime --------------------
-- เพิ่มตาราง appointments เข้า publication เฉพาะเมื่อยังไม่มี
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'appointments'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.appointments;
  END IF;
END $$;

-- ตรวจสอบผลลัพธ์
select
  'พร้อมใช้งาน' as status,
  (select count(*) from public.holidays) as holiday_count;
