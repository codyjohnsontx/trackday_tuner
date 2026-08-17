-- The same silencing without naming the trigger.
--
-- `disable trigger all` turns off every trigger on the table, this one included,
-- so a guard that only watched for the trigger's own name would call this clean.
-- It is the form someone reaches for around a bulk load precisely because they do
-- not want to enumerate triggers - which is also why it is easy to leave off.

alter table auth.users disable trigger all;
