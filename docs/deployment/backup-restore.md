# MongoDB backup and restore

Back up the named DataPhone database with MongoDB Database Tools against a replica set member or managed backup endpoint. Keep the archive encrypted and access controlled. Back up the `DATAPHONE_PORT_ENCRYPTION_KEY` from the secret manager separately; MongoDB contains only encrypted port account fields and GridFS bytes. Retain the JWT signing secret according to your session recovery policy.

Example for an isolated, nonproduction database:

```sh
mongodump --uri='mongodb://127.0.0.1:27017/dataphone?replicaSet=rs0' --archive=dataphone.archive
mongorestore --uri='mongodb://127.0.0.1:27017/?replicaSet=rs0' --archive=dataphone.archive --nsFrom='dataphone.*' --nsTo='dataphone_restore_check.*'
```

Check counts of `phone_numbers`, `number_assignments`, `port_requests`, `port_documents`, `background_jobs`, `number_events`, and `fs.files`/`fs.chunks` in the restored database. Run application readiness against the restored database and download one authorized encrypted test document using the original port key. Remove the temporary restore database after verification. For a real recovery, stop writes, restore into a clean target, supply the backed-up encryption key, run readiness and audit-chain verification, and then switch traffic. Never use `--drop` against the live database during a rehearsal.

Phase 11 verified `mongodump` and `mongorestore` on two disposable local databases, checked the restored marker, and removed both databases. The production backup schedule and recovery time target require an operations owner.
