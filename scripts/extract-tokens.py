#!/usr/bin/env python3
"""
Extract Jobber OAuth tokens from the FirstVisitAI database.

Run from the backend directory with the venv activated:
    cd ../backend && source venv/bin/activate
    python ../jobber-mcp-server/scripts/extract-tokens.py

Prints the decrypted tokens so you can paste them into jobber-mcp-server/.env
"""
import sys
import os

# Add backend to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'backend'))
os.chdir(os.path.join(os.path.dirname(__file__), '..', '..', 'backend'))

from dotenv import load_dotenv
load_dotenv()

import sqlite3
from app.integrations.jobber.utils import decrypt_token

db_path = os.environ.get("DATABASE_PATH", "firstvisit.db")
if not os.path.exists(db_path):
    print(f"Database not found at {db_path}")
    sys.exit(1)

conn = sqlite3.connect(db_path)
conn.row_factory = sqlite3.Row
rows = conn.execute(
    "SELECT company_id, access_token_encrypted, refresh_token_encrypted, status "
    "FROM jobber_connections WHERE status = 'connected'"
).fetchall()

if not rows:
    print("No connected Jobber accounts found in the database.")
    sys.exit(1)

for row in rows:
    print(f"\n# Company: {row['company_id']}")
    print(f"JOBBER_ACCESS_TOKEN={decrypt_token(row['access_token_encrypted'])}")
    print(f"JOBBER_REFRESH_TOKEN={decrypt_token(row['refresh_token_encrypted'])}")

conn.close()
print("\nCopy the tokens above into jobber-mcp-server/.env")
