const fs = require("fs");
const csv = require("csv-parser");
const { parse } = require("json2csv");

const INPUT_CSV = "external_meetings_updated.csv";
const CE_MAPPING_CSV = "ce_mapping.csv";
const OUTPUT_CSV = "transposed_meetings.csv";

const ceMapping = new Map();

// === Helper: Clean HTML from Strings ===
function cleanDescription(text) {
  if (!text) return "";
  let cleaned = text.replace(/<br\s*\/?>/gi, "\n").replace(/<\/p>/gi, "\n");
  cleaned = cleaned.replace(/<[^>]*>?/gm, "");
  cleaned = cleaned.replace(/&amp;/g, "&").replace(/&nbsp;/g, " ");
  return cleaned.trim();
}

// === Helper: Calculate Days to Renewal ===
function calculateDaysToRenewal(targetDateStr) {
  if (!targetDateStr || targetDateStr === "NA" || targetDateStr.trim() === "") {
    return "";
  }
  const targetDate = new Date(targetDateStr);
  if (isNaN(targetDate.getTime())) return "";

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  targetDate.setHours(0, 0, 0, 0);

  const diffTime = targetDate - today;
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  return diffDays;
}

// === Step 1: Load CE Mapping ===
async function loadCEMapping() {
  return new Promise((resolve, reject) => {
    console.log("📖 Loading CE mapping...");
    fs.createReadStream(CE_MAPPING_CSV)
      .pipe(csv({ mapHeaders: ({ header }) => header.trim() })) 
      .on("data", (row) => {
        // Based on your headers: role_name_c, name, email, id, is_active
        const email = row["email"]; 
        const ceId = row["id"]; 

        if (email && ceId) {
          ceMapping.set(email.trim().toLowerCase(), ceId.trim());
        }
      })
      .on("end", () => {
        console.log(`✅ Loaded ${ceMapping.size} CE mappings.`);
        // Debug: Print a few keys to verify
        console.log("   (Debug) Sample keys:", [...ceMapping.keys()].slice(0, 3));
        resolve();
      })
      .on("error", reject);
  });
}

// === Step 2: Transpose Meetings ===
async function transposeMeetings() {
  const meetings = [];

  console.log("📂 Reading input CSV...");
  await new Promise((resolve, reject) => {
    fs.createReadStream(INPUT_CSV)
      .pipe(csv({ mapHeaders: ({ header }) => header.trim() }))
      .on("data", (row) => meetings.push(row))
      .on("end", resolve)
      .on("error", reject);
  });

  console.log(`✅ Loaded ${meetings.length} rows.\n`);

  const transposedData = meetings
  .map((row, index) => {
    const accountId = row["Account ID"] || row["WhatId"] || "";

    // Ensure we are grabbing the email from 'Calendar ID' or 'email'
    const calendarIdRaw = row["Calendar ID"] || row["email"] || "";
    const calendarId = calendarIdRaw.trim().toLowerCase();

    // Mapping Lookup
    const ceId = ceMapping.get(calendarId) || "NA";

    const cleanDesc = cleanDescription(row["Description"] || "");
    const subject = row["Summary"] || "";
    const startDate = row["Start Date"] || "2025-09-01";
    const trd = row["Target Renewal Date"] || row["TargetRenewalDate"];
    const daysToRenewal = calculateDaysToRenewal(trd);

    if (ceId === "NA" && calendarId !== "") {
      console.warn(`⚠️ Row ${index + 1}: No ID found for '${calendarId}'`);
    }

    return {
      Activity_Category__c: " ",
      WhatId: accountId,
      Calendar_ID__c: calendarId,
      WhoId: ceId,
      Type: "Call",
      Description: "AutomatedCallLogged",
      Subject: subject,
      OwnerId: ceId,
      Call_Date__c: startDate,
      AE_Present__c: "TRUE",
      CSM_Present__c: "FALSE",
      ActivityDate: startDate,
      Status: "Completed",
      TaskSubtype: "Call",
      "Event ID": row["Event ID"],
      Stage: row["Stage"] || "Prospecting",
      isPOCOpen: row["POC Open?"] || "False",
      days_to_renewal: daysToRenewal,
    };
  }).filter(row => row.WhatId && row.WhatId !== "NA");
  // 🔥 NEW: Filter out rows where WhoId is empty, null, or "NA"
  


  // === Step 3: Write Output CSV ===
  console.log("\n💾 Writing transposed data...");
  const fields = [
    "Activity_Category__c",
    "WhatId",
    "Calendar_ID__c",
    "WhoId",
    "Type",
    "Description",
    "Subject",
    "OwnerId",
    "Call_Date__c",
    "AE_Present__c",
    "CSM_Present__c",
    "ActivityDate",
    "Status",
    "TaskSubtype",
    "Event ID",
    "Stage",
    "isPOCOpen",
    "days_to_renewal",
  ];

  const csvData = parse(transposedData, { fields, quote: '"' });
  fs.writeFileSync(OUTPUT_CSV, csvData);
  console.log(`✅ Transposed CSV written to ${OUTPUT_CSV}`);
  console.log("🎉 Process completed successfully.\n");
}

(async () => {
  await loadCEMapping();
  await transposeMeetings();
})();