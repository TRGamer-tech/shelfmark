#!/usr/bin/env python3
"""A stand-in for a Supabase project, for trying Shelfmark without one.

It speaks the two parts of Supabase that the apps use, on top of a local PostgreSQL:

  * Sign-in (/auth/v1/...): sign up, sign in with e-mail and password, refresh, sign out,
    password reset. Users live in the table auth.users of the local database.
  * Storage for cover photos (/storage/v1/object/shelfmark-covers/...): upload, the public
    address, remove. Pictures are kept in memory and are gone when this server stops.
  * The Data API for functions (POST /rest/v1/rpc/<function>): the JSON body becomes
    named arguments, the function runs as "authenticated" for a signed-in caller and as
    "anon" otherwise, its result comes back as JSON, and an exception raised in SQL
    becomes HTTP 400 with {"code", "message", "details", "hint"}.

    createdb shelfmark_dev
    psql -d shelfmark_dev -v ON_ERROR_STOP=1 -f supabase/local.sql -f supabase/schema.sql
    python3 supabase/dev_server.py --dsn "dbname=shelfmark_dev" --port 54330

Then point the app, the website or the live tests at http://127.0.0.1:54330 with the key
below. Needs psycopg2 (pip install psycopg2-binary). For development only: passwords are
kept as plain hashes and the tokens are signed with a key that is written right here.
"""
import argparse
import base64
import hashlib
import hmac
import json
import re
import secrets
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

import psycopg2
import psycopg2.extras

DEFAULT_KEY = "sb_publishable_local_development"
BUCKET = "shelfmark-covers"
PICTURES = {"image/jpeg", "image/png", "image/webp"}
SIGNING_KEY = b"shelfmark-development-only"


def b64(data):
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def make_token(user_id, email, seconds):
    header = b64(json.dumps({"alg": "HS256", "typ": "JWT"}).encode())
    now = int(time.time())
    claims = {"sub": user_id, "email": email, "role": "authenticated", "aud": "authenticated", "iat": now, "exp": now + seconds}
    body = b64(json.dumps(claims).encode())
    signature = b64(hmac.new(SIGNING_KEY, f"{header}.{body}".encode(), hashlib.sha256).digest())
    return f"{header}.{body}.{signature}", now + seconds


def read_token(token):
    """Returns the claims of a token this server made, or None."""
    try:
        header, body, signature = token.split(".")
        expected = b64(hmac.new(SIGNING_KEY, f"{header}.{body}".encode(), hashlib.sha256).digest())
        if not hmac.compare_digest(signature, expected):
            return None
        claims = json.loads(base64.urlsafe_b64decode(body + "=" * (-len(body) % 4)))
        return claims if claims.get("exp", 0) > time.time() else None
    except (ValueError, TypeError):
        return None


def hash_password(password):
    return hashlib.sha256(("shelfmark-dev:" + password).encode()).hexdigest()


