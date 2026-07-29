drop policy if exists "Players can receive game realtime" on realtime.messages;
drop policy if exists "Players can send game realtime" on realtime.messages;

create policy "Players can receive game realtime"
on realtime.messages
for select
to authenticated
using (
  (select realtime.topic()) like 'game:street-%'
  and realtime.messages.extension in ('broadcast', 'presence')
);

create policy "Players can send game realtime"
on realtime.messages
for insert
to authenticated
with check (
  (select realtime.topic()) like 'game:street-%'
  and realtime.messages.extension in ('broadcast', 'presence')
);
