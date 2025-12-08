/**
 * processMeetings.js
 * Reads external_meetings.csv → maps CE ID → queries BigQuery → writes results
 */

const fs = require("fs");
const csv = require("csv-parser");
const { parse } = require("json2csv");
const { BigQuery } = require("@google-cloud/bigquery");

const INPUT_CSV = "external_meetings.csv";
const OUTPUT_CSV = "external_meetings_updated.csv";
const MAPPING_CSV = "ce_mapping.csv";
const SERVICE_ACCOUNT_KEY = "./service.json";
const bigquery = new BigQuery({ keyFilename: SERVICE_ACCOUNT_KEY });

// === Retry Wrapper ===
async function withRetry(fn, description, maxAttempts = 5, baseDelayMs = 1000) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const delay = baseDelayMs * Math.pow(2, attempt - 1);
      console.warn(`⚠️ [${description}] Attempt ${attempt} failed: ${err.message}`);
      if (attempt === maxAttempts) throw err;
      console.log(`⏳ Retrying in ${delay / 1000}s...`);
      await new Promise((res) => setTimeout(res, delay));
    }
  }
}

// === BigQuery helpers ===
async function queryBQForEmail(email) {
  const query = `
    SELECT group_id FROM \`browserstack-production.common.users\`
    WHERE email='${email}' LIMIT 1
  `;
  const [rows] = await withRetry(() => bigquery.query({ query }), `queryBQForEmail(${email})`);
  return rows.length ? rows[0].group_id : null;
}

async function queryBQForAccountID(groupId) {
  const query = `
    SELECT id FROM \`browserstack-production.salesforceproduction.account\`
    WHERE group_id_c='${groupId}' LIMIT 1
  `;
  const [rows] = await withRetry(() => bigquery.query({ query }), `queryBQForAccountID(${groupId})`);
  return rows.length ? rows[0].id : null;
}

async function queryBQForAIDetails(accountId) {
  const query = `
    SELECT
      t1.target_renewal_date_c AS TRD,
      t1.name AS OppName,
      t1.stage_name AS OppStage,
      t1.type AS OppType,
      t1.created_date AS OppCreatedDate,
      t1.close_date AS OppCloseDate,
      t2.poc_status_c AS PocStatus
    FROM \`browserstack-production.salesforceproduction.opportunity\` AS t1
    LEFT JOIN \`browserstack-production.salesforceproduction.poc_c\` AS t2
      ON t1.id = t2.opportunity_c
    WHERE t1.account_id = "${accountId}"
      AND t1.stage_name NOT IN ("Closed Won", "Closed Lost")
    ORDER BY t1.close_date DESC
    LIMIT 10
  `;
  const [rows] = await withRetry(() => bigquery.query({ query }), `queryBQForAIDetails(${accountId})`);
  return rows;
}

// === Format AI Details ===
// === Format AI Details ===
function formatAIDetails(rows) {
  let TargetRenewalDate = "";
  let Stage = "";
  let isPOCOpen = "False";

  for (const r of rows) {
    // FIX: Handle BigQuery DATE object wrapper ({ value: 'YYYY-MM-DD' })
    const rawTRD = r.trd || r.TRD;
    let cleanTRD = null;

    if (rawTRD) {
      if (typeof rawTRD === 'object' && rawTRD.value) {
        cleanTRD = rawTRD.value; // It's a BigQuery Date object
      } else {
        cleanTRD = rawTRD;       // It's already a string or timestamp
      }
    }

    const pocStatus = r.pocstatus || r.PocStatus;
    const oppStage = r.oppstage || r.OppStage;
    const oppType = r.opptype || r.OppType;

    // Process the date using the clean string
    if (cleanTRD && !TargetRenewalDate) {
      try {
        const dateObj = new Date(cleanTRD);
        if (!isNaN(dateObj.getTime())) {
             // Use ISO string to avoid timezone shifts, or keep original if it matches YYYY-MM-DD
             TargetRenewalDate = dateObj.toISOString().split("T")[0];
        }
      } catch (err) {
        console.warn(`⚠️ Invalid TRD format: ${JSON.stringify(rawTRD)}`);
      }
    }

    if (pocStatus && pocStatus !== "Closed") {
      isPOCOpen = "True";
    }

    if (rows.length === 1 || (oppType !== "Renewal" && oppStage !== "Cancelled")) {
      Stage = oppStage || "NA";
    }
  }

  console.log(`   🧾 Formatted → Stage: ${Stage}, POC: ${isPOCOpen}, TRD: ${TargetRenewalDate || "NA"}`);
  return { TargetRenewalDate: TargetRenewalDate || "NA", Stage, isPOCOpen };
}

