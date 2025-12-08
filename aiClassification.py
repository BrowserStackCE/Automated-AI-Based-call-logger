import pandas as pd
import requests

# Load the CSV
file_path = "transposed_meetings.csv"
df = pd.read_csv(file_path)

# Function to classify the call
def classify_call(call_data, model="llama3"):
    prompt = f"""
You are a smart assistant trained to classify customer calls into lifecycle categories at BrowserStack.

Use the following guidelines to determine the correct classification:

- **Pre-POC**: Demos, Discovery calls, or any early-stage exploration before a proof of concept.
- **POC**: This is only when POC is Running. Mid-POC calls, technical evaluations during active proof of concept, or debugging calls **when the Opportunity Stage is "Confirm Value" or POC running: Yes **.
- **Post-POC**: Feedback or retrospective discussions following the completion of a POC.
- **Onboarding**: Calls focused on onboarding customers or enabling their teams on BrowserStack.
- **Adoption**: QBRs, Quaterly or Monthly Sync, MBRs, support or success calls, debugging calls these should always be marked as Adoption. If the calendar title or description contains a **ticket ID**, it is strongly associated with Adoption.
- **Renewal**: If the renewal date is within 30 days and call is about renewal discussion, it is likely a renewal-related call. 
If you cannot judge what bucket it might fall into default it to **Adoption**

Classify the following call into **one of the six categories only**:
- Pre-POC
- POC
- Post-POC
- Onboarding
- Adoption
- Renewal

**Respond with only the category name. Do not include any explanation.**

Details:
- Calendar Title: {call_data['calendar_title']}
- Calendar Description: {call_data['calendar_description']}
- Opportunity Stage: {call_data['opportunity_stage']}
- Days to Renewal: {call_data['days_to_renewal']}
- POC running: {call_data['isPOCOpen']}
"""
    try:
        response = requests.post(
            "http://localhost:11500/api/generate",
            json={"model": model, "prompt": prompt, "stream": False},
            timeout=30 # Added timeout for safety
        )
        if response.status_code == 200:
             return response.json().get("response", "Adoption").strip()
        else:
             return "Error"
    except Exception as e:
        print(f"API Error: {e}")
        return "Error"

# Process each row and print updates
lifecycle_values = []

print(f"🚀 Starting classification for {len(df)} rows...")

for index, row in df.iterrows():
    call_data = {
        "calendar_title": str(row.get("Subject", "")),
        "calendar_description": str(row.get("Description", "NA")), 
        "opportunity_stage": str(row.get("Stage", "")),
        "isPOCOpen": str(row.get("isPOCOpen", "")),
        "days_to_renewal": str(row.get("days_to_renewal", ""))
    }

    category = classify_call(call_data)
    
    # Simple logging
    print(f"Row {index+1}: {category} (Subject: {call_data['calendar_title'][:30]}...)")
    
    lifecycle_values.append(category)

# === Overwrite the first column ===
df.iloc[:, 0] = lifecycle_values

# === CHANGE HERE: Remove Calendar_ID__c Column ===
# Removes the column if it exists to avoid errors
# Drop unwanted columns if present
for col in ["Calendar_ID__c", "WhoId"]:
    if col in df.columns:
        df.drop(columns=[col], inplace=True)
        print(f"✅ Dropped column: {col}")
    else:
        print(f"⚠️ Column '{col}' not found, skipping drop.")


# Save output
output_file = "final_categorized.csv"
df.to_csv(output_file, index=False)
print(f"\n✅ File saved: {output_file}")