def make_handler(dsn, key, token_seconds, confirm_email):
    refresh_tokens = {}
    pictures = {}

    def user_json(row):
        stamp = row[3].isoformat() if row[3] else None
        return {
            "id": str(row[0]), "aud": "authenticated", "role": "authenticated", "email": row[1],
            "email_confirmed_at": stamp if row[2] else None, "created_at": stamp, "updated_at": stamp,
            "app_metadata": {"provider": "email", "providers": ["email"]}, "user_metadata": {}, "identities": [],
        }

    def session_json(row):
        token, expires_at = make_token(str(row[0]), row[1], token_seconds)
        refresh = secrets.token_urlsafe(24)
        refresh_tokens[refresh] = str(row[0])
        return {
            "access_token": token, "token_type": "bearer", "expires_in": token_seconds, "expires_at": expires_at,
            "refresh_token": refresh, "user": user_json(row),
        }

    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def log_message(self, *args):
            pass

        def reply(self, status, body=None, raw=None, content_type=None):
            data = raw if raw is not None else b"" if body is None else json.dumps(body).encode("utf-8")
            self.send_response(status)
            # A website on another address may call this server, as it may call Supabase.
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Headers", self.headers.get("Access-Control-Request-Headers") or "*")
            self.send_header("Access-Control-Allow-Methods", "GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS")
            self.send_header("Access-Control-Max-Age", "3600")
            if raw is not None:
                self.send_header("Content-Type", content_type or "application/octet-stream")
            elif body is not None:
                self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def body(self):
            length = int(self.headers.get("Content-Length") or 0)
            raw = self.rfile.read(length) if length else b""
            if not raw.strip():
                return {}
            value = json.loads(raw.decode("utf-8"))
            if not isinstance(value, dict):
                raise ValueError("the body has to be a JSON object")
            return value

        def caller(self):
            """The claims of the signed-in caller, None for nobody, or False for a token that is no good."""
            bearer = self.headers.get("Authorization", "")
            if not bearer.startswith("Bearer "):
                return None
            token = bearer[len("Bearer "):]
            # The website's library sends the project key here while nobody is signed in.
            if token == key:
                return None
            return read_token(token) or False

        def do_OPTIONS(self):
            self.reply(200)

        def storage(self, method, path):
            """Cover photos. Everybody writes below a folder named after their own user id, reading needs only the address."""
            public = re.fullmatch(r"/storage/v1/object/public/([^/]+)/(.+)", path)
            if public and method == "GET":
                picture = pictures.get(public.group(2)) if public.group(1) == BUCKET else None
                if picture is None:
                    return self.reply(400, {"statusCode": "404", "error": "not_found", "message": "Object not found"})
                return self.reply(200, raw=picture[1], content_type=picture[0])
            match = re.fullmatch(r"/storage/v1/object/([^/]+)/(.+)", path)
            if not match:
                return self.reply(404, {"message": "not found"})
            if match.group(1) != BUCKET:
                return self.reply(400, {"statusCode": "404", "error": "Bucket not found", "message": "Bucket not found"})
            claims = self.caller()
            name = match.group(2)
            if not claims or name.split("/")[0] != claims["sub"]:
                return self.reply(400, {"statusCode": "403", "error": "Unauthorized", "message": "new row violates row-level security policy"})
            if method == "DELETE":
                pictures.pop(name, None)
                return self.reply(200, {"message": "Successfully deleted"})
            length = int(self.headers.get("Content-Length") or 0)
            kind = (self.headers.get("Content-Type") or "").split(";")[0].strip()
            if kind not in PICTURES:
                return self.reply(400, {"statusCode": "415", "error": "invalid_mime_type", "message": "mime type " + kind + " is not supported"})
            if length > 2097152:
                return self.reply(400, {"statusCode": "413", "error": "Payload too large", "message": "The object exceeded the maximum allowed size"})
            if name in pictures and self.headers.get("x-upsert") != "true":
                return self.reply(400, {"statusCode": "409", "error": "Duplicate", "message": "The resource already exists"})
            pictures[name] = (kind, self.rfile.read(length))
            return self.reply(200, {"Key": BUCKET + "/" + name, "Id": str(uuid.uuid4())})

        def do_DELETE(self):
            path = urlparse(self.path).path
            if self.headers.get("apikey") != key:
                return self.reply(401, {"message": "No API key found in request"})
            return self.storage("DELETE", path)

        def do_PUT(self):
            return self.do_POST()

        def do_GET(self):
            path = urlparse(self.path).path
            if path.startswith("/storage/v1/object/public/"):
                return self.storage("GET", path)
            if self.headers.get("apikey") != key:
                return self.reply(401, {"message": "No API key found in request"})
            if path == "/auth/v1/user":
                claims = self.caller()
                if not claims:
                    return self.reply(401, {"code": 401, "error_code": "bad_jwt", "msg": "invalid JWT"})
                with psycopg2.connect(dsn) as connection, connection.cursor() as cursor:
                    cursor.execute("select id, email, confirmed, created_at from auth.users where id = %s", (claims["sub"],))
                    row = cursor.fetchone()
                if row is None:
                    return self.reply(403, {"code": 403, "error_code": "user_not_found", "msg": "User from sub claim in JWT does not exist"})
                return self.reply(200, user_json(row))
            if path == "/auth/v1/settings":
                return self.reply(200, {"disable_signup": False, "mailer_autoconfirm": not confirm_email, "external": {"email": True}})
            return self.reply(404, {"message": "not found"})

        def do_POST(self):
            parsed = urlparse(self.path)
            path = parsed.path
            if self.headers.get("apikey") != key:
                return self.reply(401, {"message": "Invalid API key", "hint": "Double check your Supabase `anon` or `service_role` API key."})
            if path.startswith("/storage/v1/"):
                return self.storage("POST", path)
            try:
                body = self.body()
            except ValueError as error:
                return self.reply(400, {"code": "PGRST102", "message": str(error)})
            if path.startswith("/auth/v1/"):
                return self.auth(path, parse_qs(parsed.query), body)
            match = re.fullmatch(r"/rest/v1/rpc/([a-z_][a-z0-9_]*)", path)
            if not match:
                return self.reply(404, {"code": "PGRST125", "message": "Invalid path specified in request URL"})
            return self.rpc(match.group(1), body)

        def auth(self, path, query, body):
            email = str(body.get("email", "")).strip().lower()
            password = str(body.get("password", ""))
            connection = psycopg2.connect(dsn)
            try:
                with connection, connection.cursor() as cursor:
                    if path == "/auth/v1/signup":
                        if "@" not in email:
                            return self.reply(400, {"code": 400, "error_code": "validation_failed", "msg": "Unable to validate email address: invalid format"})
                        if len(password) < 6:
                            return self.reply(422, {"code": 422, "error_code": "weak_password", "msg": "Password should be at least 6 characters."})
                        cursor.execute("select 1 from auth.users where email = %s", (email,))
                        if cursor.fetchone():
                            return self.reply(422, {"code": 422, "error_code": "user_already_exists", "msg": "User already registered"})
                        cursor.execute(
                            "insert into auth.users (id, email, encrypted_password, confirmed) values (%s, %s, %s, %s) returning id, email, confirmed, created_at",
                            (str(uuid.uuid4()), email, hash_password(password), not confirm_email),
                        )
                        row = cursor.fetchone()
                        # With confirmation switched on, Supabase sends a mail and signs nobody in yet.
                        return self.reply(200, user_json(row) if confirm_email else session_json(row))
                    if path == "/auth/v1/token" and query.get("grant_type") == ["password"]:
                        cursor.execute("select id, email, confirmed, created_at, encrypted_password from auth.users where email = %s", (email,))
                        row = cursor.fetchone()
                        if row is None or row[4] != hash_password(password):
                            return self.reply(400, {"code": 400, "error_code": "invalid_credentials", "msg": "Invalid login credentials"})
                        if not row[2]:
                            return self.reply(400, {"code": 400, "error_code": "email_not_confirmed", "msg": "Email not confirmed"})
                        return self.reply(200, session_json(row))
                    if path == "/auth/v1/token" and query.get("grant_type") == ["refresh_token"]:
                        user_id = refresh_tokens.pop(str(body.get("refresh_token", "")), None)
                        row = None
                        if user_id:
                            cursor.execute("select id, email, confirmed, created_at from auth.users where id = %s", (user_id,))
                            row = cursor.fetchone()
                        if row is None:
                            return self.reply(400, {"code": 400, "error_code": "refresh_token_not_found", "msg": "Invalid Refresh Token: Refresh Token Not Found"})
                        return self.reply(200, session_json(row))
                    if path == "/auth/v1/logout":
                        return self.reply(204)
                    if path == "/auth/v1/recover":
                        return self.reply(200, {})
                    if path == "/auth/v1/dev/confirm":
                        # Not part of Supabase: stands in for clicking the link in the confirmation mail.
                        cursor.execute("update auth.users set confirmed = true where email = %s", (email,))
                        return self.reply(200, {})
            finally:
                connection.close()
            return self.reply(404, {"message": "not found"})

        def rpc(self, name, body):
            claims = self.caller()
            if claims is False:
                return self.reply(401, {"code": "PGRST301", "message": "JWT expired"})
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
                    cursor.execute("select set_config('request.jwt.claim.sub', %s, true)", (claims["sub"] if claims else "",))
                    cursor.execute("set local role " + ("authenticated" if claims else "anon"))
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
                # A function the caller's role may not run: Supabase answers 401 to nobody, 403 to somebody.
                if error.pgcode == "42501":
                    return self.reply(403 if claims else 401, {"code": "42501", "message": diag.message_primary, "details": None, "hint": None})
                return self.reply(400, {"code": error.pgcode, "message": diag.message_primary, "details": diag.message_detail, "hint": diag.message_hint})
            finally:
                connection.close()

    return Handler


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--dsn", default="dbname=shelfmark_dev")
    parser.add_argument("--port", type=int, default=54330)
    parser.add_argument("--key", default=DEFAULT_KEY)
    parser.add_argument("--token-seconds", type=int, default=3600, help="how long a sign-in lasts before it has to be refreshed")
    parser.add_argument("--confirm-email", action="store_true", help="behave like a project where new accounts have to confirm their e-mail address")
    options = parser.parse_args()
    psycopg2.extras.register_uuid()
    handler = make_handler(options.dsn, options.key, options.token_seconds, options.confirm_email)
    server = ThreadingHTTPServer(("127.0.0.1", options.port), handler)
    print(f"Shelfmark development server on http://127.0.0.1:{options.port}  key: {options.key}", flush=True)
    server.serve_forever()
