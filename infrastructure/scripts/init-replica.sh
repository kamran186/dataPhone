#!/bin/sh
set -eu
uri='mongodb://mongo:27017/admin?directConnection=true'
mongosh "$uri" --quiet --eval 'try { rs.status() } catch (error) { rs.initiate({ _id: "rs0", members: [{ _id: 0, host: "mongo:27017" }] }) }'
until mongosh "$uri" --quiet --eval 'quit(db.hello().isWritablePrimary ? 0 : 1)'; do sleep 1; done
