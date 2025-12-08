import subprocess
import time
import os
import sys
import requests

# === CONFIGURATION ===
# Node → Python pipeline steps
STEPS = [
    {"cmd": "node fetchMultipleCalendarsByDate.js", "desc": "Fetch Calendar Events"},
    {"cmd": "node processMeetings.js", "desc": "Process & Enrich Meetings (BigQuery)"},
    {"cmd": "node transposeMeetingData.js", "desc": "Transpose Data Format"},
    {"cmd": "python3 upload_to_sheets.py", "desc": "Upload final_categorized.csv to Google Sheets"}
]

OLLAMA_API_URL = "http://localhost:11500"
CLASSIFICATION_SCRIPT = "aiClassification.py"


def run_command(command, description):
    """Executes a shell command and halts pipeline on failure."""
    print(f"\n🚀 [STEP] {description}...")
    try:
        subprocess.run(command, check=True, shell=True)
        print(f"✅ {description} completed.")
    except subprocess.CalledProcessError as e:
        print(f"❌ {description} failed. (Exit Code: {e.returncode})")
        sys.exit(1)


def is_ollama_ready(url):
    """Checks if Ollama is responsive at the given URL."""
    try:
        requests.get(url, timeout=2)
        return True
    except requests.RequestException:
        return False


def manage_ollama():
    """Starts Ollama if not running, specifically on port 11500."""
    print(f"\n🦙 [SETUP] Checking Ollama status on {OLLAMA_API_URL}...")

    # 1. Check if already running
    if is_ollama_ready(OLLAMA_API_URL):
        print("   🔹 Ollama is already running.")
        return None  # No process to kill later

    # 2. Configure environment for custom port
    ollama_env = os.environ.copy()
    ollama_env["OLLAMA_HOST"] = "127.0.0.1:11500"

    print("   🔸 Starting Ollama server...")
    try:
        process = subprocess.Popen(
            ["ollama", "serve"],
            env=ollama_env,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL
        )
    except FileNotFoundError:
        print("❌ Error: 'ollama' command not found. Is it installed?")
        sys.exit(1)

    # 3. Wait for initialization
    retries = 10
    while retries > 0:
        if is_ollama_ready(OLLAMA_API_URL):
            print("✅ Ollama started successfully.")
            return process
        time.sleep(2)
        retries -= 1
        print(f"   ⏳ Waiting for Ollama... ({10 - retries}/10)")

    print("❌ Failed to start Ollama. Check installation.")
    process.kill()
    sys.exit(1)


def main():
    print("==========================================")
    print("   🗓️  CALENDAR DATA PIPELINE START      ")
    print("==========================================")

    # 1. Run Node.js Data Processing Steps
    for step in STEPS[:-1]:  # Run all steps except final_sheet_upload (done later)
        run_command(step["cmd"], step["desc"])

    # 2. Start Ollama
    ollama_process = manage_ollama()

    # 3. AI Classification
    try:
        run_command(f"python3 {CLASSIFICATION_SCRIPT}", "AI Classification with Llama3")
    finally:
        # 4. Cleanup Ollama if we started it
        if ollama_process:
            print("\n🛑 [CLEANUP] Stopping Ollama server...")
            ollama_process.terminate()
            ollama_process.wait()

    # 5. Upload CSV → Google Sheets
    final_step = STEPS[-1]
    run_command(final_step["cmd"], final_step["desc"])

    print("\n🎉 ========================================")
    print("      PIPELINE COMPLETED SUCCESSFULLY      ")
    print("===========================================")


if __name__ == "__main__":
    main()
