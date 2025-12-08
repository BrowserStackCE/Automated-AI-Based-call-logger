// fetchExternalMeetings.js
const { google } = require("googleapis");
const fs = require("fs");
const csv = require("csv-parser");
const { parse } = require("json2csv");

// === CONFIGURATION ===
const SERVICE_ACCOUNT_FILE = "service.json"; // Path to your service account key
const INPUT_CSV = "calendars.csv"; // Input CSV containing calendar IDs or emails
const OUTPUT_CSV = "external_meetings.csv"; // Output file name

// Define your date range (ISO format: YYYY-MM-DD)
const START_DATE = "2025-12-08";
const END_DATE = "2025-12-08";

// Define internal company domains (used to detect external attendees)
const INTERNAL_DOMAINS = ["@browserstack.com", "@resource.calendar.google.com"];

// === HELPER FUNCTIONS ===

// Read calendar emails from CSV
function readCalendarsFromCSV(filePath) {
  return new Promise((resolve, reject) => {
    const results = [];
    fs.createReadStream(filePath)
      .pipe(csv())
      .on("data", (data) => results.push(data))
      .on("end", () => resolve(results))
      .on("error", reject);
  });
}

// Check if event has at least one external attendee
function hasExternalAttendee(event) {
  if (!event.attendees || event.attendees.length === 0) return false;
  return event.attendees.some(
    (a) =>
      a.email &&
      !INTERNAL_DOMAINS.some((domain) => a.email.endsWith(domain))
  );
}

// Calculate meeting duration in minutes
function calculateDurationMinutes(start, end) {
  if (!start || !end) return 0;
  const startTime = new Date(start);
  const endTime = new Date(end);
  return Math.round((endTime - startTime) / (1000 * 60)); // minutes
}

// Fetch events for one calendar
async function fetchExternalEventsForUser(userEmail, auth, timeMin, timeMax) {
  const calendar = google.calendar({ version: "v3", auth });

  try {
    const res = await calendar.events.list({
      calendarId: "primary",
      timeMin,
      timeMax,
      singleEvents: true,
      orderBy: "startTime",
      maxResults: 2500,
    });

    const events = res.data.items || [];

    // Only include events that have external attendees
    const externalEvents = events.filter(hasExternalAttendee);

    return externalEvents.map((event) => {
      const start = event.start?.dateTime || event.start?.date || "";
      const end = event.end?.dateTime || event.end?.date || "";
      const duration = calculateDurationMinutes(start, end);
      const attendees =
        event.attendees?.map((a) => a.email).join(", ") || "";

      return {
        "Event ID": event.id || "",
        Timestamp: start,
        "Calendar ID": userEmail,
        "Created by": event.organizer?.email || "",
        "Internal Meeting Duration": "",
        "External Meeting Duration": duration ? duration.toString() : "",
        "Unknown Meeting Duration": "",
        "Attending?": event.attendees?.some(
          (a) => a.email === userEmail && a.responseStatus === "accepted"
        )
          ? "True"
          : "False",
        "Is Meeting External?": "True",
        "Attendee List": attendees,
        Summary: event.summary || "",
        Visibility: event.visibility || "default",
        Description: event.description
          ? event.description.replace(/\r?\n|\r/g, " ")
          : "",
        Location: event.location || "",
      };
    });
  } catch (err) {
    console.error(`❌ Error fetching events for ${userEmail}:`, err.message);
    return [];
  }
}

// === MAIN ===
async function main() {
  const key = JSON.parse(fs.readFileSync(SERVICE_ACCOUNT_FILE));
  const users = await readCalendarsFromCSV(INPUT_CSV);

  if (users.length === 0) {
    console.log("No users found in CSV.");
    return;
  }

  const timeMin = new Date(`${START_DATE}T00:00:00Z`).toISOString();
  const timeMax = new Date(`${END_DATE}T23:59:59Z`).toISOString();

  let allExternalEvents = [];

  for (const row of users) {
    const userEmail = row.email || row.user || row.calendarId;
    if (!userEmail) continue;

    console.log(`📅 Fetching external events for: ${userEmail}`);

    const auth = new google.auth.JWT({
      email: key.client_email,
      key: key.private_key,
      scopes: ["https://www.googleapis.com/auth/calendar.readonly"],
      subject: userEmail, // impersonate each user
    });

    const events = await fetchExternalEventsForUser(
      userEmail,
      auth,
      timeMin,
      timeMax
    );
    allExternalEvents = allExternalEvents.concat(events);
  }

  if (allExternalEvents.length === 0) {
    console.log("No external meetings found for any user.");
    return;
  }

  const csvData = parse(allExternalEvents, {
    fields: Object.keys(allExternalEvents[0]),
  });
  fs.writeFileSync(OUTPUT_CSV, csvData);
  console.log(`✅ External meetings written to ${OUTPUT_CSV}`);
}

main().catch(console.error);
