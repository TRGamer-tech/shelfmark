#!/usr/bin/env python3
"""A stand-in for the Supabase Data API, for trying the server part without a Supabase project.

It answers POST /rest/v1/rpc/<function> the way Supabase does for the functions of
schema.sql: the JSON body becomes named arguments, the function runs as the role "anon",
its result comes back as JSON, and an exception raised in SQL becomes HTTP 400 with
{"code", "message", "details", "hint"}.

    createdb shelfmark_dev
    psql -d shelfmark_dev -c "create role anon nologin; create role authenticated nologin"
    psql -d shelfmark_dev -v ON_ERROR_STOP=1 -f supabase/schema.sql
    python3 supabase/dev_server.py --dsn "dbname=shelfmark_dev" --port 54330

Then point the app or the live test at http://127.0.0.1:54330 with the key below.
Needs psycopg2 (pip install psycopg2-binary). Not meant for anything but development.
"""
import argparse
import json
import re
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import psycopg2
import psycopg2.extras

DEFAULT_KEY = "sb_publishable_local_development"


def make_handler(dsn, key):
    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def log_message(self, *args):
            pass

        def reply(self, status, body):
            data = json.dumps(body).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def do_POST(self):
            length = int(self.headers.get("Content-Length") or 0)
            raw = self.rfile.read(length) if length else b"{}"
            if self.headers.get("apikey") != key:
                return self.reply(401, {"message": "Invalid API key", "hint": "Double check your Supabase `anon` or `service_role` API key."})
            # The real gateway reads a bearer token as a JWT. A publishable key is not one.
            bearer = self.headers.get("Authorization", "")
            if bearer.startswith("Bearer sb_"):
                return self.reply(401, {"code": "PGRST301", "message": "Invalid JWT"})
            match = re.fullmatch(r"/rest/v1/rpc/([a-z_][a-z0-9_]*)", self.path.split("?")[0])
            if not match:
                return self.reply(404, {"code": "PGRST125", "message": "Invalid path specified in request URL"})
            name = match.group(1)
            try:
                body = json.loads(raw.decode("utf-8") or "{}")
                if not isinstance(body, dict):
                    raise ValueError("the body has to be a JSON object")
            except ValueError as error:
                return self.reply(400, {"code": "PGRST102", "message": str(error)})
            connection = psycopg2.connect(dsn)
            try:
                with connection.cursor() as cursor:
                    cursor.execute(
                        "select p.proargnames, p.proargtypes::regtype[]::text[] from pg_proc p "
                        "join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = %s",
                        (name,),
                    )
                    row = cursor.fetchone()
                    arguments = dict(zip(row[0] or [], row[1] or [])) if row else {}
                    if row is None or any(k not in arguments for k in body):
                        return self.reply(404, {"code": "PGRST202", "message": f"Could not find the function public.{name} in the schema cache"})
                    given = [k for k in arguments if k in body]
                    cursor.execute("set role anon")
                    if given:
                        call = ", ".join(f"{k} => x.{k}" for k in given)
                        columns = ", ".join(f"{k} {arguments[k]}" for k in given)
                        cursor.execute(f"select public.{name}({call}) from jsonb_to_record(%s::jsonb) as x({columns})", (json.dumps(body),))
                    else:
                        cursor.execute(f"select public.{name}()")
                    result = cursor.fetchone()[0]
                connection.commit()
                return self.reply(200, result)
            except psycopg2.Error as error:
                connection.rollback()
                diag = error.diag
                return self.reply(400, {"code": error.pgcode, "message": diag.message_primary, "details": diag.message_detail, "hint": diag.message_hint})
            finally:
                connection.close()

    return Handler


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--dsn", default="dbname=shelfmark_dev")
    parser.add_argument("--port", type=int, default=54330)
    parser.add_argument("--key", default=DEFAULT_KEY)
    options = parser.parse_args()
    psycopg2.extras.register_uuid()
    server = ThreadingHTTPServer(("127.0.0.1", options.port), make_handler(options.dsn, options.key))
    print(f"Shelfmark development server on http://127.0.0.1:{options.port}  key: {options.key}", flush=True)
    server.serve_forever()
