#!/bin/sh
# Creates the test database next to the dev one (runs once, on first init of the db volume).
set -e
psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "CREATE DATABASE lotusyoga_test OWNER $POSTGRES_USER"
