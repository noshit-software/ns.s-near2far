CREATE EXTENSION IF NOT EXISTS vector;
LOAD 'age';
CREATE EXTENSION IF NOT EXISTS age;
SET search_path = ag_catalog, "$user", public;
SELECT * FROM ag_catalog.create_graph('graph');