// === Load CE Mapping from CSV ===
// === Load CE Mapping from CSV ===
async function loadCEMapping() {
  console.log("📘 Loading CE mapping from ce_mapping.csv...");
  const mapping = {};

  return new Promise((resolve, reject) => {
    fs.createReadStream(MAPPING_CSV)
      .pipe(csv())
      .on("data", (row) => {
        // Using the exact headers you provided: role_name_c, name, email, id, is_active
        
        // 1. Get the email (matches 'Calendar ID' in your main file)
        const email = (row["email"] || "").trim().toLowerCase(); 
        
        // 2. Get the ID (the value you want to write to 'CE ID')
        const ceId = (row["id"] || "").trim();

        // 3. Map them if both exist
        if (email && ceId) {
          mapping[email] = ceId;
        }
      })
      .on("end", () => {
        console.log(`✅ Loaded ${Object.keys(mapping).length} CE mappings.`);
        
        // Debug: Print a sample to ensure it worked
        const sampleKey = Object.keys(mapping)[0];
        if (sampleKey) {
            console.log(`   🔎 Sample check: ${sampleKey} → ${mapping[sampleKey]}`);
        } else {
            console.warn("   ⚠️ Warning: No mappings were loaded. Check if the CSV is empty or headers match exactly.");
        }
        
        resolve(mapping);
      })
      .on("error", reject);
  });
}

// === Main Script ===
async function main() {
  console.log("📂 Reading input CSV...");
  const ceMapping = await loadCEMapping();
  const rows = [];

  fs.createReadStream(INPUT_CSV)
    .pipe(csv())
    .on("data", (row) => rows.push(row))
    .on("end", async () => {
      console.log(`✅ Loaded ${rows.length} meetings from ${INPUT_CSV}`);

      const updatedRows = [];

      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        console.log(`\n🔹 Processing Row ${i + 1} (${r["Summary"] || "No Summary"})`);

        // Find CE Owner ID based on Calendar ID
        const calendarId = (r["Calendar ID"] || "").trim().toLowerCase();
        const ownerId = ceMapping[calendarId] || "NA";
        console.log(`   👤 CE Owner ID (from mapping): ${ownerId}`);

        // Extract external group info
        const attendees = (r["Attendee List"] || "").split(",");
        let resultGroupId = null;
        for (const email of attendees) {
          const trimmed = email.trim();
          if (!trimmed || trimmed.endsWith("@browserstack.com") || trimmed.endsWith("@gmail.com")) continue;
          try {
            resultGroupId = await queryBQForEmail(trimmed);
            if (resultGroupId) {
              console.log(`   ✅ Found Group ID: ${resultGroupId}`);
              break;
            }
          } catch (err) {
            console.error(`   ❌ Failed query for ${trimmed}: ${err.message}`);
          }
        }

        let accountId = "NA";
        let details = { TargetRenewalDate: "NA", Stage: "NA", isPOCOpen: "NA" };

        if (resultGroupId) {
          accountId = await queryBQForAccountID(resultGroupId);
          if (accountId) {
            console.log(`   🔗 Account ID: ${accountId}`);
            const aiDetails = await queryBQForAIDetails(accountId);
            if (aiDetails.length) details = formatAIDetails(aiDetails);
          }
        }

        // Write row with all computed fields
        updatedRows.push({
          ...r,
          "CE ID": ownerId,                       // 👈 Added CE ID
          "Group ID": resultGroupId || "NA",
          "Account ID": accountId,
          "Stage": details.Stage,
          "POC Open?": details.isPOCOpen,
          "Target Renewal Date": details.TargetRenewalDate,
        });
      }

      console.log("\n💾 Writing updated data to CSV...");
      const csvOutput = parse(updatedRows);
      fs.writeFileSync(OUTPUT_CSV, csvOutput);
      console.log(`✅ Updated CSV written to ${OUTPUT_CSV}`);
    });
}

main().catch((err) => console.error("❌ Script failed:", err));
