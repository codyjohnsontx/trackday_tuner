-- Any privilege at all to a role that is not signed in, spelled with the table
-- unqualified, which search_path puts in public. anon reaches no rider's text.

grant select on ai_request_text to anon;
