-- `user` rather than `all`: every user-defined trigger, leaving Postgres's
-- internal constraint triggers alone. It is the more careful spelling of the same
-- thing, and it silences this trigger just as completely.

alter table auth.users disable trigger user;
