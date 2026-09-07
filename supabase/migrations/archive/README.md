# Archived migrations — a changelog, not a rebuild path

Everything in here (001–074) has been applied to production and is
superseded by `../000_baseline.sql`, which is the schema as `pg_dump`
actually found it.

They are kept because they are the only record of *why* the schema looks
the way it does — each one carries the reasoning for the change it made,
and several carry the description of a bug that is now fixed. Deleting
them would delete that.

They are **not** replayable, and never were. `002_workspaces.sql` creates a
policy on `pm_tasks` referencing `workspace_id` — a column a later file
adds — and calls `public.has_role`, which `006` defines. Running these in
order against an empty database has always failed on the second file. They
worked only because they were applied by hand, in order, to a database that
had already drifted from what they describe.

That is the gap the baseline closes. From `000_baseline.sql` onward the
files and the database agree, and `npm run db:test` proves it on every
push by rebuilding from empty and asserting the security properties.

**Do not add files here.** New migrations go in `../` numbered from 075.
