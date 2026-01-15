-- Create the raw_locations table
create table raw_locations (
  id uuid default gen_random_uuid() primary key,
  device_id text not null,
  latitude float not null,
  longitude float not null,
  timestamp timestamptz not null,
  speed float,
  bearing float,
  altitude float,
  accuracy float,
  battery float,
  created_at timestamptz default now(),
  processed boolean default false
);

-- Index for faster querying by device and time
create index idx_raw_locations_device_time on raw_locations (device_id, timestamp desc);

-- RLS Policies (Optional but recommended)
alter table raw_locations enable row level security;

-- Allow insert from service role or authenticated users (adjust as needed)
-- For the webhook, we might bypass RLS if using the service role key, 
-- or we can allow public insert if we rely on device_id validation in the API.
create policy "Enable insert for authenticated users only"
on raw_locations for insert
to authenticated
with check (true);

create policy "Enable read for users based on ownership" 
on raw_locations for select
to authenticated
using (true); -- Placeholder: Ideally check if device_id belongs to user
