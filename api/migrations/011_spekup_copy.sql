-- User-facing catalog copy. Existing interests, listings, and accounts stay.

update plan_catalog
set summary = 'Optional interest in supporting Spekup later. Saving interest does not start a membership or a charge.'
where code = 'supporter'
  and summary like '%Common Voice%';
