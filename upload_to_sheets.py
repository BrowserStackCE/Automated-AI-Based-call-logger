import csv
import os
import sys
from google.oauth2.service_account import Credentials
from googleapiclient.discovery import build

# === CONFIGURATION ===
CSV_FILE = "final_categorized.csv"

# Google Sheet to update
SPREADSHEET_ID = "1lk5wly9kO-c3xAuNh7LDSasKCp6MN67tkpE0wO6c5Y0"
SHEET_NAME = "Sheet2"   # Change if needed

# Service Account JSON file
SERVICE_ACCOUNT_FILE = "service.json"


def load_csv(filepath):
    """Load CSV into list of lists."""
    if not os.path.exists(filepath):
        print(f"❌ CSV not found: {filepath}")
        sys.exit(1)

    with open(filepath, "r", encoding="utf-8") as f:
        return list(csv.reader(f))


def upload_to_google_sheet():
    print("\n📤 Uploading final_categorized.csv to Google Sheet...")

    data = load_csv(CSV_FILE)

    # Authenticate using service account
    creds = Credentials.from_service_account_file(
        SERVICE_ACCOUNT_FILE,
        scopes=["https://www.googleapis.com/auth/spreadsheets"]
    )

    service = build("sheets", "v4", credentials=creds)

    # Clear sheet
    service.spreadsheets().values().clear(
        spreadsheetId=SPREADSHEET_ID,
        range=SHEET_NAME
    ).execute()

    # Upload new CSV content
    service.spreadsheets().values().update(
        spreadsheetId=SPREADSHEET_ID,
        range=SHEET_NAME,
        valueInputOption="RAW",
        body={"values": data}
    ).execute()

    print("✅ Google Sheet updated successfully.")


if __name__ == "__main__":
    upload_to_google_sheet()
