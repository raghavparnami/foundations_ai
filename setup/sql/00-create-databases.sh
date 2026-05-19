#!/usr/bin/env bash
set -euo pipefail

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "postgres" <<-EOSQL
  CREATE DATABASE loom_catalog;
  CREATE DATABASE loom_demo_source;
EOSQL

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "loom_catalog" <<-EOSQL
  CREATE EXTENSION IF NOT EXISTS vector;
EOSQL
