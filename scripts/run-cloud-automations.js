#!/usr/bin/env node

const { automationsForGroup, malaysiaDateParts } = require("../api/lib/cloud-automations");
const { buildAutomationNoteContext, sendEmail } = require("../api/lib/gmail");
const { generateAutomationEmail } = require("../api/lib/openai");
const { updateGrantDatabase } = require("../api/lib/grant-database");
const { updateColdEmailCrmDatabase, updateMarketingResearchDatabase } = require("../api/lib/marketing-database");

function parseArgs(argv) {
  const args = { group: "", dryRun: false };
  for (let index = 2; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--dry-run") {
      args.dryRun = true;
    } else if (value === "--group") {
      args.group = argv[index + 1] || "";
      index += 1;
    }
  }
  return args;
}

function isDatabaseAutomation(id) {
  return ["grant-database-list", "competition-analaysis", "cold-email-crm"].includes(id);
}

async function sendStatusEmail({ automation, isoDate, status, lines }) {
  if (!isDatabaseAutomation(automation.id)) return null;

  const body = [
    `Automation: ${automation.name}`,
    `Status: ${status}`,
    `Date: ${isoDate}`,
    "",
    ...lines,
    "",
    "This is an automatic completion notice from the GitHub Actions cloud runner.",
  ].join("\n");

  return sendEmail({
    to: automation.to,
    subject: `Automation ${status} | ${automation.name} | ${isoDate}`,
    body,
  });
}

async function main() {
  const { group, dryRun } = parseArgs(process.argv);
  if (!group) {
    throw new Error("Missing required --group value");
  }

  const { isoDate } = malaysiaDateParts();
  const automations = automationsForGroup(group);
  if (!automations.length) {
    throw new Error(`No automations found for group: ${group}`);
  }

  console.log(`Running group ${group} for ${isoDate} (${automations.length} automation/s)`);

  for (const automation of automations) {
    const subject = `${automation.subjectPrefix} | ${isoDate}`;
    try {
      if (automation.id === "grant-database-list") {
        if (dryRun) {
          console.log(`[dry-run] ${automation.id} -> would upsert grant_opportunities in Supabase`);
          continue;
        }
        console.log(`Updating online grant database`);
        const grantLimit = Number(process.env.GRANT_RESEARCH_LIMIT || 70);
        const result = await updateGrantDatabase({ runDate: isoDate, limit: grantLimit });
        console.log(`Upserted ${result.saved.length} grant rows into Supabase`);
        const lines = [
          `Database updated: grant_opportunities`,
          `Rows upserted: ${result.saved.length}`,
        ];
        if (result.warning) {
          lines.push(`Warning: ${result.warning}`);
        }
        const status = await sendStatusEmail({
          automation,
          isoDate,
          status: "Completed",
          lines,
        });
        console.log(`Sent ${automation.id} completion notice: ${status && status.id ? status.id : "ok"}`);
        continue;
      }

      if (dryRun) {
        console.log(`[dry-run] ${automation.id} -> ${automation.to.join(", ")} :: ${subject}`);
        continue;
      }

      const statusLines = [];
      if (automation.id === "competition-analaysis") {
        console.log("Updating online marketing research database");
        const result = await updateMarketingResearchDatabase({ runDate: isoDate, limit: 40 });
        console.log(`Upserted ${result.saved.length} marketing research rows into Supabase`);
        statusLines.push("Database updated: marketing_research_rows");
        statusLines.push(`Rows upserted: ${result.saved.length}`);
        if (result.warning) {
          statusLines.push(`Warning: ${result.warning}`);
        }
      }

      if (automation.id === "cold-email-crm") {
        console.log("Updating online cold-email CRM database");
        const result = await updateColdEmailCrmDatabase({ runDate: isoDate, limit: 100 });
        console.log(`Upserted ${result.saved.length} cold-email CRM rows into Supabase`);
        statusLines.push("Database updated: marketing_cold_email_leads");
        statusLines.push(`Rows upserted: ${result.saved.length}`);
      }

      console.log(`Generating ${automation.id}`);
      let noteContext = "";
      try {
        noteContext = await buildAutomationNoteContext(automation);
        if (noteContext) {
          console.log(`Included Gmail reply notes for ${automation.id}`);
        }
      } catch (error) {
        console.warn(`Could not load Gmail reply notes for ${automation.id}: ${error.message}`);
      }

      const body = await generateAutomationEmail(automation, isoDate, noteContext);
      const sent = await sendEmail({ to: automation.to, subject, body });
      console.log(`Sent ${automation.id}: ${sent.id || "ok"}`);

      if (statusLines.length) {
        statusLines.push(`Brief email sent: ${sent.id || "ok"}`);
        const status = await sendStatusEmail({
          automation,
          isoDate,
          status: "Completed",
          lines: statusLines,
        });
        console.log(`Sent ${automation.id} completion notice: ${status && status.id ? status.id : "ok"}`);
      }
    } catch (error) {
      console.error(`${automation.id} failed: ${error.message}`);
      try {
        const status = await sendStatusEmail({
          automation,
          isoDate,
          status: "Failed",
          lines: [
            `Error: ${error.message}`,
            "Check the GitHub Actions run logs for the full trace.",
          ],
        });
        if (status) {
          console.log(`Sent ${automation.id} failure notice: ${status.id || "ok"}`);
        }
      } catch (emailError) {
        console.warn(`Could not send ${automation.id} failure notice: ${emailError.message}`);
      }
      throw error;
    }
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
