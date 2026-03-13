import os, requests, json
from dotenv import load_dotenv
load_dotenv("/Users/Ed/Apps/SavorIQ/backend/.env")
token = os.getenv("APIFY_FALLBACK_TOKEN_1")
if not token:
    print("No token found")
    exit()
r = requests.get("https://api.apify.com/v2/users/me", headers={"Authorization": f"Bearer {token}"})
print(json.dumps(r.json(), indent=2))
