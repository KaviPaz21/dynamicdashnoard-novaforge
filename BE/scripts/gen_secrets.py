"""Generate the secrets NovaForge needs and write them into BE/.env and FE/.env.local.

    python scripts/gen_secrets.py            # fills in only what is missing, never overwrites an existing value
    python scripts/gen_secrets.py --admin-email you@example.com --admin-name "Your Name"

  BE/.env     JWT_SECRET, SECURE_SIGNING_KEY (private), ADMIN_EMAIL / ADMIN_PASSWORD (bootstrap administrator)
  FE/.env.local  NEXT_PUBLIC_SECURE_SIGNING_PUBKEY (the public half, pinned in the browser build)

The bootstrap admin password is printed once; it is only used to create the first account (change it after signing in).
"""

from __future__ import annotations

import argparse
import base64
import re
import secrets
import string
import sys
from pathlib import Path

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec

ROOT = Path(__file__).resolve().parents[2]
BE_ENV, FE_ENV = ROOT / "BE" / ".env", ROOT / "FE" / ".env.local"


def read_env(path: Path) -> dict[str, str]:
    out: dict[str, str] = {}
    if path.exists():
        for line in path.read_text(encoding="utf-8").splitlines():
            m = re.match(r"^\s*([A-Z0-9_]+)\s*=\s*(.*)$", line)
            if m:
                out[m.group(1)] = m.group(2).strip()
    return out


def set_env(path: Path, key: str, value: str) -> None:
    text = path.read_text(encoding="utf-8") if path.exists() else ""
    line = f"{key}={value}"
    if re.search(rf"^{key}\s*=.*$", text, re.M):
        text = re.sub(rf"^{key}\s*=.*$", line, text, flags=re.M)
    else:
        text = text.rstrip("\n") + ("\n" if text else "") + line + "\n"
    path.write_text(text, encoding="utf-8")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--admin-email", default="admin@novaforge.local")
    ap.add_argument("--admin-name", default="Administrator")
    args = ap.parse_args()
    be, fe = read_env(BE_ENV), read_env(FE_ENV)
    made: list[str] = []

    if not be.get("JWT_SECRET"):
        set_env(BE_ENV, "JWT_SECRET", secrets.token_urlsafe(64))
        made.append("JWT_SECRET")

    if not be.get("SECURE_SIGNING_KEY") or not fe.get("NEXT_PUBLIC_SECURE_SIGNING_PUBKEY"):
        key = ec.generate_private_key(ec.SECP256R1())
        der = key.private_bytes(serialization.Encoding.DER, serialization.PrivateFormat.PKCS8, serialization.NoEncryption())
        pub = key.public_key().public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
        set_env(BE_ENV, "SECURE_SIGNING_KEY", base64.b64encode(der).decode())
        set_env(FE_ENV, "NEXT_PUBLIC_SECURE_SIGNING_PUBKEY", base64.b64encode(pub).decode())
        made += ["SECURE_SIGNING_KEY", "NEXT_PUBLIC_SECURE_SIGNING_PUBKEY"]

    if not be.get("ADMIN_PASSWORD"):
        alphabet = string.ascii_letters.replace("l", "").replace("I", "").replace("O", "") + string.digits.replace("0", "").replace("1", "")
        password = "".join(secrets.choice(alphabet) for _ in range(16))
        set_env(BE_ENV, "ADMIN_NAME", args.admin_name)
        set_env(BE_ENV, "ADMIN_EMAIL", args.admin_email)
        set_env(BE_ENV, "ADMIN_PASSWORD", password)
        made.append("ADMIN_EMAIL / ADMIN_PASSWORD")
        print(f"\nBootstrap administrator -> email: {args.admin_email}   password: {password}")
        print("(also stored in BE/.env; it is only read when the user table is empty)\n")

    print("written:", ", ".join(made) if made else "nothing, everything was already set")
    return 0


if __name__ == "__main__":
    sys.exit(main())
