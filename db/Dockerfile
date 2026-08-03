FROM pgvector/pgvector:pg16

RUN apt-get update && apt-get install -y \
    build-essential postgresql-server-dev-16 git flex bison \
    && rm -rf /var/lib/apt/lists/*

RUN git clone --depth 1 --branch PG16 https://github.com/apache/age.git /tmp/age \
    && cd /tmp/age \
    && make PG_CONFIG=/usr/lib/postgresql/16/bin/pg_config \
    && make install PG_CONFIG=/usr/lib/postgresql/16/bin/pg_config \
    && rm -rf /tmp/age
