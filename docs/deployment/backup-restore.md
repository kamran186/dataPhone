# PostgreSQL backup and restore

Create a custom-format PostgreSQL dump with `pg_dump --format=custom --file=dataphone.dump "$DATABASE_URL"`. Encrypt and restrict access to the dump. Back up the port encryption key separately; both are required to restore encrypted account fields and documents. Include the signing secret according to the session recovery policy.

Rehearse restoration into a separate PostgreSQL database using `pg_restore --no-owner --dbname="$RESTORE_DATABASE_URL" dataphone.dump`. Start an isolated API against the restored database with workers disabled, then check readiness, audit chain verification, representative ownership history, and encrypted document downloads. Record counts and the restore duration before enabling workers. Never test a restore over an active database.
